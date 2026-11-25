import { describe, it, expect, vi } from 'vitest';
import { checkEmail, domainOf, isSendable, pickEmail, EMAIL_CHECK_VERSION, type MailLookup } from '../lib/emailCheck';
import { canSend, type EmailCheck } from '../lib/emailStatus';

const NOW = new Date('2026-11-23T10:00:00Z');
const lookup = (o: Partial<MailLookup> = {}): MailLookup => ({ mx: async () => ['mx.example.com'], hasAddress: async () => false, ...o });
// the business's own website is smile.example unless a test says otherwise
const check = (email: string, o: Partial<MailLookup> = {}, ctx: { website?: string; foundOnSite?: boolean } = { website: 'https://www.smile.example/' }) =>
  checkEmail(email, { lookup: lookup(o), now: () => NOW, ...ctx });
const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe('checkEmail', () => {
  it('a normal address on a domain with a mail server is ok and personal', async () => {
    expect(await check('sarah@smile.example')).toMatchObject({ status: 'ok', kind: 'personal', reasons: [], checkedAt: NOW.toISOString() });
  });
  it('rejects malformed addresses without any lookup', async () => {
    const mx = vi.fn(async () => ['x']);
    for (const e of ['', 'nope', 'a@b', '@x.com', 'a b@x.com', 'a@x..com']) expect((await check(e, { mx })).status, e).toBe('bad');
    expect(mx).not.toHaveBeenCalled();
  });
  it('a domain with no mail server and no web address is bad', async () => {
    const r = await check('a@dead.example', { mx: async () => { throw dnsError('ENOTFOUND'); } });
    expect(r.status).toBe('bad');
    expect(r.reasons.join()).toMatch(/no mail server/i);
  });
  it('a domain with no MX record but a web address is risky (mail would go to the web server)', async () => {
    const r = await check('a@site.example', { mx: async () => [], hasAddress: async () => true });
    expect(r.status).toBe('risky');
  });
  it('a lookup that fails or times out is risky, never bad: we do not know', async () => {
    for (const code of ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED']) {
      const r = await check('a@slow.example', { mx: async () => { throw dnsError(code); } });
      expect(r.status, code).toBe('risky');
      expect(r.reasons.join()).toMatch(/could not check/i);
    }
  });
  it('flags throwaway inbox domains as bad, with no lookup', async () => {
    const mx = vi.fn(async () => ['x']);
    expect((await check('x@mailinator.com', { mx })).status).toBe('bad');
    expect((await check('x@10minutemail.com', { mx })).reasons.join()).toMatch(/throwaway/i);
    expect(mx).not.toHaveBeenCalled();
  });
  it('catches typos of big providers', async () => {
    const r = await check('sam@gmial.com');
    expect(r.status).toBe('bad');
    expect(r.reasons.join()).toMatch(/gmail\.com/);
  });
  it('marks shared inboxes (info@, reception@) as role, still ok', async () => {
    for (const e of ['info@smile.example', 'Reception@smile.example', 'bookings@smile.example', 'office2@smile.example']) {
      expect(await check(e), e).toMatchObject({ status: 'ok', kind: 'role' });
    }
    expect((await check('info@smile.example')).reasons.join()).toMatch(/shared inbox/i);
  });
  it('a free mailbox (gmail, yahoo) is ok only when the business shows it on its own website', async () => {
    const mx = vi.fn(async () => ['x']);
    expect(await check('smilecare@gmail.com', { mx }, { website: 'https://smile.example', foundOnSite: true })).toMatchObject({ status: 'ok', kind: 'freemail' });
    const unproven = await check('smilecare@gmail.com', { mx }, { website: 'https://smile.example', foundOnSite: false });
    expect(unproven.status).toBe('risky');
    expect(unproven.reasons.join()).toMatch(/own website/i);
    expect(mx).not.toHaveBeenCalled();
  });
  it('asks about each domain once', async () => {
    const mx = vi.fn(async () => ['mx.example.com']);
    const l = lookup({ mx });
    await checkEmail('a@once.example', { lookup: l, now: () => NOW });
    await checkEmail('b@once.example', { lookup: l, now: () => NOW });
    expect(mx).toHaveBeenCalledTimes(1);
  });
  it('is case-insensitive and ignores surrounding spaces', async () => {
    expect((await check('  Sarah@SMILE.example ')).status).toBe('ok');
  });
});

describe('checkEmail: does the address belong to this business?', () => {
  it('an address on the business\'s own website domain is ok (www and subdomains count)', async () => {
    expect((await check('sarah@smile.example', {}, { website: 'http://smile.example' })).status).toBe('ok');
    expect((await check('sarah@mail.smile.example', {}, { website: 'https://www.smile.example' })).status).toBe('ok');
  });
  it('an address on ANOTHER company\'s domain (the web designer, a supplier) is not verified', async () => {
    const r = await check('hello@webagency.example', {}, { website: 'https://smile.example' });
    expect(r.status).toBe('risky');
    expect(r.reasons.join()).toMatch(/another company|webagency\.example/i);
  });
  it('with no business website to compare against, a company address is not verified', async () => {
    const r = await check('info@smile.example', {}, {});
    expect(r.status).toBe('risky');
    expect(r.reasons.join()).toMatch(/no business website/i);
  });
});

describe('checkEmail: addresses nobody reads', () => {
  it('no-reply and placeholder addresses are bad', async () => {
    for (const e of ['noreply@smile.example', 'no-reply@smile.example', 'donotreply@smile.example', 'mailer-daemon@smile.example', 'example@smile.example', 'yourname@smile.example', 'your@email.com', 'user@domain.com', 'john.doe@example.com', 'name@company.com']) {
      expect((await check(e)).status, e).toBe('bad');
    }
  });
  it('a domain that publishes "no mail accepted" (null MX) is bad', async () => {
    const r = await check('sarah@nullmx.example', { mx: async () => [''] }, { website: 'https://nullmx.example' });
    expect(r.status).toBe('bad');
    expect(r.reasons.join()).toMatch(/does not accept mail/i);
  });
});

describe('isSendable', () => {
  it('only a current, ok check may be emailed', async () => {
    const ok = await check('sarah@smile.example');
    expect(ok.v).toBe(EMAIL_CHECK_VERSION);
    expect(isSendable(ok)).toBe(true);
    expect(isSendable(await check('hello@webagency.example'))).toBe(false);
    expect(isSendable(undefined)).toBe(false);
    expect(isSendable({ ...ok, v: undefined })).toBe(false); // checked under the old, looser rules
  });
});

describe('approvable: only ownership doubts can be overridden by a person', () => {
  it('an address on another company\'s domain, an unproven free mailbox, and no website to compare are approvable', async () => {
    expect((await check('x@agency.example', {}, { website: 'https://smile.example' })).approvable).toBe(true);
    expect((await check('smilecare@gmail.com', {}, { website: 'https://smile.example', foundOnSite: false })).approvable).toBe(true);
    expect((await check('info@smile.example', {}, {})).approvable).toBe(true);
  });
  it('a mail-server problem, a bad address or an ok address is NOT approvable', async () => {
    expect((await check('a@site.example', { mx: async () => [], hasAddress: async () => true }, { website: 'https://site.example' })).approvable).toBeFalsy();   // no mail server record
    expect((await check('a@slow.example', { mx: async () => { throw dnsError('ETIMEOUT'); } }, { website: 'https://slow.example' })).approvable).toBeFalsy(); // lookup failed
    expect((await check('x@mailinator.com')).approvable).toBeFalsy();
    expect((await check('noreply@smile.example')).approvable).toBeFalsy();
    expect((await check('sarah@smile.example')).approvable).toBeFalsy();
  });
});

describe('canSend', () => {
  const risky: EmailCheck = { status: 'risky', kind: 'personal', reasons: ['on another company\'s domain'], checkedAt: 't', v: EMAIL_CHECK_VERSION, approvable: true };
  const approval = { email: 'x@agency.example', at: 't' };
  it('a verified email is sendable with no approval', () => expect(canSend({ ...risky, status: 'ok' }, undefined, 'x@agency.example')).toBe(true));
  it('an approvable email is sendable once the person approved THAT address', () => {
    expect(canSend(risky, approval, 'x@agency.example')).toBe(true);
    expect(canSend(risky, approval, 'X@Agency.example')).toBe(true);        // same address, different case
    expect(canSend(risky, undefined, 'x@agency.example')).toBe(false);
  });
  it('an approval for a different address does nothing (the lead\'s email changed)', () => {
    expect(canSend(risky, approval, 'other@agency.example')).toBe(false);
  });
  it('an approval never overrides a bad address, a non-approvable risk, or a check under old rules', () => {
    expect(canSend({ ...risky, status: 'bad' }, approval, 'x@agency.example')).toBe(false);
    expect(canSend({ ...risky, approvable: false }, approval, 'x@agency.example')).toBe(false);
    expect(canSend({ ...risky, v: undefined }, approval, 'x@agency.example')).toBe(false);
  });
});

describe('pickEmail', () => {
  it('prefers an address on the business\'s own domain over an agency\'s or a free one', () => {
    expect(pickEmail(['design@webagency.example', 'info@smile.example', 'sarah@smile.example'], 'https://www.smile.example')).toBe('sarah@smile.example');
    expect(pickEmail(['design@webagency.example', 'info@smile.example'], 'https://www.smile.example')).toBe('info@smile.example');
    expect(pickEmail(['design@webagency.example', 'smilecare@gmail.com'], 'https://smile.example')).toBe('smilecare@gmail.com');
    expect(pickEmail(['design@webagency.example'], 'https://smile.example')).toBe('design@webagency.example');
    expect(pickEmail([], 'https://smile.example')).toBeUndefined();
  });
});

describe('domainOf', () => {
  it('takes the part after the last @, lower-cased', () => {
    expect(domainOf('A@B.Example')).toBe('b.example');
    expect(domainOf('nope')).toBeUndefined();
  });
});

import { Resolver } from 'node:dns/promises';

/**
 * Is this address safe to email? Free and quiet: it never sends anything and never talks to the mail server, so it cannot
 * prove a mailbox exists. 'ok' (verified) needs ALL of these, and only 'ok' is ever given to GHL:
 *  - a real-looking address: valid, not a placeholder (yourname@), not a no-reply, not a throwaway service, not a typo;
 *  - a domain that accepts mail (has mail servers, and does not publish a "null MX" saying it accepts none);
 *  - an address that belongs to THIS business: on its own website's domain, or a free mailbox (gmail...) shown on its own website.
 * Anything else is 'risky' (not verified, held back) or 'bad' (certain to bounce).
 */
export { EMAIL_CHECK_VERSION, isSendable, canSend, type EmailKind, type EmailCheck, type EmailApproval } from './emailStatus';
import { EMAIL_CHECK_VERSION, FREEMAIL, type EmailKind, type EmailCheck } from './emailStatus';
export type MailLookup = { mx(domain: string): Promise<string[]>; hasAddress(domain: string): Promise<boolean> };

/** Shared inboxes: a team's front door, not a named person. Digits are ignored (office2@). */
const ROLE = new Set(`info information admin administrator office reception frontdesk front.desk enquiries enquiry inquiries inquiry contact contactus hello hi hey
  sales support service services help team mail email bookings booking appointments appointment accounts accounting billing reservations orders general
  manager marketing hr jobs careers webmaster`.split(/\s+/));

// Nobody reads these: no-reply senders and template placeholders left on a site.
const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|bounces?|postmaster)$/;
const PLACEHOLDER_LOCAL = new Set(`example test testing user username name yourname your youremail your.email email someone somebody firstname lastname first.last
  firstname.lastname john.doe jane.doe johndoe janedoe johnsmith john.smith xxx abc sample demo me you`.split(/\s+/));
const PLACEHOLDER_DOMAIN = new Set('example.com example.org example.net domain.com yourdomain.com yoursite.com website.com company.com mysite.com yourcompany.com'.split(' '));


const DISPOSABLE = new Set(`mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com 10minutemail.net tempmail.com temp-mail.org
  temp-mail.io throwawaymail.com yopmail.com yopmail.fr trashmail.com trashmail.net getnada.com nada.email maildrop.cc dispostable.com fakeinbox.com mintemail.com
  mohmal.com emailondeck.com mailnesia.com spamgourmet.com tempail.com tempinbox.com burnermail.io mailcatch.com moakt.com discard.email anonbox.net spambox.us
  getairmail.com mailtemp.net tmpmail.org tmpmail.net inboxbear.com tempr.email 33mail.com jetable.org`.split(/\s+/));

const TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com',
};

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export const domainOf = (email: string): string | undefined => {
  const i = email.lastIndexOf('@');
  return i > 0 ? email.slice(i + 1).trim().toLowerCase() : undefined;
};

/** Real DNS lookups, three seconds each, one try. */
export function dnsLookup(): MailLookup {
  const r = new Resolver({ timeout: 3000, tries: 1 });
  return {
    mx: async d => (await r.resolveMx(d)).sort((a, b) => a.priority - b.priority).map(m => m.exchange),
    hasAddress: async d => {
      const [a, aaaa] = await Promise.allSettled([r.resolve4(d), r.resolve6(d)]);
      return (a.status === 'fulfilled' && a.value.length > 0) || (aaaa.status === 'fulfilled' && aaaa.value.length > 0);
    },
  };
}

type Verdict = { kind: 'mail' | 'none' | 'null' | 'web-only' | 'unknown' };
const byDomain = new Map<string, Promise<Verdict>>();
const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'EBADNAME']);

function mailServers(domain: string, l: MailLookup): Promise<Verdict> {
  // keyed by lookup too, so tests with different fakes never share an answer
  const key = `${domain}|${(l as { id?: string }).id ?? ''}`;
  let p = byDomain.get(key);
  if (!p) {
    p = (async (): Promise<Verdict> => {
      try {
        const mx = await l.mx(domain);
        // RFC 7505 "null MX": a single empty exchange means the domain accepts no mail at all
        if (mx.length && mx.every(x => !x || x === '.')) return { kind: 'null' };
        if (mx.length) return { kind: 'mail' };
      } catch (e) {
        if (!NOT_FOUND.has((e as { code?: string }).code ?? '')) return { kind: 'unknown' };
      }
      try { return { kind: (await l.hasAddress(domain)) ? 'web-only' : 'none' }; } catch { return { kind: 'unknown' }; }
    })();
    byDomain.set(key, p);
  }
  return p;
}

const siteHost = (website?: string) => (website ?? '').trim().toLowerCase().match(/^(?:[a-z]+:\/\/)?([^/?#:]+)/)?.[1]?.replace(/^www\./, '');
/** Same business domain: equal, or one is a subdomain of the other (mail.smile.com / smile.com). */
const sameSite = (domain: string, site?: string) => !!site && (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`));

/** The best address to use from several found: the business's own domain (a named person first), then a free mailbox, then anything else. */
export function pickEmail(emails: string[], website?: string): string | undefined {
  const site = siteHost(website);
  const rank = (e: string) => {
    const d = domainOf(e) ?? '', local = e.slice(0, e.lastIndexOf('@')).toLowerCase();
    if (sameSite(d, site)) return ROLE.has(local.replace(/\d+$/, '')) ? 1 : 0;
    return FREEMAIL.has(d) ? 2 : 3;
  };
  return [...emails].sort((a, b) => rank(a) - rank(b))[0];
}

export async function checkEmail(raw: string, opts: { lookup?: MailLookup; now?: () => Date; website?: string; foundOnSite?: boolean } = {}): Promise<EmailCheck> {
  const email = (raw ?? '').trim().toLowerCase();
  const checkedAt = (opts.now ?? (() => new Date()))().toISOString();
  const done = (status: EmailCheck['status'], kind: EmailKind, reasons: string[], approvable = false): EmailCheck => ({ status, kind, reasons, checkedAt, v: EMAIL_CHECK_VERSION, ...(approvable ? { approvable } : {}) });

  if (!ADDRESS.test(email) || email.includes('..') || email.length > 254) return done('bad', 'personal', ['not a valid email address']);
  const domain = domainOf(email)!;
  const local = email.slice(0, email.lastIndexOf('@'));

  if (NO_REPLY.test(local)) return done('bad', 'role', ['a no-reply or system address: nobody reads it']);
  if (PLACEHOLDER_LOCAL.has(local) || PLACEHOLDER_DOMAIN.has(domain)) return done('bad', 'personal', ['a placeholder address from a website template, not a real one']);
  if (DISPOSABLE.has(domain)) return done('bad', 'personal', ['throwaway inbox service']);
  if (TYPOS[domain]) return done('bad', 'personal', [`looks like a typo of ${TYPOS[domain]}`]);
  const site = siteHost(opts.website);
  if (FREEMAIL.has(domain)) {
    return opts.foundOnSite
      ? done('ok', 'freemail', ['uses a free mailbox provider, shown on the business\'s own website'])
      : done('risky', 'freemail', [`a free mailbox (${domain}) that is not shown on the business's own website, so it may not be theirs`], true);
  }

  const kind: EmailKind = ROLE.has(local.replace(/\d+$/, '')) ? 'role' : 'personal';
  const notes = kind === 'role' ? [`shared inbox (${local}@), not a named person`] : [];

  const v = await mailServers(domain, opts.lookup ?? defaultLookup());
  if (v.kind === 'none') return done('bad', kind, ['no mail server for this domain', ...notes]);
  if (v.kind === 'null') return done('bad', kind, ['the domain says it does not accept mail (null MX)', ...notes]);
  if (v.kind === 'web-only') return done('risky', kind, ['no mail server record; mail would go to the website server', ...notes]);
  if (v.kind === 'unknown') return done('risky', kind, ['could not check the mail server (lookup failed or timed out)', ...notes]);
  if (!site) return done('risky', kind, ['no business website to confirm this address belongs to them', ...notes], true);
  if (!sameSite(domain, site)) return done('risky', kind, [`on another company's domain (${domain}), not this business's (${site}): often the web designer or a supplier`, ...notes], true);
  return done('ok', kind, notes);
}

let shared: MailLookup | undefined;
const defaultLookup = () => (shared ??= dnsLookup());

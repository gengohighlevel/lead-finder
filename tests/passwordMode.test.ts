import { describe, it, expect } from 'vitest';
import { hostedConfig } from '../lib/cfAccess';
import { gateRequest, type GateInput } from '../lib/hostedGate';
import { signSession, base32Encode } from '../lib/auth';

const SECRET = 's'.repeat(48);
const TOTP = base32Encode(Buffer.from('12345678901234567890'));
const ENV = { APP_HOSTS: 'dashboard.example.com', AUTH_MODE: 'password', SESSION_SECRET: SECRET, ADMIN_EMAIL: 'Owner@Example.com', ADMIN_PASSWORD_HASH: 'scrypt:32768:8:1:c2FsdA:aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g', ADMIN_TOTP_SECRET: TOTP };
const NOW = 1_700_000_000_000;

describe('hostedConfig: password mode', () => {
  it('is password mode only when AUTH_MODE says so; the default stays Cloudflare Access', () => {
    expect(hostedConfig({ APP_HOSTS: 'a.com' })).toMatchObject({ hosted: true, mode: 'access' });
    expect(hostedConfig(ENV)).toMatchObject({ hosted: true, mode: 'password', complete: true, hosts: ['dashboard.example.com'] });
  });
  it('reads the account settings, lower-casing the email', () => {
    const c = hostedConfig({ ...ENV, RECOVERY_CODE_HASHES: `${'a'.repeat(64)}, ${'b'.repeat(64)}` });
    expect(c).toMatchObject({ password: { email: 'owner@example.com', secret: SECRET, totpSecret: TOTP, recoveryHashes: ['a'.repeat(64), 'b'.repeat(64)] } });
  });
  it('is incomplete (so nothing is served) when any required setting is missing or weak', () => {
    for (const patch of [{ SESSION_SECRET: 'short' }, { SESSION_SECRET: '' }, { ADMIN_EMAIL: 'not-an-email' }, { ADMIN_EMAIL: '' }, { ADMIN_PASSWORD_HASH: 'plaintext' }, { ADMIN_PASSWORD_HASH: '' }, { ADMIN_PASSWORD_HASH: 'scrypt$32768$8$1$c2FsdA$aGFzaA' },
      { ADMIN_TOTP_SECRET: '' }, { ADMIN_TOTP_SECRET: 'abc1!' }, { ADMIN_TOTP_SECRET: 'ABCD' }]) {
      expect(hostedConfig({ ...ENV, ...patch }), JSON.stringify(patch)).toMatchObject({ hosted: true, mode: 'password', complete: false });
    }
  });
  it('ignores malformed recovery hashes', () => {
    expect(hostedConfig({ ...ENV, RECOVERY_CODE_HASHES: 'zzz, ' + 'c'.repeat(64) })).toMatchObject({ password: { recoveryHashes: ['c'.repeat(64)] } });
  });
});

describe('the front door in password mode', () => {
  const base: GateInput = { method: 'GET', host: 'dashboard.example.com', origin: null, secFetchSite: null, contentType: null, path: '/api/leads', accessToken: null, cookie: null };
  const cookieFor = (email = 'owner@example.com', secret = SECRET, at = NOW, ttl = 3600_000) => `lf_session=${signSession({ email }, secret, at, ttl)}`;
  const gate = (o: Partial<GateInput>, env: Record<string, string | undefined> = ENV) => gateRequest({ ...base, ...o }, env, undefined, NOW + 1000);

  it('serves a request with a valid session cookie', async () => {
    expect(await gate({ cookie: cookieFor() })).toEqual({ ok: true, email: 'owner@example.com' });
    expect(await gate({ cookie: `other=1; ${cookieFor()}; theme=dark` })).toMatchObject({ ok: true });
  });
  it('an API call without a session is a 401; a page is sent to the login', async () => {
    expect(await gate({})).toMatchObject({ ok: false, status: 401 });
    expect(await gate({ path: '/', cookie: null })).toMatchObject({ ok: false, status: 302, redirect: '/login' });
    expect(await gate({ path: '/library', cookie: 'x=y' })).toMatchObject({ ok: false, status: 302, redirect: '/login' });
  });
  it('refuses a forged, expired, wrong-secret or wrong-person session', async () => {
    expect(await gate({ cookie: 'lf_session=abc.def' })).toMatchObject({ ok: false, status: 401 });
    expect(await gate({ cookie: cookieFor('owner@example.com', SECRET, NOW - 7200_000, 3600_000) })).toMatchObject({ ok: false });       // expired
    expect(await gate({ cookie: cookieFor('owner@example.com', 'z'.repeat(48)) })).toMatchObject({ ok: false });                         // signed with another secret
    expect(await gate({ cookie: cookieFor('someone@else.com') })).toMatchObject({ ok: false });                                          // valid signature, not the owner
  });
  it('the login page, the login endpoint and the health check are open; everything else is not', async () => {
    expect((await gate({ path: '/login' })).ok).toBe(true);
    expect((await gate({ path: '/api/auth/login', method: 'POST', contentType: 'application/json', origin: 'https://dashboard.example.com', secFetchSite: 'same-origin' })).ok).toBe(true);
    expect((await gate({ path: '/api/health' })).ok).toBe(true);
    expect((await gate({ path: '/api/auth/me' })).ok).toBe(false);
    expect((await gate({ path: '/api/stats' })).ok).toBe(false);
  });
  it('the login endpoint still refuses another website and a non-JSON body', async () => {
    expect(await gate({ path: '/api/auth/login', method: 'POST', contentType: 'application/json', origin: 'https://evil.example', secFetchSite: 'cross-site' })).toMatchObject({ ok: false, status: 403 });
    expect(await gate({ path: '/api/auth/login', method: 'POST', contentType: 'text/plain', origin: 'https://dashboard.example.com' })).toMatchObject({ ok: false, status: 415 });
  });
  it('a change with a valid session must still be same-origin JSON', async () => {
    expect(await gate({ method: 'POST', cookie: cookieFor(), contentType: 'application/json', origin: 'https://evil.example', secFetchSite: 'cross-site' })).toMatchObject({ ok: false, status: 403 });
    expect((await gate({ method: 'POST', cookie: cookieFor(), contentType: 'application/json', origin: 'https://dashboard.example.com', secFetchSite: 'same-origin' })).ok).toBe(true);
  });
  it('a host that is not configured is refused before anything else', async () => {
    expect(await gate({ host: 'evil.example.com', cookie: cookieFor() })).toMatchObject({ ok: false, status: 403 });
  });
  it('fails CLOSED when the account settings are incomplete: even the login page is not served', async () => {
    expect(await gate({ path: '/login' }, { ...ENV, SESSION_SECRET: 'short' })).toMatchObject({ ok: false, status: 503 });
    expect(await gate({ cookie: cookieFor() }, { ...ENV, ADMIN_TOTP_SECRET: '' })).toMatchObject({ ok: false, status: 503 });
    expect((await gate({ path: '/api/health' }, { ...ENV, SESSION_SECRET: 'short' })).ok).toBe(true);     // the container health check still answers
  });
  it('Cloudflare Access mode is unchanged', async () => {
    expect(await gateRequest({ ...base, accessToken: null }, { APP_HOSTS: 'dashboard.example.com', CF_ACCESS_TEAM: 'team', CF_ACCESS_AUD: 'a'.repeat(64) }, async () => ({ ok: false, reason: 'no' }), NOW)).toMatchObject({ ok: false, status: 401 });
  });
});

describe('the login page can show its wallpaper', () => {
  const base: GateInput = { method: 'GET', host: 'dashboard.example.com', origin: null, secFetchSite: null, contentType: null, path: '/', accessToken: null, cookie: null };
  const gate = (path: string) => gateRequest({ ...base, path }, ENV, undefined, NOW + 1000);
  it('serves only the default picture before sign-in (no private data in them)', async () => {
    expect(await gate('/background.jpg')).toEqual({ ok: true });
  });
  it('everything else, including your own wallpapers, still needs the login', async () => {
    for (const p of ['/backgrounds/macos/d169c5f506.jpg', '/background.jpg.bak', '/api/leads', '/']) expect(await gate(p), p).toMatchObject({ ok: false });
  });
  it('only GET: no change can be made through these paths', async () => {
    expect(await gateRequest({ ...base, path: '/background.jpg', method: 'POST', contentType: 'application/json', origin: 'https://dashboard.example.com' }, ENV, undefined, NOW + 1000)).toMatchObject({ ok: false });
  });
});

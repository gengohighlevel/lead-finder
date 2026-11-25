import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { hashPassword, totpCode, base32Encode, hashRecoveryCode, verifySession } from '../lib/auth';

const SECRET = 'k'.repeat(48);
const TOTP = base32Encode(Buffer.from('12345678901234567890'));
const PASSWORD = 'a long passphrase for the test';
const RECOVERY = 'ABCDE-FGHIJ';
let POST_LOGIN: (r: Request) => Promise<Response>, POST_LOGOUT: (r: Request) => Promise<Response>, GET_ME: (r: Request) => Promise<Response>;
let resetLimiter: () => void;

const NOW = 1_700_000_000_000;
const body = (o: object, ip = '203.0.113.5') => new Request('https://dashboard.example.com/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `9.9.9.9, ${ip}` }, body: JSON.stringify(o) });
const good = () => ({ email: 'Owner@Example.com', password: PASSWORD, code: totpCode(TOTP, NOW) });

beforeAll(async () => {
  process.env.APP_HOSTS = 'dashboard.example.com'; process.env.AUTH_MODE = 'password';
  process.env.SESSION_SECRET = SECRET; process.env.ADMIN_EMAIL = 'owner@example.com'; process.env.ADMIN_TOTP_SECRET = TOTP;
  process.env.ADMIN_PASSWORD_HASH = await hashPassword(PASSWORD);
  process.env.RECOVERY_CODE_HASHES = hashRecoveryCode(RECOVERY);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  ({ POST: POST_LOGIN } = await import('../app/api/auth/login/route'));
  ({ POST: POST_LOGOUT } = await import('../app/api/auth/logout/route'));
  ({ GET: GET_ME } = await import('../app/api/auth/me/route'));
  ({ resetLoginLimiter: resetLimiter } = await import('../lib/authState'));
});
beforeEach(async () => { resetLimiter(); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); for (const k of ['APP_HOSTS', 'AUTH_MODE', 'SESSION_SECRET', 'ADMIN_EMAIL', 'ADMIN_TOTP_SECRET', 'ADMIN_PASSWORD_HASH', 'RECOVERY_CODE_HASHES']) Reflect.deleteProperty(process.env, k); });

describe('POST /api/auth/login', () => {
  it('signs in with email, password and an authenticator code, and sets a locked-down session cookie', async () => {
    const res = await POST_LOGIN(body(good()));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^lf_session=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=strict', 'Path=/']) expect(cookie, flag).toContain(flag);
    expect(cookie).toMatch(/Max-Age=\d+/i);
    const token = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
    expect(verifySession(token, SECRET, NOW + 1000)?.email).toBe('owner@example.com');
  });
  it('gives one identical answer for a wrong email, a wrong password and a wrong code (so none can be guessed alone)', async () => {
    const wrongs = [{ ...good(), email: 'nobody@example.com' }, { ...good(), password: 'not the password' }, { ...good(), code: '000000' }, { ...good(), code: undefined }, { email: 'x' }, {}];
    const answers = [];
    for (const w of wrongs) { const r = await POST_LOGIN(body(w, `198.51.100.${answers.length + 1}`)); expect(r.status).toBe(401); expect(r.headers.get('set-cookie')).toBeNull(); answers.push(await r.json()); }
    expect(new Set(answers.map(a => a.error)).size).toBe(1);
    expect(answers[0].error).toMatch(/wrong email, password or code/i);
  });
  it('an authenticator code works once: replaying it is refused', async () => {
    vi.setSystemTime(NOW + 600_000);
    const code = totpCode(TOTP, NOW + 600_000);
    expect((await POST_LOGIN(body({ ...good(), code }, '198.51.100.20'))).status).toBe(200);
    expect((await POST_LOGIN(body({ ...good(), code }, '198.51.100.21'))).status).toBe(401);
  });
  it('a recovery code signs in once, says so, and is then used up', async () => {
    const r1 = await POST_LOGIN(body({ email: 'owner@example.com', password: PASSWORD, recovery: 'abcde fghij' }, '198.51.100.30'));
    expect(r1.status).toBe(200);
    expect((await r1.json()).recoveryUsed).toBe(true);
    expect((await POST_LOGIN(body({ email: 'owner@example.com', password: PASSWORD, recovery: RECOVERY }, '198.51.100.31'))).status).toBe(401);
  });
  it('a recovery code does not work without the right password', async () => {
    expect((await POST_LOGIN(body({ email: 'owner@example.com', password: 'nope', recovery: RECOVERY }, '198.51.100.32'))).status).toBe(401);
  });
  it('locks an address out after repeated failures, with a wait time, even if the next try is correct', async () => {
    for (let i = 0; i < 5; i++) expect((await POST_LOGIN(body({ ...good(), password: 'bad' }, '198.51.100.40'))).status).toBe(401);
    const locked = await POST_LOGIN(body(good(), '198.51.100.40'));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(800);
    expect((await locked.json()).error).toMatch(/too many attempts/i);
    expect((await POST_LOGIN(body({ ...good(), code: totpCode(TOTP, NOW) }, '198.51.100.41'))).status).toBe(200);     // another address is unaffected
  });
  it('uses the address Caddy saw (the LAST forwarded value), so a client cannot dodge the lock by faking the first', async () => {
    for (let i = 0; i < 5; i++) await POST_LOGIN(new Request('https://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `1.2.3.${i}, 198.51.100.50` }, body: JSON.stringify({ ...good(), password: 'bad' }) }));
    const r = await POST_LOGIN(new Request('https://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '77.7.7.7, 198.51.100.50' }, body: JSON.stringify(good()) }));
    expect(r.status).toBe(429);
  });
  it('refuses junk bodies without crashing', async () => {
    for (const raw of ['', 'not json', '[]', 'null', '{"email":5,"password":{},"code":[]}']) {
      const r = await POST_LOGIN(new Request('https://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.60' }, body: raw }));
      expect(r.status, raw).toBe(401);
    }
  });
});

describe('POST /api/auth/logout and GET /api/auth/me', () => {
  it('logout clears the cookie', async () => {
    const res = await POST_LOGOUT(new Request('https://x/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/lf_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
  it('me says who is signed in, and 401 when nobody is', async () => {
    const login = await POST_LOGIN(body({ ...good(), code: totpCode(TOTP, NOW) }, '198.51.100.70'));
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const ok = await GET_ME(new Request('https://x/api/auth/me', { headers: { cookie } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ email: 'owner@example.com' });
    expect((await GET_ME(new Request('https://x/api/auth/me'))).status).toBe(401);
    expect((await GET_ME(new Request('https://x/api/auth/me', { headers: { cookie: 'lf_session=abc.def' } }))).status).toBe(401);
  });
});

describe('not hosted in password mode', () => {
  it('the login endpoint does not exist on the local app', async () => {
    const keep = process.env.AUTH_MODE; process.env.AUTH_MODE = 'access';
    expect((await POST_LOGIN(body(good()))).status).toBe(404);
    process.env.AUTH_MODE = keep;
  });
});

import crypto from 'node:crypto';

/**
 * Login building blocks for the hosted app: password hashing (scrypt), authenticator-app codes (RFC 6238 TOTP), signed
 * session cookies and one-time recovery codes. Only Node's own crypto is used. There is no sign-up: the one account is made
 * on the owner's own computer by scripts/make-login.mjs and lives in the server's environment.
 */

// ---- base32 (RFC 4648, no padding): the format authenticator apps use for secrets ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]*$/.test(clean)) throw new Error('not base32');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const randomBase32 = (n: number): string => base32Encode(crypto.randomBytes(Math.ceil((n * 5) / 8) + 1)).slice(0, n);

// ---- TOTP ----
const STEP_MS = 30_000;
function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
export const totpCode = (secretB32: string, nowMs: number): string => hotp(base32Decode(secretB32), Math.floor(nowMs / STEP_MS));

/** The step a code matches (this one or one either side), or undefined. `lastStep`: a step already used, so a code works once. */
export function verifyTotp(secretB32: string, code: string, nowMs: number, lastStep?: number): number | undefined {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return undefined;
  let key: Buffer; try { key = base32Decode(secretB32); } catch { return undefined; }
  const base = Math.floor(nowMs / STEP_MS);
  let matched: number | undefined;
  for (const off of [-1, 0, 1]) {
    const step = base + off;
    const ok = crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code));
    if (ok && (lastStep === undefined || step > lastStep) && matched === undefined) matched = step;
  }
  return matched;
}

// ---- passwords ----
const SCRYPT = { N: 32768, r: 8, p: 1, keyLen: 32, maxmem: 128 * 1024 * 1024 };
const scrypt = (pw: string, salt: Buffer, N: number, r: number, p: number, keyLen: number) =>
  new Promise<Buffer>((res, rej) => crypto.scrypt(pw.normalize('NFKC'), salt, keyLen, { N, r, p, maxmem: SCRYPT.maxmem }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLen);
  // ":" separators, never "$": Docker Compose and shells treat "$" in a settings file as a variable and would mangle the hash
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [alg, n, r, p, s, h] = (stored ?? '').split(':');
    if (alg !== 'scrypt' || !s || !h) return false;
    const N = Number(n), R = Number(r), P = Number(p);
    if (!Number.isInteger(N) || N < 2 || N > 1 << 20 || (N & (N - 1)) !== 0 || !Number.isInteger(R) || R < 1 || R > 16 || !Number.isInteger(P) || P < 1 || P > 4) return false;
    const want = Buffer.from(h, 'base64url');
    if (want.length < 16) return false;
    const got = await scrypt(password ?? '', Buffer.from(s, 'base64url'), N, R, P, want.length);
    return crypto.timingSafeEqual(got, want);
  } catch { return false; }
}

// ---- sessions: a signed cookie value, valid until it expires (never more than 24 hours) ----
const MAX_SESSION_MS = 24 * 3600_000;
const sign = (payload: string, secret: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function signSession(s: { email: string }, secret: string, nowMs: number, ttlMs: number): string {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const i = Math.floor(nowMs / 1000), x = Math.floor((nowMs + Math.min(Math.max(ttlMs, 1000), MAX_SESSION_MS)) / 1000);
  const payload = Buffer.from(JSON.stringify({ e: s.email.trim().toLowerCase(), i, x, n: crypto.randomBytes(9).toString('base64url') })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}
export function verifySession(token: string | null | undefined, secret: string, nowMs: number): { email: string; exp: number } | undefined {
  if (typeof token !== 'string' || !secret || secret.length < 32) return undefined;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  const want = Buffer.from(sign(parts[0], secret)), got = Buffer.from(parts[1]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return undefined;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { e?: unknown; i?: unknown; x?: unknown };
    if (typeof p.e !== 'string' || typeof p.i !== 'number' || typeof p.x !== 'number') return undefined;
    if (nowMs >= p.x * 1000 || p.x - p.i > MAX_SESSION_MS / 1000 + 5) return undefined;
    return { email: p.e, exp: p.x * 1000 };
  } catch { return undefined; }
}

// ---- recovery codes: for a lost phone. Each works once. ----
export const normalizeRecoveryCode = (s: string): string => (s ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
export const hashRecoveryCode = (s: string): string => crypto.createHash('sha256').update(normalizeRecoveryCode(s)).digest('hex');
export function generateRecoveryCodes(n = 8): string[] {
  const out = new Set<string>();
  while (out.size < n) { const c = randomBase32(10); out.add(`${c.slice(0, 5)}-${c.slice(5)}`); }
  return [...out];
}

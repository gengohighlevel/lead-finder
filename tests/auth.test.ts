import { describe, it, expect } from 'vitest';
import {
  base32Encode, base32Decode, totpCode, verifyTotp, hashPassword, verifyPassword, signSession, verifySession,
  generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, randomBase32,
} from '../lib/auth';

describe('base32', () => {
  it('round-trips and matches RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');       // case, spaces and dashes ignored
    const b = Buffer.from([0, 255, 1, 128, 7, 9, 200]); expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
  it('rejects characters that are not base32', () => expect(() => base32Decode('abc1!')).toThrow());
});

describe('totp (the official RFC 6238 test values, SHA-1, 6 digits)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the published codes', () => {
    for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']] as const) {
      expect(totpCode(secret, t * 1000), String(t)).toBe(code);
    }
  });
  it('accepts the current code and one step either side, nothing further', () => {
    const now = 1234567890_000;
    expect(verifyTotp(secret, '005924', now)).toBeDefined();
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBeDefined();
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now)).toBeDefined();
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBeUndefined();
    expect(verifyTotp(secret, '000000', now)).toBeUndefined();
  });
  it('returns the matched step so a code cannot be used twice', () => {
    const now = 1234567890_000, step = verifyTotp(secret, '005924', now)!;
    expect(verifyTotp(secret, '005924', now, step)).toBeUndefined();         // same step already used
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now, step)).toBeDefined(); // a later step is fine
  });
  it('refuses malformed codes', () => { for (const c of ['', '12345', '1234567', 'abcdef', '12 3456', null as any]) expect(verifyTotp(secret, c, 1234567890_000), String(c)).toBeUndefined(); });
});

describe('passwords (scrypt)', () => {
  it('hashes with a random salt and verifies only the right password', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(h).not.toContain('$');                     // Docker Compose would treat "$" in a settings file as a variable
    expect(h).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
  it('treats a malformed or empty stored hash as "no match", never as an error or a match', async () => {
    for (const bad of ['', 'x', 'scrypt:1:2:3', 'scrypt:a:b:c:d:e', 'bcrypt:12:aaaa:bbbb', 'scrypt$32768$8$1$c2FsdA$aGFzaA', undefined as any]) expect(await verifyPassword('anything', bad), String(bad)).toBe(false);
  });
});

describe('sessions (signed cookies)', () => {
  const secret = 'x'.repeat(40), now = 1_700_000_000_000;
  it('signs a session and reads it back until it expires', () => {
    const t = signSession({ email: 'Owner@Example.com' }, secret, now, 3600_000);
    expect(verifySession(t, secret, now + 1000)).toMatchObject({ email: 'owner@example.com' });
    expect(verifySession(t, secret, now + 3600_000 + 1)).toBeUndefined();
  });
  it('refuses a token that was changed, signed with another secret, or is garbage', () => {
    const t = signSession({ email: 'a@b.co' }, secret, now, 3600_000);
    const [p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ e: 'admin@evil.com', i: now / 1000, x: now / 1000 + 99999, n: 'z' })).toString('base64url');
    for (const bad of [`${forged}.${s}`, `${p}.${s.slice(0, -2)}AA`, `${p}.`, '.', '', 'a.b.c', 'garbage']) expect(verifySession(bad, secret, now + 1), bad).toBeUndefined();
    expect(verifySession(t, 'y'.repeat(40), now + 1)).toBeUndefined();
    expect(verifySession(null as any, secret, now)).toBeUndefined();
  });
  it('never lives longer than 24 hours, whatever was asked for', () => {
    const t = signSession({ email: 'a@b.co' }, secret, now, 30 * 24 * 3600_000);
    expect(verifySession(t, secret, now + 24 * 3600_000 + 1000)).toBeUndefined();
    expect(verifySession(t, secret, now + 23 * 3600_000)).toBeDefined();
  });
  it('two sessions for the same person are different tokens', () => {
    expect(signSession({ email: 'a@b.co' }, secret, now, 1000)).not.toBe(signSession({ email: 'a@b.co' }, secret, now, 1000));
  });
  it('refuses to sign with a short secret', () => expect(() => signSession({ email: 'a@b.co' }, 'short', now, 1000)).toThrow());
});

describe('recovery codes', () => {
  it('makes 8 readable one-time codes and hashes them', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(new Set(codes).size).toBe(8);
    expect(hashRecoveryCode(codes[0])).toMatch(/^[a-f0-9]{64}$/);
  });
  it('normalises how a person types one (case, spaces, missing dash)', () => {
    const h = hashRecoveryCode('ABCDE-FGHIJ');
    for (const typed of ['abcde-fghij', ' ABCDE FGHIJ ', 'abcdefghij', 'ABCDE–FGHIJ']) expect(hashRecoveryCode(normalizeRecoveryCode(typed))).toBe(h);
    expect(normalizeRecoveryCode('abc')).toBe('ABC');
  });
});

describe('randomBase32', () => it('gives the requested number of base32 characters, different each time', () => {
  const a = randomBase32(32), b = randomBase32(32);
  expect(a).toMatch(/^[A-Z2-7]{32}$/); expect(a).not.toBe(b);
}));

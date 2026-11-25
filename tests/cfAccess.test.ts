import { describe, it, expect } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { verifyAccessToken, hostedConfig } from '../lib/cfAccess';

const TEAM = 'myteam', AUD = 'a'.repeat(64), ISS = `https://${TEAM}.cloudflareaccess.com`;
async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const other = await generateKeyPair('RS256');
  const sign = (o: { aud?: string; iss?: string; exp?: string | number; email?: string; key?: any; kid?: string } = {}) =>
    new SignJWT({ email: o.email ?? 'owner@example.com' }).setProtectedHeader({ alg: 'RS256', kid: o.kid ?? 'k1' }).setAudience(o.aud ?? AUD).setIssuer(o.iss ?? ISS)
      .setIssuedAt().setExpirationTime(o.exp ?? '10m').sign(o.key ?? privateKey);
  return { sign, keys: createLocalJWKSet({ keys: [jwk] }), other };
}

describe('verifyAccessToken', () => {
  it('accepts a good token and returns who logged in', async () => {
    const { sign, keys } = await setup();
    expect(await verifyAccessToken(await sign(), { team: TEAM, aud: AUD }, keys)).toEqual({ ok: true, email: 'owner@example.com' });
  });
  it('refuses a missing, empty or garbage token', async () => {
    const { keys } = await setup();
    for (const t of [undefined, null, '', 'abc', 'a.b.c']) expect((await verifyAccessToken(t as any, { team: TEAM, aud: AUD }, keys)).ok, String(t)).toBe(false);
  });
  it('refuses a token for another application (wrong audience) or another team (wrong issuer)', async () => {
    const { sign, keys } = await setup();
    expect((await verifyAccessToken(await sign({ aud: 'b'.repeat(64) }), { team: TEAM, aud: AUD }, keys)).ok).toBe(false);
    expect((await verifyAccessToken(await sign({ iss: 'https://evil.cloudflareaccess.com' }), { team: TEAM, aud: AUD }, keys)).ok).toBe(false);
  });
  it('refuses an expired token', async () => {
    const { sign, keys } = await setup();
    expect((await verifyAccessToken(await sign({ exp: Math.floor(Date.now() / 1000) - 60 }), { team: TEAM, aud: AUD }, keys)).ok).toBe(false);
  });
  it('refuses a token signed with a key Cloudflare did not publish (forged)', async () => {
    const { sign, keys, other } = await setup();
    expect((await verifyAccessToken(await sign({ key: other.privateKey }), { team: TEAM, aud: AUD }, keys)).ok).toBe(false);
    expect((await verifyAccessToken(await sign({ key: other.privateKey, kid: 'unknown' }), { team: TEAM, aud: AUD }, keys)).ok).toBe(false);
  });
  it('can limit who may log in to a list of emails, case-insensitively', async () => {
    const { sign, keys } = await setup();
    expect((await verifyAccessToken(await sign({ email: 'Owner@Example.com' }), { team: TEAM, aud: AUD, emails: ['owner@example.com'] }, keys)).ok).toBe(true);
    expect((await verifyAccessToken(await sign({ email: 'stranger@example.com' }), { team: TEAM, aud: AUD, emails: ['owner@example.com'] }, keys)).ok).toBe(false);
  });
});

describe('hostedConfig', () => {
  it('is off when APP_HOSTS is empty (the normal local app)', () => {
    expect(hostedConfig({})).toEqual({ hosted: false });
    expect(hostedConfig({ APP_HOSTS: ' , ' })).toEqual({ hosted: false });
  });
  it('is on with hosts, and complete only when the login settings are all present', () => {
    const base = { APP_HOSTS: 'Leads.Example.com, other.example.com', CF_ACCESS_TEAM: 'myteam', CF_ACCESS_AUD: AUD };
    expect(hostedConfig(base)).toMatchObject({ hosted: true, hosts: ['leads.example.com', 'other.example.com'], team: 'myteam', aud: AUD, complete: true });
    expect(hostedConfig({ ...base, ACCESS_EMAILS: 'A@x.com, b@x.com' })).toMatchObject({ emails: ['a@x.com', 'b@x.com'] });
    for (const missing of ['CF_ACCESS_TEAM', 'CF_ACCESS_AUD']) {
      const e: Record<string, string> = { ...base }; delete e[missing];
      expect(hostedConfig(e), missing).toMatchObject({ hosted: true, complete: false });
    }
  });
  it('rejects a team name that could point the check at another site', () => {
    expect(hostedConfig({ APP_HOSTS: 'a.com', CF_ACCESS_TEAM: 'evil.com/x', CF_ACCESS_AUD: AUD })).toMatchObject({ complete: false });
  });
});

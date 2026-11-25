import { describe, it, expect, vi } from 'vitest';
import { gateRequest } from '../lib/hostedGate';

const base = { method: 'GET', host: '127.0.0.1:3000', origin: null, secFetchSite: null, contentType: null, path: '/api/leads', accessToken: null as string | null };
const HOSTED = { APP_HOSTS: 'leads.example.com', CF_ACCESS_TEAM: 'myteam', CF_ACCESS_AUD: 'a'.repeat(64) };
const okVerify = vi.fn(async () => ({ ok: true as const, email: 'owner@example.com' }));
const noVerify = vi.fn(async () => ({ ok: false as const, reason: 'login token not valid' }));

describe('local mode (no APP_HOSTS): exactly the local rules, no login', () => {
  it('lets the local page through and refuses other hosts and cross-site changes', async () => {
    expect((await gateRequest(base, {})).ok).toBe(true);
    expect(await gateRequest({ ...base, host: 'evil.com' }, {})).toMatchObject({ ok: false, status: 403 });
    expect(await gateRequest({ ...base, method: 'POST', contentType: 'application/json', origin: 'https://evil.example' }, {})).toMatchObject({ ok: false, status: 403 });
  });
  it('never asks for a login token', async () => {
    const v = vi.fn(); await gateRequest(base, {}, v as any); expect(v).not.toHaveBeenCalled();
  });
});

describe('hosted mode', () => {
  const h = { ...base, host: 'leads.example.com', accessToken: 'tok' };
  it('serves a request with a valid Cloudflare Access login', async () => {
    expect(await gateRequest(h, HOSTED, okVerify)).toEqual({ ok: true, email: 'owner@example.com' });
    expect(okVerify).toHaveBeenCalledWith('tok', { team: 'myteam', aud: 'a'.repeat(64), emails: [] });
  });
  it('refuses with 401 when the login token is missing or not valid', async () => {
    expect(await gateRequest({ ...h, accessToken: null }, HOSTED, noVerify)).toMatchObject({ ok: false, status: 401 });
    expect(await gateRequest(h, HOSTED, noVerify)).toMatchObject({ ok: false, status: 401 });
  });
  it('refuses a host that is not configured, before it even looks at the login', async () => {
    const v = vi.fn(); expect(await gateRequest({ ...h, host: 'evil.example.com' }, HOSTED, v as any)).toMatchObject({ ok: false, status: 403 }); expect(v).not.toHaveBeenCalled();
  });
  it('fails CLOSED when the login settings are incomplete: nothing is served', async () => {
    for (const env of [{ APP_HOSTS: 'leads.example.com' }, { ...HOSTED, CF_ACCESS_AUD: '' }, { ...HOSTED, CF_ACCESS_TEAM: 'bad/team' }]) {
      expect(await gateRequest(h, env, okVerify), JSON.stringify(env)).toMatchObject({ ok: false, status: 503 });
    }
  });
  it('the local address works in hosted mode too only with a login (so a request that skipped Cloudflare is still refused)', async () => {
    expect(await gateRequest({ ...base, accessToken: null }, HOSTED, noVerify)).toMatchObject({ ok: false, status: 401 });
  });
  it('the health check needs no login (it returns nothing private) but still needs an allowed host', async () => {
    expect((await gateRequest({ ...base, path: '/api/health', accessToken: null }, HOSTED, noVerify)).ok).toBe(true);
    expect(await gateRequest({ ...base, host: 'evil.com', path: '/api/health' }, HOSTED, noVerify)).toMatchObject({ ok: false, status: 403 });
  });
  it('changes still need to be same-origin JSON on top of the login', async () => {
    expect(await gateRequest({ ...h, method: 'POST', contentType: 'application/json', origin: 'https://evil.example' }, HOSTED, okVerify)).toMatchObject({ ok: false, status: 403 });
    expect((await gateRequest({ ...h, method: 'POST', contentType: 'application/json', origin: 'https://leads.example.com', secFetchSite: 'same-origin' }, HOSTED, okVerify)).ok).toBe(true);
  });
  it('passes the allowed-emails list to the check', async () => {
    okVerify.mockClear(); await gateRequest(h, { ...HOSTED, ACCESS_EMAILS: 'A@x.com' }, okVerify);
    expect(okVerify).toHaveBeenCalledWith('tok', expect.objectContaining({ emails: ['a@x.com'] }));
  });
});

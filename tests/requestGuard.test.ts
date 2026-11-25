import { describe, it, expect } from 'vitest';
import { checkRequest } from '../lib/requestGuard';

const req = (o: Partial<Parameters<typeof checkRequest>[0]> = {}) => checkRequest({
  method: 'POST', host: '127.0.0.1:3000', origin: null, secFetchSite: null, contentType: 'application/json', ...o });

describe('host: the app answers only to its own local address (stops DNS rebinding)', () => {
  it('accepts 127.0.0.1, localhost and [::1], on any port', () => {
    for (const host of ['127.0.0.1:3000', 'localhost:3000', 'LOCALHOST:3100', '127.0.0.1', '[::1]:3000']) expect(req({ method: 'GET', host }).ok, host).toBe(true);
  });
  it('refuses any other host name, even when it points at this computer', () => {
    for (const host of ['attacker.example:3000', 'evil.com', '127.0.0.1.evil.com:3000', 'localhost.evil.com', '192.168.1.20:3000', '0.0.0.0:3000', '']) {
      expect(req({ method: 'GET', host }), host).toMatchObject({ ok: false, status: 403 });
    }
    expect(req({ method: 'GET', host: null })).toMatchObject({ ok: false, status: 403 });
  });
});

describe('changing things (POST) must come from this app\'s own page', () => {
  it('accepts a normal request from the page itself', () => {
    expect(req({ origin: 'http://127.0.0.1:3000', secFetchSite: 'same-origin' }).ok).toBe(true);
    expect(req({ origin: 'http://localhost:3000', host: 'localhost:3000', secFetchSite: 'same-origin' }).ok).toBe(true);
  });
  it('accepts a script with no Origin (curl, scripts/app) as long as it sends JSON', () => {
    expect(req().ok).toBe(true);
  });
  it('refuses a request from another website (cross-site), whatever the body', () => {
    expect(req({ origin: 'https://evil.example', secFetchSite: 'cross-site' })).toMatchObject({ ok: false, status: 403 });
    expect(req({ origin: 'https://evil.example' })).toMatchObject({ ok: false, status: 403 });          // Origin alone is enough
    expect(req({ secFetchSite: 'cross-site' })).toMatchObject({ ok: false, status: 403 });              // so is Sec-Fetch-Site alone
  });
  it('refuses another local app on a different port (same-site, not same-origin)', () => {
    expect(req({ origin: 'http://127.0.0.1:4000', secFetchSite: 'same-site' })).toMatchObject({ ok: false, status: 403 });
    expect(req({ origin: 'http://localhost:3000' })).toMatchObject({ ok: false, status: 403 });          // different host name than the one asked
  });
  it('refuses Origin: null (sandboxed pages, file://)', () => {
    expect(req({ origin: 'null' })).toMatchObject({ ok: false, status: 403 });
  });
  it('refuses a body that is not JSON: that is how a hostile page avoids a permission check', () => {
    for (const contentType of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null, '']) {
      expect(req({ contentType }), String(contentType)).toMatchObject({ ok: false, status: 415 });
    }
    expect(req({ contentType: 'Application/JSON; charset=utf-8' }).ok).toBe(true);
  });
  it('applies to every method that changes things', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(req({ method, origin: 'https://evil.example' }).ok, method).toBe(false);
  });
  it('reading (GET, HEAD) needs only the right host', () => {
    expect(req({ method: 'GET', contentType: null, origin: null }).ok).toBe(true);
    expect(req({ method: 'HEAD', contentType: null }).ok).toBe(true);
  });
  it('OPTIONS (a cross-site permission check) is refused: this app never allows cross-site use', () => {
    expect(req({ method: 'OPTIONS', origin: 'https://evil.example' })).toMatchObject({ ok: false, status: 403 });
  });
});

describe('hosted mode: extra allowed hosts from APP_HOSTS', () => {
  const cfg = { hosts: ['leads.example.com'] };
  const hosted = (o: Partial<Parameters<typeof checkRequest>[0]> = {}) => checkRequest({ method: 'POST', host: 'leads.example.com', origin: null, secFetchSite: null, contentType: 'application/json', ...o }, cfg);
  it('accepts the configured public host, with or without a port, and still accepts local names', () => {
    expect(hosted({ method: 'GET' }).ok).toBe(true);
    expect(hosted({ method: 'GET', host: 'LEADS.example.com:443' }).ok).toBe(true);
    expect(hosted({ method: 'GET', host: '127.0.0.1:3000' }).ok).toBe(true);
  });
  it('refuses every other name, including look-alikes and a different site on the same server', () => {
    for (const host of ['evil.example.com', 'leads.example.com.evil.com', 'xleads.example.com', 'example.com', 'attacker.example', '']) expect(hosted({ method: 'GET', host }), host).toMatchObject({ ok: false, status: 403 });
  });
  it('a change must come from that host\'s own page', () => {
    expect(hosted({ origin: 'https://leads.example.com', secFetchSite: 'same-origin' }).ok).toBe(true);
    expect(hosted({ origin: 'https://evil.example', secFetchSite: 'cross-site' })).toMatchObject({ ok: false, status: 403 });
    expect(hosted({ origin: 'https://evil.example' })).toMatchObject({ ok: false, status: 403 });
    expect(hosted({ contentType: 'text/plain' })).toMatchObject({ ok: false, status: 415 });
  });
  it('without configured hosts, nothing but the local names is allowed (unchanged)', () => {
    expect(checkRequest({ method: 'GET', host: 'leads.example.com', origin: null, secFetchSite: null, contentType: null })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ method: 'GET', host: 'leads.example.com', origin: null, secFetchSite: null, contentType: null }, { hosts: [] })).toMatchObject({ ok: false });
  });
});

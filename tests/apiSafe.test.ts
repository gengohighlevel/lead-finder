import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeRoute } from '../lib/apiSafe';
import { readJson, post, get } from '../app/components/api';

const mkReq = () => new Request('http://x', { method: 'POST', body: '{}' });

describe('safeRoute', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('passes a normal answer through untouched', async () => {
    const res = await safeRoute(async () => Response.json({ ok: 1 }))(mkReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
  });
  it('turns a thrown error into a JSON error answer instead of an empty 500', async () => {
    const res = await safeRoute(async () => { throw new TypeError('crawlPeoplePages is not a function'); })(mkReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('crawlPeoplePages is not a function');
  });
  it('handles a non-Error throw', async () => {
    const res = await safeRoute(async () => { throw 'boom'; })(mkReq());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
  });
});

describe('readJson / post / get (client)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (res: Response) => vi.stubGlobal('fetch', vi.fn(async () => res));

  it('reads a normal JSON answer', async () => {
    expect(await readJson(Response.json({ a: 1 }), '/api/x')).toEqual({ a: 1 });
  });
  it('explains an empty answer, naming the route and status, instead of "Unexpected end of JSON input"', async () => {
    await expect(readJson(new Response('', { status: 500 }), '/api/people')).rejects.toThrow(/\/api\/people.*500|500.*\/api\/people/);
    await expect(readJson(new Response('', { status: 500 }), '/api/people')).rejects.not.toThrow(/Unexpected end/);
  });
  it('explains an answer that is not JSON (e.g. an HTML error page)', async () => {
    await expect(readJson(new Response('<html>Internal Server Error</html>', { status: 502 }), '/api/score')).rejects.toThrow(/\/api\/score/);
  });
  it('post and get throw the server\'s own message when it sent one, and the helpful text when it sent nothing', async () => {
    stub(Response.json({ error: 'business type and a chosen place are required' }, { status: 400 }));
    await expect(post('/api/search', {})).rejects.toThrow('business type and a chosen place are required');
    stub(new Response('', { status: 500 }));
    await expect(get('/api/stats')).rejects.toThrow(/\/api\/stats/);
    stub(Response.json({ leads: [] }));
    expect(await post('/api/people', { ids: [] })).toEqual({ leads: [] });
  });
});

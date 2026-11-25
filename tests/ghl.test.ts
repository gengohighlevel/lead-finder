import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushToGhl } from '../lib/ghl';
import { EMAIL_CHECK_VERSION } from '../lib/emailStatus';
import { DEFAULT_GATE } from '../lib/emailGate';
import { normalizePolicy } from '../lib/outreachPolicy';
import type { Lead } from '../lib/db';

const lead = (id: number, extra: Partial<Lead> = {}): Lead => ({ id, name: `Biz${id}`, email: `b${id}@x.com`, phone: '555', website: 'https://x.com', signals: [], opener: 'hello', ...extra });
const ok = (b: any) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) }) as any;

beforeEach(() => { process.env.GHL_TOKEN = 'tok'; process.env.GHL_LOCATION_ID = 'loc'; });
afterEach(() => { vi.restoreAllMocks(); delete process.env.GHL_TOKEN; delete process.env.GHL_LOCATION_ID; });

describe('pushToGhl', () => {
  it('does not add an email that cannot receive mail to the contact, and says why in the note', async () => {
    const f = vi.fn(async (u: string, _i?: unknown) => ok(u.includes('upsert') ? { contact: { id: 'c1' } } : {}));
    vi.stubGlobal('fetch', f);
    const research = { country: 'us', ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: '2026-01-01T00:00:00Z', score: { total: 50, priority: 'C', confidence: 'Low', factors: {} },
      emailCheck: { status: 'bad', kind: 'personal', reasons: ['no mail server for this domain'], checkedAt: '2026-11-23T00:00:00Z' } } as any;
    await pushToGhl([lead(1, { research })], []);
    const upsert = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(upsert.email).toBeUndefined();
    const note = JSON.parse((f.mock.calls[1] as any)[1].body).body as string;
    expect(note).toContain('Email not added: b1@x.com cannot receive mail (no mail server for this domain).');
  });
  it('sends phone numbers in international format using the lead country, and keeps a number it cannot place as written', async () => {
    const f = vi.fn(async (u: string, _init?: unknown) => ok(u.includes('upsert') ? { contact: { id: 'c1' } } : {}));
    vi.stubGlobal('fetch', f);
    const research = { country: 'au', ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: '2026-01-01T00:00:00Z', score: { total: 50, priority: 'C', confidence: 'Low', factors: {} } } as any;
    await pushToGhl([lead(1, { phone: '0412 345 678', research }), lead(2, { phone: 'ask for Sam', research })], []);
    const bodies = f.mock.calls.filter(c => String(c[0]).includes('upsert')).map(c => JSON.parse((c[1] as any).body));
    expect(bodies[0].phone).toBe('+61412345678');
    expect(bodies[1].phone).toBe('ask for Sam');
  });
  it('upserts with correct request then posts opener note', async () => {
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c1' } } : {}));
    vi.stubGlobal('fetch', f);
    const r = await pushToGhl([lead(1)], ['icp-dentist']);
    expect(r).toEqual([{ id: 1, ok: true }]);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://services.leadconnectorhq.com/contacts/upsert');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers.Version).toBe('2021-07-28');
    // this lead's email was never verified, so it is not given to GHL (GHL could email it)
    expect(JSON.parse(init.body)).toEqual({ locationId: 'loc', name: 'Biz1', phone: '555', website: 'https://x.com', companyName: 'Biz1', tags: ['lead-finder', 'icp-dentist'], source: 'lead-finder' });
    const [nurl, ninit] = f.mock.calls[1] as any;
    expect(nurl).toBe('https://services.leadconnectorhq.com/contacts/c1/notes');
    expect(JSON.parse(ninit.body).body).toContain('hello');
  });
  it('one 422 fails only that row', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (!u.includes('upsert')) return ok({});
      n++;
      return n === 1 ? ({ ok: false, status: 422, text: async () => 'bad email', json: async () => ({}) } as any) : ok({ contact: { id: 'c2' } });
    }));
    const r = await pushToGhl([lead(1), lead(2)], []);
    expect(r[0]).toMatchObject({ id: 1, ok: false });
    expect(r[0].error).toContain('422');
    expect(r[1]).toEqual({ id: 2, ok: true });
  });
  it('throws before any request when env missing', async () => {
    delete process.env.GHL_TOKEN;
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(pushToGhl([lead(1)], [])).rejects.toThrow('GHL_TOKEN and GHL_LOCATION_ID required');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('pushToGhl default tag', () => {
  it('always adds lead-finder tag, even with no tags, without duplicates', async () => {
    process.env.GHL_TOKEN = 't'; process.env.GHL_LOCATION_ID = 'l';
    const f = vi.fn(async () => ok({ contact: { id: 'c' } })); vi.stubGlobal('fetch', f);
    await pushToGhl([lead(1)], []);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body).tags).toEqual(['lead-finder']);
    await pushToGhl([lead(2)], ['lead-finder', 'x']);
    expect(JSON.parse((f.mock.calls[2] as any)[1].body).tags).toEqual(['lead-finder', 'x']);
  });
});

describe('pushToGhl research tags and note', () => {
  it('adds priority and ghl tags, note includes evidence and discovery question', async () => {
    process.env.GHL_TOKEN = 't'; process.env.GHL_LOCATION_ID = 'l';
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c' } } : {})); vi.stubGlobal('fetch', f);
    const research: any = { ghlStatus: 'likely', ghlEvidence: ['msgsndr.com link/form found (GHL)'], processes: ['contact_form'], sourceUrls: ['https://x.com'], verifiedAt: 't',
      score: { total: 85, priority: 'A', confidence: 'High', factors: {} }, outreach: { observation: 'o', opportunity: 'p', openingQuestion: 'q?', service: 'S', discoveryQuestion: 'dq?' } };
    await pushToGhl([lead(1, { research, signals: ['no_booking'] })], ['dentist']);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body).tags).toEqual(['lead-finder', 'dentist', 'priority-a', 'ghl-likely']);
    const note = JSON.parse((f.mock.calls[1] as any)[1].body).body;
    for (const s of ['85', 'Priority A', 'msgsndr', 'No online booking', 'dq?', 'https://x.com']) expect(note).toContain(s);
  });
});

describe('pushToGhl note: how to reach them', () => {
  const research = (extra: any = {}): any => ({ ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: 't', country: 'ng', facebook: 'https://www.facebook.com/glowmua',
    score: { total: 55, priority: 'C', confidence: 'Medium', factors: {} }, outreach: { observation: 'o', opportunity: 'p', openingQuestion: 'Who sees a new message first?', service: 'S', discoveryQuestion: 'dq?' }, ...extra });
  const noteOf = async (l: Lead) => {
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c' } } : {})); vi.stubGlobal('fetch', f);
    await pushToGhl([l], []);
    return JSON.parse((f.mock.calls[1] as any)[1].body).body as string;
  };
  it('lists the ways to reach a no-website solo business and a ready-to-send message', async () => {
    const note = await noteOf(lead(1, { name: 'Glow Makeup Artist', website: undefined, email: undefined, phone: '+2348012345678', instagram: 'glowmua', research: research() }));
    expect(note).toContain('Ways to reach: Instagram https://www.instagram.com/glowmua/');
    expect(note).toContain('Facebook https://www.facebook.com/glowmua');
    expect(note).toContain('DM draft (Instagram): Hi, I came across Glow Makeup Artist on Instagram. Who sees a new message first?');
  });
  it('adds no DM line when the only way in is email', async () => {
    const note = await noteOf(lead(2, { research: research({ facebook: undefined }), instagram: undefined, phone: undefined }));
    expect(note).toContain('Ways to reach: Email');
    expect(note).not.toContain('DM draft');
  });
});

describe('pushToGhl: note failure is reported, not hidden', () => {
  const run = async (noteRes: () => any) => {
    const f = vi.fn(async (u: string) => (u.includes('upsert') ? ok({ contact: { id: 'c' } }) : noteRes())); vi.stubGlobal('fetch', f);
    const research: any = { ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: 't', score: { total: 50, priority: 'C', confidence: 'Low', factors: {} } };
    return (await pushToGhl([lead(1, { research })], []))[0];
  };
  it('still counts the contact as pushed, but says the note did not save (HTTP error)', async () => {
    const r = await run(() => ({ ok: false, status: 422, json: async () => ({}), text: async () => 'bad' }));
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/note/i);
    expect(r.warning).toContain('422');
  });
  it('says so when the note request itself fails', async () => {
    const r = await run(() => { throw new Error('network down'); });
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/note/i);
  });
  it('has no warning when the note saves', async () => {
    expect((await run(() => ok({}))).warning).toBeUndefined();
  });
});

describe('pushToGhl note: ABN', () => {
  it('records the ABN, its status and entity type in the note', async () => {
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c' } } : {})); vi.stubGlobal('fetch', f);
    const research: any = { ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: 't', score: { total: 50, priority: 'C', confidence: 'Low', factors: {} },
      abn: { abn: '51824753556', status: 'Active', entityName: 'DOE, Jane', entityType: 'Individual/Sole Trader', entityTypeCode: 'IND', gst: true, url: 'https://abr.business.gov.au/ABN/View?abn=51824753556' } };
    await pushToGhl([lead(1, { research })], []);
    expect(JSON.parse((f.mock.calls[1] as any)[1].body).body).toContain('ABN: 51 824 753 556, Active, Individual/Sole Trader, GST registered');
  });
});

describe('pushToGhl: only verified emails reach GHL', () => {
  const base: any = { country: 'us', ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: 't', score: { total: 50, priority: 'C', confidence: 'Low', factors: {} } };
  const run = async (emailCheck: any) => {
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c1' } } : {})); vi.stubGlobal('fetch', f);
    await pushToGhl([lead(1, { research: { ...base, ...(emailCheck ? { emailCheck } : {}) } })], []);
    return { upsert: JSON.parse((f.mock.calls[0] as any)[1].body), note: JSON.parse((f.mock.calls[1] as any)[1].body).body as string };
  };
  it('a verified email is sent and tagged email-verified', async () => {
    const { upsert } = await run({ status: 'ok', kind: 'personal', reasons: [], checkedAt: 't', v: EMAIL_CHECK_VERSION });
    expect(upsert.email).toBe('b1@x.com');
    expect(upsert.tags).toContain('email-verified');
  });
  it('an unverified email is held back, and the note says why', async () => {
    const { upsert, note } = await run({ status: 'risky', kind: 'personal', reasons: ["on another company's domain (agency.example), not this business's"], checkedAt: 't', v: EMAIL_CHECK_VERSION });
    expect(upsert.email).toBeUndefined();
    expect(upsert.tags).not.toContain('email-verified');
    expect(note).toContain("Email not added: b1@x.com is not verified (on another company's domain (agency.example), not this business's).");
  });
  it('an email checked under the old, looser rules, or never checked, is held back', async () => {
    expect((await run({ status: 'ok', kind: 'personal', reasons: [], checkedAt: 't' })).upsert.email).toBeUndefined();
    const never = await run(undefined);
    expect(never.upsert.email).toBeUndefined();
    expect(never.note).toContain('Email not added: b1@x.com was not checked.');
  });
});

describe('pushToGhl note: GHL via a third party', () => {
  it('says so, with the reason', async () => {
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c' } } : {})); vi.stubGlobal('fetch', f);
    const research: any = { ghlStatus: 'likely', ghlEvidence: ['x'], processes: [], sourceUrls: [], verifiedAt: 't', score: { total: 50, priority: 'C', confidence: 'Low', factors: {} },
      ghlVia: { domain: 'practicebeacon.com', hosts: ['link.practicebeacon.com'], reason: 'GHL pages are served from practicebeacon.com, which is not this business\'s website' } };
    await pushToGhl([lead(1, { research })], []);
    expect(JSON.parse((f.mock.calls[1] as any)[1].body).body).toContain("GHL via a third party: GHL pages are served from practicebeacon.com, which is not this business's website.");
  });
});

describe('pushToGhl: emails you approved by hand', () => {
  const base: any = { country: 'us', ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: 't', score: { total: 50, priority: 'C', confidence: 'Low', factors: {} } };
  const risky = { status: 'risky', kind: 'personal', reasons: ["on another company's domain (agency.example), not this business's"], checkedAt: 't', v: EMAIL_CHECK_VERSION, approvable: true };
  const run = async (research: any) => {
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c1' } } : {})); vi.stubGlobal('fetch', f);
    await pushToGhl([lead(1, { research: { ...base, ...research } })], []);
    return { upsert: JSON.parse((f.mock.calls[0] as any)[1].body), note: JSON.parse((f.mock.calls[1] as any)[1].body).body as string };
  };
  it('an approved email is sent, tagged email-approved (not email-verified), and the note says who decided', async () => {
    const { upsert, note } = await run({ emailCheck: risky, emailApproval: { email: 'b1@x.com', at: '2026-11-23T10:00:00Z' } });
    expect(upsert.email).toBe('b1@x.com');
    expect(upsert.tags).toContain('email-approved');
    expect(upsert.tags).not.toContain('email-verified');
    expect(note).toContain('Email approved by you on 2026-11-23: b1@x.com');
    expect(note).toContain("on another company's domain");
  });
  it('an approval for a different address, or on a bad address, sends nothing', async () => {
    expect((await run({ emailCheck: risky, emailApproval: { email: 'old@x.com', at: 't' } })).upsert.email).toBeUndefined();
    expect((await run({ emailCheck: { ...risky, status: 'bad' }, emailApproval: { email: 'b1@x.com', at: 't' } })).upsert.email).toBeUndefined();
  });
});

describe('pushToGhl: country gate and do-not-contact', () => {
  const verified = { status: 'ok', kind: 'personal', reasons: [], checkedAt: 't', v: EMAIL_CHECK_VERSION };
  const mk = (country: string, extra: any = {}) => lead(1, { research: { country, ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: 't', score: { total: 50, priority: 'C', confidence: 'Low', factors: {} }, emailCheck: verified, emailSource: 'website', ...extra } as any });
  const run = async (l: Lead, gate = DEFAULT_GATE) => {
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c1' } } : {})); vi.stubGlobal('fetch', f);
    const results = await pushToGhl([l], [], gate);
    return { f, results, upsert: f.mock.calls[0] ? JSON.parse((f.mock.calls[0] as any)[1].body) : undefined, note: f.mock.calls[1] ? JSON.parse((f.mock.calls[1] as any)[1].body).body as string : '' };
  };
  it('a verified email in a blocked country is held back; the contact still goes, and the note says it was the policy', async () => {
    const { upsert, note, results } = await run(mk('de'));
    expect(results[0].ok).toBe(true);
    expect(upsert.email).toBeUndefined();
    expect(upsert.tags).not.toContain('email-verified');
    expect(note).toContain('Email not added: b1@x.com');
    expect(note).toMatch(/DE: email outreach is switched off/);
  });
  it('published-only: held when the address came from a listing, sent when it came from the business\'s own website', async () => {
    expect((await run(mk('au', { emailSource: 'listing' }))).upsert.email).toBeUndefined();
    expect((await run(mk('au', { emailSource: 'website' }))).upsert.email).toBe('b1@x.com');
  });
  it('a custom policy changes the outcome', async () => {
    expect((await run(mk('de'), { ...DEFAULT_GATE, policy: normalizePolicy({ DE: 'allow' }) })).upsert.email).toBe('b1@x.com');
  });
  it('a lead on the do-not-contact list is not pushed at all: no request, a clear error', async () => {
    const gate = { ...DEFAULT_GATE, suppressions: [{ id: 1, kind: 'domain' as const, value: 'x.com', reason: 'unsubscribed', createdAt: 't' }] };
    const { f, results } = await run(mk('us'), gate);
    expect(f).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: 1, ok: false, error: expect.stringMatching(/do-not-contact list.*x\.com/) }]);
  });
  it('the other leads in the same push still go', async () => {
    const gate = { ...DEFAULT_GATE, suppressions: [{ id: 1, kind: 'email' as const, value: 'b2@x.com', createdAt: 't' }] };
    const f = vi.fn(async (u: string) => ok(u.includes('upsert') ? { contact: { id: 'c' } } : {})); vi.stubGlobal('fetch', f);
    const l1 = mk('us'), l2 = { ...mk('us'), id: 2, email: 'b2@x.com' }, l3 = { ...mk('us'), id: 3, email: 'b3@x.com' };
    const results = await pushToGhl([l1, l2, l3], [], gate);
    expect(results.map(r => r.ok)).toEqual([true, false, true]);
  });
});

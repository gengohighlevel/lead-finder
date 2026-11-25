import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { abnEnabled, parseJsonp, personFromEntityName, auState, lookupAbn, abnViewUrl, clearAbnCache } from '../lib/abn';

const GUID = '11111111-2222-3333-4444-555555555555';
const jsonp = (o: unknown, cb = 'callback') => `${cb}(${JSON.stringify(o)})`;
const resp = (body: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response;

const name = (o: Record<string, unknown> = {}) => ({ Abn: '51824753556', AbnStatus: '0000000001', IsCurrent: true, Name: 'Glow Makeup Artist', NameType: 'Trading Name', Postcode: '4000', Score: 100, State: 'QLD', ...o });
const details = (o: Record<string, unknown> = {}) => ({
  Abn: '51824753556', AbnStatus: 'Active', AbnStatusEffectiveFrom: '2019-03-01', Acn: '', AddressDate: '2024-01-02', AddressPostcode: '4000', AddressState: 'QLD',
  BusinessName: ['GLOW MAKEUP ARTIST'], EntityName: 'DOE, Jane Mary', EntityTypeCode: 'IND', EntityTypeName: 'Individual/Sole Trader', Gst: '2019-03-01', Message: '', ...o });

/** Answers MatchingNames and AbnDetails like the real service: always wrapped in a callback. */
function stub(names: unknown[], det: Record<string, unknown> | (() => never) = details()) {
  const f = vi.fn(async (u: string) => {
    if (u.includes('MatchingNames')) return resp(jsonp({ Message: '', Names: names }));
    if (typeof det === 'function') det();
    return resp(jsonp(det));
  });
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => { process.env.ABN_GUID = GUID; clearAbnCache(); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ABN_GUID; });

describe('abnEnabled', () => {
  it('is on only when a well-formed key is set', () => {
    expect(abnEnabled()).toBe(true);
    process.env.ABN_GUID = 'not-a-guid'; expect(abnEnabled()).toBe(false);
    process.env.ABN_GUID = ''; expect(abnEnabled()).toBe(false);
    delete process.env.ABN_GUID; expect(abnEnabled()).toBe(false);
  });
});

describe('parseJsonp', () => {
  it('reads the callback wrapper the service always adds, and plain JSON', () => {
    expect(parseJsonp('callback({"a":1})')).toEqual({ a: 1 });
    expect(parseJsonp('cb({"a":{"b":[1,2]}});')).toEqual({ a: { b: [1, 2] } });
    expect(parseJsonp('{"a":1}')).toEqual({ a: 1 });
  });
  it('returns undefined for anything else', () => {
    expect(parseJsonp('')).toBeUndefined();
    expect(parseJsonp('<html>error</html>')).toBeUndefined();
    expect(parseJsonp('callback({broken')).toBeUndefined();
  });
});

describe('personFromEntityName', () => {
  it('turns the register\'s "FAMILY, Given" into a normal name', () => {
    expect(personFromEntityName('DOE, Jane Mary')).toBe('Jane Mary Doe');
    expect(personFromEntityName('SMITH, JOHN')).toBe('John Smith');
    expect(personFromEntityName("O'BRIEN, SEAN")).toBe("Sean O'Brien");
  });
  it('keeps a name already in normal order, and refuses what is not a person', () => {
    expect(personFromEntityName('Jane Doe')).toBe('Jane Doe');
    expect(personFromEntityName('')).toBeUndefined();
    expect(personFromEntityName('Madonna')).toBeUndefined();          // one word is not enough to be sure
    expect(personFromEntityName('DOE, ')).toBeUndefined();
  });
});

describe('auState', () => {
  it('reads a state from a place label, a full name or a code', () => {
    expect(auState('Brisbane, Queensland, Australia')).toBe('QLD');
    expect(auState('Fitzroy, Victoria, Australia')).toBe('VIC');
    expect(auState('nsw')).toBe('NSW');
    expect(auState('Australian Capital Territory')).toBe('ACT');
    expect(auState('Somewhere, Nowhere')).toBeUndefined();
    expect(auState(undefined)).toBeUndefined();
  });
});

describe('lookupAbn', () => {
  const lead = { name: 'Glow Makeup Artist', region: 'QLD' };

  it('does nothing without a key, and never calls the service', async () => {
    delete process.env.ABN_GUID;
    const f = stub([name()]);
    expect(await lookupAbn(lead)).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it('finds a sole trader and returns the person behind the ABN as the owner', async () => {
    stub([name()]);
    const r = (await lookupAbn(lead))!;
    expect(r.abn).toBe('51824753556');
    expect(r.status).toBe('Active');
    expect(r.entityType).toBe('Individual/Sole Trader');
    expect(r.gst).toBe(true);
    expect(r.state).toBe('QLD');
    expect(r.person).toBe('Jane Mary Doe');
    expect(r.url).toBe(abnViewUrl('51824753556'));
  });

  it('sends the key and the name, URL-encoded, to the right endpoints', async () => {
    const f = stub([name()]);
    await lookupAbn({ name: "Joe's Movers & Packers", region: 'QLD' });
    const urls = f.mock.calls.map(c => String(c[0]));
    expect(urls[0]).toContain('https://abr.business.gov.au/json/MatchingNames.aspx?');
    expect(urls[0]).toContain(`guid=${GUID}`);
    expect(urls[0]).toContain('name=Joe%27s+Movers+%26+Packers');
  });

  it('gives no person for a company (the register does not name owners or directors)', async () => {
    stub([name({ Name: 'Glow Makeup Pty Ltd' })], details({ EntityName: 'GLOW MAKEUP PTY LTD', EntityTypeCode: 'PRV', EntityTypeName: 'Australian Private Company', Acn: '123456789' }));
    const r = (await lookupAbn({ name: 'Glow Makeup', region: 'QLD' }))!;
    expect(r.person).toBeUndefined();
    expect(r.entityType).toBe('Australian Private Company');
    expect(r.status).toBe('Active');
  });

  it('reports a cancelled ABN (a business that may have closed) without a person', async () => {
    stub([name()], details({ AbnStatus: 'Cancelled', AbnStatusEffectiveFrom: '2023-06-30' }));
    const r = (await lookupAbn(lead))!;
    expect(r.status).toBe('Cancelled');
    expect(r.person).toBeUndefined();
  });

  it('ignores matches in another state, historical names and names that only share a word', async () => {
    stub([name({ State: 'NSW' }), name({ IsCurrent: false, Abn: '1' }), name({ Name: 'Glow Cleaning Services', Abn: '2' })]);
    expect(await lookupAbn(lead)).toBeUndefined();
  });

  it('will not guess between two different businesses with the same name in the same state', async () => {
    stub([name(), name({ Abn: '99999999999', Postcode: '4101' })]);
    expect(await lookupAbn(lead)).toBeUndefined();
  });
  it('uses the postcode to settle a tie when it knows it', async () => {
    stub([name({ Abn: '99999999999', Postcode: '4101' }), name()]);
    expect((await lookupAbn({ ...lead, postcode: '4000' }))!.abn).toBe('51824753556');
  });

  it('answers nothing, without throwing, when the key is refused, the service fails or sends rubbish', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(jsonp({ Message: 'The GUID entered is not recognised as a Registered Party', Names: [] }))));
    expect(await lookupAbn(lead)).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await lookupAbn(lead)).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => resp('<html>502</html>')));
    expect(await lookupAbn(lead)).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => '' }) as unknown as Response));
    expect(await lookupAbn(lead)).toBeUndefined();
  });

  it('remembers an answer so the same business is not asked about twice', async () => {
    const f = stub([name()]);
    await lookupAbn(lead); await lookupAbn(lead);
    expect(f).toHaveBeenCalledTimes(2); // one search + one details call, not four
  });
});

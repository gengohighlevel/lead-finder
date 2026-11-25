import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geocode, areaClause, countryCodes } from '../lib/geocode';
import { LocationNotFoundError } from '../lib/osm';

beforeEach(() => vi.restoreAllMocks());
const res = (b: any, ok = true) => ({ ok, status: ok ? 200 : 429, json: async () => b }) as any;
const row = (o: any) => ({ osm_type: 'relation', osm_id: 123, display_name: 'Austin, Travis County, Texas, United States', lat: '30.2', lon: '-97.7', category: 'boundary', address: { country_code: 'us' }, ...o });

describe('geocode', () => {
  it('maps results, passes countrycodes, keeps area-like results only, dedupes labels', async () => {
    const f = vi.fn(async (_u: string) => res([row({}), row({ osm_id: 124 }), row({ osm_id: 9, category: 'highway', display_name: 'Austin Street, NY' }), row({ osm_id: 5, display_name: 'Austin, Minnesota, United States' })]));
    vi.stubGlobal('fetch', f);
    const c = await geocode('Austin', 'us,ca');
    expect(String(f.mock.calls[0][0])).toContain('countrycodes=us%2Cca');
    expect(c.map(x => x.label)).toEqual(['Austin, Travis County, Texas, United States', 'Austin, Minnesota, United States']);
    expect(c[0]).toMatchObject({ osmType: 'relation', osmId: 123, countryCode: 'us' });
  });
  it('empty -> LocationNotFoundError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res([])));
    await expect(geocode('zzzz-none')).rejects.toBeInstanceOf(LocationNotFoundError);
  });
  it('http error -> readable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({}, false)));
    await expect(geocode('rate-limited')).rejects.toThrow(/geocod/i);
  });
});
describe('areaClause', () => {
  it('relation', () => expect(areaClause({ osmType: 'relation', osmId: 123, lat: 1, lon: 2 })).toEqual({ def: 'area(3600000123)->.a;', filter: '(area.a)' }));
  it('way', () => expect(areaClause({ osmType: 'way', osmId: 5, lat: 1, lon: 2 })).toEqual({ def: 'area(2400000005)->.a;', filter: '(area.a)' }));
  it('node uses 5km radius', () => expect(areaClause({ osmType: 'node', osmId: 5, lat: 1.5, lon: 2.5 })).toEqual({ def: '', filter: '(around:5000,1.5,2.5)' }));
});
describe('countryCodes', () => {
  it('maps markets', () => {
    expect(countryCodes('us')).toBe('us');
    expect(countryCodes('world')).toBe(''); // no country filter: anywhere in the world
    expect(countryCodes('ng')).toBe('ng');
    expect(countryCodes('ph')).toBe('ph');   // Philippines market
    expect(countryCodes('eu').split(',')).toHaveLength(27);
    expect(countryCodes('all').split(',')).toEqual(expect.arrayContaining(['us', 'ca', 'au', 'nz', 'ph', 'de', 'fr']));
    expect(countryCodes(undefined)).toBe(countryCodes('all'));
  });
});

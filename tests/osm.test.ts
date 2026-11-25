import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchOsm, LocationNotFoundError, mapTypeToTags, MapServersBusyError } from '../lib/osm';

const json = (b: any) => ({ ok: true, json: async () => b }) as any;
const place = { osmType: 'relation' as const, osmId: 123, lat: 30, lon: -97, label: 'Austin', countryCode: 'us' };
beforeEach(() => vi.restoreAllMocks());

describe('mapTypeToTags', () => {
  it('maps known type', () => expect(mapTypeToTags('Dentist')).toEqual(['"amenity"="dentist"']));
  it('unknown type -> empty', () => expect(mapTypeToTags('zxqv widgets')).toEqual([]));
  it('maps many service types', () => {
    for (const t of ['moving company', 'movers', 'architect', 'marketing agency', 'driving school', 'tattoo', 'locksmith']) expect(mapTypeToTags(t).length, t).toBeGreaterThan(0);
  });
});

describe('searchOsm', () => {
  it('queries overpass within the exact area polygon, maps leads, drops unnamed', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ elements: [
      { tags: { name: 'Smile Dental', 'contact:phone': '+1 512 555 0100', website: 'https://smile.example', 'contact:email': 'hi@smile.example', 'contact:instagram': 'https://instagram.com/smiledental', 'addr:street': 'Main St', 'addr:housenumber': '1' } },
      { tags: { amenity: 'dentist' } },
    ] }));
    vi.stubGlobal('fetch', f);
    const leads = await searchOsm('dentist', { ...place, osmId: 111 });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: 'Smile Dental', phone: '+1 512 555 0100', website: 'https://smile.example', email: 'hi@smile.example', instagram: 'smiledental' });
    expect(f.mock.calls[0][1].headers['User-Agent']).toBe('lead-finder/1.0');
    const q = decodeURIComponent(String(f.mock.calls[0][1].body));
    expect(q).toContain('area(3600000111)->.a;');
    expect(q).toContain('nwr["amenity"="dentist"](area.a);');
    expect(q).not.toMatch(/\d+\.\d+,\d+\.\d+,\d+\.\d+/); // no bbox
  });
  it('unknown type falls back to name match query', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ elements: [] }));
    vi.stubGlobal('fetch', f);
    expect(await searchOsm('zxqv widgets', { ...place, osmId: 222 })).toEqual([]);
    expect(decodeURIComponent(String(f.mock.calls[0][1].body))).toContain('"name"~"zxqv|widgets"');
  });
  it('all overpass servers failing gives readable error, tries each server once', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 502 }));
    vi.stubGlobal('fetch', f);
    const p = searchOsm('dentist', { ...place, osmId: 333 });
    await expect(p).rejects.toBeInstanceOf(MapServersBusyError);
    await expect(p).rejects.toThrow(/map servers.*busy/i);
    expect(f.mock.calls.length).toBe(3);
  });
  it('hedges: if the first server is slow, asks the next and takes whichever answers first', async () => {
    vi.useFakeTimers();
    let firstAborted = false;
    const f = vi.fn()
      .mockImplementationOnce((_u: string, o: { signal: AbortSignal }) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => { firstAborted = true; rej(new Error('aborted')); })))
      .mockResolvedValueOnce(json({ elements: [{ tags: { name: 'Fast Mirror Co' } }] }));
    vi.stubGlobal('fetch', f);
    const p = searchOsm('dentist', { ...place, osmId: 339 });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await p).map(l => l.name)).toEqual(['Fast Mirror Co']);
    expect(f).toHaveBeenCalledTimes(2);
    expect(firstAborted).toBe(true); // the slow request is cancelled, not left running
    vi.useRealTimers();
  });
  it('falls back to a mirror when first server returns 502', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce(json({ elements: [{ tags: { name: 'Mover Co' } }] }));
    vi.stubGlobal('fetch', f);
    const r = await searchOsm('dentist', { ...place, osmId: 334 });
    expect(r.map(l => l.name)).toEqual(['Mover Co']);
    expect(String(f.mock.calls[0][0])).not.toBe(String(f.mock.calls[1][0]));
  });
  it('treats 200 with runtime-error remark as failure and tries next server', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3' }))
      .mockResolvedValueOnce(json({ elements: [{ tags: { name: 'Ok Co' } }] }));
    vi.stubGlobal('fetch', f);
    expect((await searchOsm('dentist', { ...place, osmId: 335 })).map(l => l.name)).toEqual(['Ok Co']);
  });
  it('moving company uses office=moving_company', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ elements: [] }));
    vi.stubGlobal('fetch', f);
    await searchOsm('Moving Company', { ...place, osmId: 336 });
    expect(decodeURIComponent(String(f.mock.calls[0][1].body))).toContain('nwr["office"="moving_company"](area.a);');
  });
  it('name fallback drops filler words and ORs keywords', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ elements: [] }));
    vi.stubGlobal('fetch', f);
    await searchOsm('zxqv widget services', { ...place, osmId: 337 });
    expect(decodeURIComponent(String(f.mock.calls[0][1].body))).toContain('"name"~"zxqv|widget",i');
  });
});
export { LocationNotFoundError };

describe('name search for solopreneur types', () => {
  it('searches the business name by the specialty, not by the word "artist"', async () => {
    const { nameKeywords } = await import('../lib/osmTags');
    expect(nameKeywords('makeup artist')).toEqual(['makeup']);
    expect(nameKeywords('makeup artists')).toEqual(['makeup']);
  });
});

describe('rental business tags', () => {
  it('maps car and boat rental to their OpenStreetMap tags, and holiday rentals to apartments and chalets', async () => {
    const { mapTypeToTags } = await import('../lib/osmTags');
    expect(mapTypeToTags('car rental')).toEqual(['"amenity"="car_rental"']);
    expect(mapTypeToTags('car hire')).toEqual(['"amenity"="car_rental"']);
    expect(mapTypeToTags('yacht rental')).toEqual(['"amenity"="boat_rental"']);
    expect(mapTypeToTags('boat charter')).toEqual(['"amenity"="boat_rental"']);
    expect(mapTypeToTags('short term rental')).toEqual(expect.arrayContaining(['"tourism"="apartment"', '"tourism"="chalet"']));
    expect(mapTypeToTags('vacation rental')).toEqual(mapTypeToTags('short term rental'));
  });
});

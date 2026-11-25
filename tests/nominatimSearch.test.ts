import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchNominatim } from '../lib/nominatimSearch';

const json = (b: unknown) => ({ ok: true, json: async () => b }) as unknown as Response;
const place = { osmType: 'relation' as const, osmId: 1, lat: 30.27, lon: -97.74, label: 'Austin, Texas, United States', countryCode: 'us', bbox: [30.1, 30.5, -97.9, -97.5] as [number, number, number, number] };
beforeEach(() => vi.restoreAllMocks());

const row = (id: number, name: string, extra: Record<string, string> = {}, category = 'amenity') => ({
  place_id: id, osm_type: 'node', osm_id: id * 10, name, category, type: 'dentist',
  address: { house_number: '1', road: 'Main St', city: 'Austin', state: 'Texas' }, extratags: extra,
});

describe('searchNominatim (fallback when the map servers are down)', () => {
  it('searches inside the place box and maps businesses like the map search does', async () => {
    const f = vi.fn().mockResolvedValueOnce(json([
      row(1, 'Smile Dental', { website: 'https://smile.example', phone: '+1 512 555 0100', 'contact:email': 'hi@smile.example', 'contact:instagram': 'https://instagram.com/smiledental' }),
      row(2, 'Austin', {}, 'boundary'),
      { ...row(3, ''), name: '' },
    ]));
    vi.stubGlobal('fetch', f);
    const leads = await searchNominatim('dentist', place, { pages: 1 });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: 'Smile Dental', website: 'https://smile.example', phone: '+1 512 555 0100', email: 'hi@smile.example', instagram: 'smiledental',
      address: '1 Main St, Austin', city: 'Austin', region: 'Texas', osmUrl: 'https://www.openstreetmap.org/node/10' });
    const url = String(f.mock.calls[0][0]);
    expect(new URL(url).searchParams.get('q')).toBe('[amenity=dentist]');
    expect(url).toContain('viewbox=-97.9%2C30.5%2C-97.5%2C30.1');
    expect(url).toContain('bounded=1');
    expect(f.mock.calls[0][1].headers['User-Agent']).toBe('lead-finder/1.0');
  });
  it('pages past the first 40 by excluding places already seen, and stops when a page is short', async () => {
    const page1 = Array.from({ length: 40 }, (_, i) => row(i + 1, `Biz ${i + 1}`));
    const f = vi.fn().mockResolvedValueOnce(json(page1)).mockResolvedValueOnce(json([row(99, 'Last Biz')]));
    vi.stubGlobal('fetch', f);
    const leads = await searchNominatim('dentist', place, { pages: 3, throttleMs: 0 });
    expect(leads).toHaveLength(41);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1][0])).toContain('exclude_place_ids=1%2C2%2C3');
  });
  it('known business types search by their map tag, which finds far more than the plain word', async () => {
    const f = vi.fn().mockResolvedValue(json([]));
    vi.stubGlobal('fetch', f);
    await searchNominatim('plumber', place, { pages: 1 });
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get('q')).toBe('[craft=plumber]');
    await searchNominatim('Hair Salon', place, { pages: 1 });
    expect(new URL(String(f.mock.calls[1][0])).searchParams.get('q')).toBe('[shop=hairdresser]');
  });
  it('a type with several tags (spa) is searched once per tag and merged without duplicates', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json([row(1, 'Calm Spa'), row(2, 'Shared Co')]))
      .mockResolvedValueOnce(json([row(2, 'Shared Co'), row(3, 'Glow Beauty')]));
    vi.stubGlobal('fetch', f);
    const leads = await searchNominatim('spa', place, { pages: 1, throttleMs: 0 });
    expect(leads.map(l => l.name)).toEqual(['Calm Spa', 'Shared Co', 'Glow Beauty']);
    expect(f.mock.calls.map(c => new URL(String(c[0])).searchParams.get('q'))).toEqual(['[leisure=spa]', '[shop=beauty]']);
  });
  it('an unknown type falls back to the plain words', async () => {
    const f = vi.fn().mockResolvedValueOnce(json([]));
    vi.stubGlobal('fetch', f);
    await searchNominatim('zxqv widgets', place, { pages: 1 });
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get('q')).toBe('zxqv widgets');
  });
  it('without a stored box, searches a box around the place centre', async () => {
    const f = vi.fn().mockResolvedValueOnce(json([]));
    vi.stubGlobal('fetch', f);
    await searchNominatim('plumber', { ...place, bbox: undefined }, { pages: 1 });
    const [w, n, e, s] = new URL(String(f.mock.calls[0][0])).searchParams.get('viewbox')!.split(',').map(Number);
    expect(w).toBeCloseTo(-97.94, 2); expect(n).toBeCloseTo(30.44, 2); expect(e).toBeCloseTo(-97.54, 2); expect(s).toBeCloseTo(30.10, 2);
  });
});

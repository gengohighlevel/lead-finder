import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/overtureDb', () => ({
  latestRelease: vi.fn(async () => '2026-11-18.0'),
  queryRows: vi.fn(async () => []),
}));
vi.mock('../lib/geocode', async orig => ({ ...(await orig<typeof import('../lib/geocode')>()), throttle: vi.fn(async () => {}) }));

import { queryRows } from '../lib/overtureDb';
import {
  overtureCategories, pointInBoundary, buildPlacesSql, rowToLead, searchOverture, mergeOverture, type Boundary,
} from '../lib/overture';
import type { SourceLead } from '../lib/npi';

beforeEach(() => { vi.mocked(queryRows).mockReset(); vi.mocked(queryRows).mockResolvedValue([]); vi.unstubAllGlobals(); });

const BRISBANE = { osmType: 'relation' as const, osmId: 14027280, lat: -27.47, lon: 153.02, label: 'Brisbane, Queensland, Australia', countryCode: 'au',
  bbox: [-27.94, -26.79, 152.38, 153.55] as [number, number, number, number] };
const SQUARE: Boundary = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };

const row = (o: Record<string, unknown> = {}) => ({
  id: 'abc', name: 'Scotty\'s The Movers', cat: 'mover', web: 'https://www.scottysthemovers.com.au/', phone: '+611300669409',
  socials: ['https://www.facebook.com/434260823426057', 'https://www.instagram.com/scottys.movers/'],
  street: '12 Smith St', city: 'Tingalpa', region: 'QLD', conf: 0.97, status: 'open', dataset: 'meta', lon: 153.1, lat: -27.5, ...o,
});

describe('overtureCategories', () => {
  it('maps business types to several Overture categories (there is no single "dentist")', () => {
    expect(overtureCategories('dentist')).toEqual(expect.arrayContaining(['dental_clinic', 'general_dentistry', 'dentist']));
    expect(overtureCategories('Moving Company')).toContain('mover');
    expect(overtureCategories('removalist')).toContain('mover');
    expect(overtureCategories('plumber')).toContain('plumbing');
    expect(overtureCategories('chiropractor')).toContain('chiropractic');
  });
  it('knows solopreneur types: makeup artist, trainers, coaches, tutors, designers and more', () => {
    expect(overtureCategories('makeup artist')).toContain('makeup_artist');
    expect(overtureCategories('Makeup Artists')).toContain('makeup_artist');   // plural
    expect(overtureCategories('MUA')).toContain('makeup_artist');
    expect(overtureCategories('lash technician')).toContain('eyelash_service');
    expect(overtureCategories('personal trainer')).toContain('fitness_trainer');
    expect(overtureCategories('life coach')).toContain('life_coach');
    expect(overtureCategories('tutor')).toEqual(expect.arrayContaining(['tutoring_service', 'private_tutor']));
    expect(overtureCategories('wedding planner')).toContain('wedding_planning');
    expect(overtureCategories('interior designer')).toContain('interior_design');
    expect(overtureCategories('graphic designer')).toContain('graphic_designer');
    expect(overtureCategories('web designer')).toContain('web_designer');
    expect(overtureCategories('dog trainer')).toContain('dog_trainer');
    expect(overtureCategories('house cleaner')).toContain('home_cleaning');
    expect(overtureCategories('dj')).toContain('dj_service');
    expect(overtureCategories('seamstress')).toEqual(expect.arrayContaining(['tailor', 'sewing_and_alterations']));
    expect(overtureCategories('hair stylist')).toContain('hair_stylist');
    expect(overtureCategories('tattoo artist')).toContain('tattoo_and_piercing');
  });
  it('knows rental businesses: car rental, yacht/boat charter, short-term (holiday) rentals', () => {
    for (const t of ['car rental', 'Car Rentals', 'car hire', 'rental car']) expect(overtureCategories(t), t).toContain('car_rental_service');
    for (const t of ['yacht rental', 'yacht charter', 'boat rental', 'boat hire', 'sailing charter']) expect(overtureCategories(t), t).toEqual(expect.arrayContaining(['boat_charter', 'boat_rental_and_training']));
    for (const t of ['short term rental', 'short-term rental', 'vacation rental', 'holiday rental', 'airbnb host', 'holiday home']) expect(overtureCategories(t), t).toEqual(expect.arrayContaining(['holiday_rental_home', 'vacation_rental_agent']));
    expect(overtureCategories('vacation rental manager')).toEqual(expect.arrayContaining(['vacation_rental_agent', 'property_management']));
    expect(overtureCategories('short term rental')).not.toContain('service_apartment'); // hotel-style chains are not owners
    expect(overtureCategories('serviced apartment')).toEqual(['service_apartment']);
    expect(overtureCategories('truck rental')).toContain('truck_rental_service');
    expect(overtureCategories('motorcycle rental')).toContain('motorcycle_rental_service');
    expect(overtureCategories('rv rental')).toContain('rv_rental_service');
  });
  it('falls back to the typed words as a category, and never returns anything that is not a plain slug', () => {
    expect(overtureCategories('pest control')).toEqual(expect.arrayContaining(['pest_control', 'pest_control_service']));
    for (const t of ["x'; DROP TABLE leads;--", '', '   ', 'a b c d e f g h i j k l m n o p']) {
      for (const c of overtureCategories(t)) expect(c).toMatch(/^[a-z0-9_]+$/);
    }
    expect(overtureCategories('')).toEqual([]);
  });
});

describe('pointInBoundary', () => {
  it('handles polygons with holes and multipolygons', () => {
    const holed: Boundary = { type: 'Polygon', coordinates: [SQUARE.type === 'Polygon' ? SQUARE.coordinates[0] : [], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
    expect(pointInBoundary(5, 5, SQUARE)).toBe(true);
    expect(pointInBoundary(11, 5, SQUARE)).toBe(false);
    expect(pointInBoundary(5, 5, holed)).toBe(false);
    expect(pointInBoundary(2, 2, holed)).toBe(true);
    const multi: Boundary = { type: 'MultiPolygon', coordinates: [SQUARE.type === 'Polygon' ? SQUARE.coordinates : [], [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]] };
    expect(pointInBoundary(25, 25, multi)).toBe(true);
    expect(pointInBoundary(15, 15, multi)).toBe(false);
  });
});

describe('buildPlacesSql', () => {
  const base = { release: '2026-11-18.0', categories: ['mover', 'storage_facility'], bbox: [-27.94, -26.79, 152.38, 153.55] as [number, number, number, number], limit: 600 };
  it('reads the given release, filters by box, category, confidence and status', () => {
    const sql = buildPlacesSql(base);
    expect(sql).toContain('release/2026-11-18.0/theme=places/type=place');
    expect(sql).toContain("taxonomy.primary IN ('mover','storage_facility')");
    expect(sql).toContain("list_has_any(taxonomy.alternates, ['mover','storage_facility'])");
    expect(sql).toMatch(/bbox\.xmin BETWEEN 152\.38 AND 153\.55/);
    expect(sql).toMatch(/bbox\.ymin BETWEEN -27\.94 AND -26\.79/);
    expect(sql).toContain('confidence >= 0.3');
    expect(sql).toContain("NOT IN ('closed','permanently_closed')");
    expect(sql).toContain('LIMIT 600');
  });
  it('refuses anything that is not a plain release id, slug or number (no SQL injection)', () => {
    expect(() => buildPlacesSql({ ...base, release: "x'; DROP" })).toThrow();
    expect(() => buildPlacesSql({ ...base, categories: ["a'b"] })).toThrow();
    expect(() => buildPlacesSql({ ...base, bbox: [NaN, 1, 2, 3] })).toThrow();
    expect(() => buildPlacesSql({ ...base, categories: [] })).toThrow();
  });
});

describe('rowToLead', () => {
  it('turns a row into a lead: site, E.164 phone, Instagram handle, address, source info', () => {
    const l = rowToLead(row())!;
    expect(l.name).toBe("Scotty's The Movers");
    expect(l.website).toBe('https://www.scottysthemovers.com.au/');
    expect(l.phone).toBe('+611300669409');
    expect(l.instagram).toBe('scottys.movers');
    expect(l.address).toBe('12 Smith St, Tingalpa');
    expect(l.city).toBe('Tingalpa');
    expect(l.region).toBe('QLD');
    expect(l.overture).toEqual({ id: 'abc', confidence: 0.97, dataset: 'meta', facebook: 'https://www.facebook.com/434260823426057' });
    expect(l.signals).toEqual([]);
  });
  it('keeps the Facebook page: for many solopreneurs it is the only storefront', () => {
    expect(rowToLead(row())!.overture?.facebook).toBe('https://www.facebook.com/434260823426057');
    expect(rowToLead(row({ socials: ['https://www.instagram.com/x/'] }))!.overture?.facebook).toBeUndefined();
    expect(rowToLead(row({ socials: ['https://evil.example/facebook.com/x'] }))!.overture?.facebook).toBeUndefined();
  });
  it('never takes the email (published emails are unverified and often a sole trader\'s personal address)', () => {
    const l = rowToLead(row({ email: 'shop.owner@gmail.com', emails: ['x@y.com'] }))!;
    expect(l.email).toBeUndefined();
  });
  it('skips rows with no name; tolerates missing fields', () => {
    expect(rowToLead(row({ name: null }))).toBeUndefined();
    const l = rowToLead(row({ web: null, phone: null, socials: null, street: null, city: null, region: null }))!;
    expect(l.website).toBeUndefined();
    expect(l.address).toBeUndefined();
  });
});

describe('searchOverture', () => {
  it('returns [] without touching the data for a type it cannot map', async () => {
    expect(await searchOverture('', BRISBANE)).toEqual([]);
    expect(queryRows).not.toHaveBeenCalled();
  });

  it('keeps only places inside the real boundary, best confidence first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ geojson: { type: 'Polygon', coordinates: [[[153, -28], [153.2, -28], [153.2, -27], [153, -27], [153, -28]]] } }] })));
    vi.mocked(queryRows).mockResolvedValue([
      row({ id: 'out', name: 'Outside Movers', lon: 152.5, lat: -27.5, conf: 0.99 }),
      row({ id: 'lo', name: 'Low Movers', lon: 153.1, lat: -27.5, conf: 0.4 }),
      row({ id: 'hi', name: 'High Movers', lon: 153.1, lat: -27.4, conf: 0.9 }),
    ]);
    const out = await searchOverture('mover', { ...BRISBANE, osmId: 111 });
    expect(out.map(l => l.name)).toEqual(['High Movers', 'Low Movers']);
    expect(vi.mocked(queryRows).mock.calls[0][0]).toContain("'mover'");
  });

  it('falls back to the box when the boundary cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.mocked(queryRows).mockResolvedValue([row({ id: 'a', name: 'A Movers' })]);
    expect((await searchOverture('mover', { ...BRISBANE, osmId: 222 })).map(l => l.name)).toEqual(['A Movers']);
  });

  it('is optional: any data failure gives no leads, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.mocked(queryRows).mockRejectedValue(new Error('s3 down'));
    expect(await searchOverture('mover', { ...BRISBANE, osmId: 333 })).toEqual([]);
  });

  it('uses a 5 km circle around a place with no area (a town node)', async () => {
    vi.mocked(queryRows).mockResolvedValue([row({ name: 'Near', lon: 153.03, lat: -27.47 }), row({ id: 'far', name: 'Far', lon: 153.5, lat: -27.47 })]);
    const out = await searchOverture('mover', { osmType: 'node', osmId: 5, lat: -27.47, lon: 153.02, label: 'Tinyville' });
    expect(out.map(l => l.name)).toEqual(['Near']);
  });
});

describe('mergeOverture', () => {
  const osm = (o: Partial<SourceLead> = {}): SourceLead => ({ name: 'Smith Movers', signals: [], ...o });
  const ov = (o: Partial<SourceLead> = {}): SourceLead => ({ name: 'Other Movers', website: 'https://other.example', phone: '+61733334444', signals: [], overture: { id: 'x', confidence: 0.8, dataset: 'meta' }, ...o });

  it('keeps map results first and untouched, adds new places after them', () => {
    const out = mergeOverture([osm()], [ov()]);
    expect(out.map(l => l.name)).toEqual(['Smith Movers', 'Other Movers']);
    expect(out[1].overture).toBeDefined();
  });
  it('fills what the map lacks (website, phone) when it is the same business, instead of adding a twin', () => {
    const out = mergeOverture([osm({ name: 'Smith Movers' })], [ov({ name: 'Smith Movers Pty Ltd', website: 'https://smith.example', phone: '+61733335555' })]);
    expect(out).toHaveLength(1);
    expect(out[0].website).toBe('https://smith.example');
    expect(out[0].phone).toBe('+61733335555');
    expect(out[0].overture).toBeDefined();
  });
  it('matches by website domain, and never overwrites data the map already has', () => {
    const out = mergeOverture([osm({ name: 'Totally Different', website: 'http://www.smith.example/', phone: '+61700000000' })], [ov({ name: 'Smith', website: 'https://smith.example/about', phone: '+61799999999' })]);
    expect(out).toHaveLength(1);
    expect(out[0].phone).toBe('+61700000000');
  });
  it('does not merge two branches that only share a 1300 number with unrelated names', () => {
    const out = mergeOverture([osm({ name: 'Alpha Removals', phone: '+611300111222' })], [ov({ name: 'Zeta Transport', website: undefined, phone: '+611300111222' })]);
    expect(out).toHaveLength(2);
  });
  it('drops duplicates inside the Overture list itself and caps the number added', () => {
    const dup = [ov({ name: 'DK Movers', website: 'http://dk.example' }), ov({ name: 'DK Movers', website: 'http://dk.example' }), ov({ name: 'B', website: undefined, phone: undefined }), ov({ name: 'C', website: undefined, phone: undefined })];
    expect(mergeOverture([], dup)).toHaveLength(3);
    expect(mergeOverture([], dup, 2)).toHaveLength(2);
  });
  it('returns the map list as is when Overture found nothing', () => {
    const m = [osm()];
    expect(mergeOverture(m, [])).toBe(m);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { npiTaxonomy, placeCityState, searchNpi, mergeSources, titleCase, tidyTitle, type SourceLead } from '../lib/npi';

beforeEach(() => vi.restoreAllMocks());
const json = (b: unknown) => ({ ok: true, json: async () => b }) as unknown as Response;
const AUSTIN = { osmType: 'relation' as const, osmId: 1, lat: 30.27, lon: -97.74, label: 'Austin, Travis County, Texas, United States', countryCode: 'us' };

const org = (o: Record<string, any> = {}) => ({
  number: '1154494250', enumeration_type: 'NPI-2',
  basic: { organization_name: '360 DENTAL CARE P.A.', status: 'A', authorized_official_first_name: 'MICHAEL', authorized_official_middle_name: 'B', authorized_official_last_name: 'NUSSBAUM',
    authorized_official_title_or_position: 'President', authorized_official_credential: 'D.D.S.', authorized_official_name_prefix: '--', ...(o.basic ?? {}) },
  other_names: o.other_names ?? [{ type: 'Doing Business As', organization_name: '360 DENTAL CARE' }],
  addresses: o.addresses ?? [
    { address_purpose: 'MAILING', address_1: 'PO BOX 1', city: 'AUSTIN', state: 'TX', telephone_number: '512-000-0000' },
    { address_purpose: 'LOCATION', address_1: '3660 STONERIDGE RD STE B101', city: 'AUSTIN', state: 'TX', postal_code: '787467759', telephone_number: '512-327-3631' }],
  taxonomies: [{ desc: 'Dentist, General Practice', primary: true }],
});

describe('npiTaxonomy', () => {
  it('maps business types to registry specialties, and returns undefined for what the registry does not hold', () => {
    expect(npiTaxonomy('dentist')).toBe('Dentist');
    expect(npiTaxonomy('Dental Clinic')).toBe('Dentist');
    expect(npiTaxonomy('chiropractor')).toBe('Chiropractor');
    expect(npiTaxonomy('physio')).toBe('Physical Therapist');
    expect(npiTaxonomy('optometrist')).toBe('Optometrist');
    expect(npiTaxonomy('pharmacy')).toBe('Pharmacy');
    expect(npiTaxonomy('plumber')).toBeUndefined();
    expect(npiTaxonomy('restaurant')).toBeUndefined();
    expect(npiTaxonomy('veterinarian')).toBeUndefined();
  });
});

describe('placeCityState', () => {
  it('reads city and two-letter state from a place label', () => {
    expect(placeCityState(AUSTIN)).toEqual({ city: 'Austin', state: 'TX' });
    expect(placeCityState({ ...AUSTIN, label: 'Norman, Cleveland County, Oklahoma, United States' })).toEqual({ city: 'Norman', state: 'OK' });
    expect(placeCityState({ ...AUSTIN, label: 'New York, New York, United States' })).toEqual({ city: 'New York', state: 'NY' });
  });
  it('gives nothing for non-US places or places that are not a city', () => {
    expect(placeCityState({ ...AUSTIN, countryCode: 'au' })).toBeUndefined();
    expect(placeCityState({ ...AUSTIN, label: 'Travis County, Texas, United States' })).toBeUndefined();
    expect(placeCityState({ ...AUSTIN, label: 'Texas, United States' })).toBeUndefined();
  });
});

describe('titleCase', () => {
  it('fixes ALL CAPS names but keeps legal endings and initials tidy', () => {
    expect(titleCase('360 DENTAL CARE P.A.')).toBe('360 Dental Care P.A.');
    expect(titleCase('SMITH & JONES DENTAL PLLC')).toBe('Smith & Jones Dental PLLC');
    expect(titleCase("O'BRIEN FAMILY DENTISTRY")).toBe("O'Brien Family Dentistry");
    expect(titleCase('MCDONALD DENTAL')).toBe('McDonald Dental');
    expect(titleCase('Already Fine Dental')).toBe('Already Fine Dental');
  });
});

describe('tidyTitle', () => {
  it('fixes the registry\'s ALL CAPS and lower case titles but keeps acronyms', () => {
    expect(tidyTitle('PRESIDENT')).toBe('President');
    expect(tidyTitle('president')).toBe('President');
    expect(tidyTitle('CEO')).toBe('CEO');
    expect(tidyTitle('Coo')).toBe('COO');
    expect(tidyTitle('OWNER/VICE PRESIDENT')).toBe('Owner/Vice President');
    expect(tidyTitle('Owner, DDS')).toBe('Owner, DDS');
    expect(tidyTitle('Office Manager')).toBe('Office Manager');
  });
  it('gives nothing for empty or placeholder titles', () => {
    for (const t of ['', '--', '  ', undefined]) expect(tidyTitle(t as string | undefined)).toBeUndefined();
  });
});

describe('searchNpi', () => {
  it('asks the registry for practices of that specialty at their practice location, and maps them to leads', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ result_count: 1, results: [org()] }));
    vi.stubGlobal('fetch', f);
    const leads = await searchNpi('dentist', AUSTIN);
    const u = new URL(String(f.mock.calls[0][0]));
    expect(u.origin + u.pathname).toBe('https://npiregistry.cms.hhs.gov/api/');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ version: '2.1', taxonomy_description: 'Dentist', city: 'Austin', state: 'TX', enumeration_type: 'NPI-2', address_purpose: 'LOCATION', limit: '200' });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      name: '360 Dental Care', address: '3660 Stoneridge Rd Ste B101, Austin', phone: '512-327-3631', city: 'Austin', region: 'TX', signals: [],
      npi: { number: '1154494250', url: 'https://npiregistry.cms.hhs.gov/provider-view/1154494250', official: { name: 'Dr. Michael Nussbaum', title: 'President', credential: 'D.D.S.' } },
    });
    expect(leads[0].website).toBeUndefined();
    expect(leads[0].email).toBeUndefined();
  });
  it('uses the legal name when there is no trading name, and skips inactive or nameless entries', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ results: [
      org({ other_names: [] }), org({ basic: { status: 'D' }, other_names: [] }), org({ basic: { organization_name: '' }, other_names: [] }),
    ] }));
    vi.stubGlobal('fetch', f);
    expect((await searchNpi('dentist', AUSTIN)).map(l => l.name)).toEqual(['360 Dental Care P.A.']);
  });
  it('leaves out the official when the registry holds no real name, and drops the Dr. when the credential is not a doctor', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ results: [
      org({ basic: { authorized_official_first_name: '', authorized_official_last_name: '' } }),
      org({ number: '2', basic: { authorized_official_credential: 'MBA', authorized_official_title_or_position: 'Office Manager', authorized_official_first_name: 'ANA', authorized_official_middle_name: '', authorized_official_last_name: 'RUIZ' }, addresses: [{ address_purpose: 'LOCATION', address_1: '1 MAIN ST', city: 'AUSTIN', state: 'TX', telephone_number: '512-111-2222' }] }),
    ] }));
    vi.stubGlobal('fetch', f);
    const leads = await searchNpi('dentist', AUSTIN);
    expect(leads[0].npi?.official).toBeUndefined();
    expect(leads[1].npi?.official).toMatchObject({ name: 'Ana Ruiz', title: 'Office Manager' });
  });
  it('merges duplicate registry entries for the same practice', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ results: [org(), org({ basic: { organization_name: '360 DENTAL CARE PA' } })] }));
    vi.stubGlobal('fetch', f);
    expect(await searchNpi('dentist', AUSTIN)).toHaveLength(1);
  });
  it('asks for a second page only when the first is full', async () => {
    const page = (n: number) => json({ results: Array.from({ length: n }, (_, i) => org({ basic: { organization_name: `PRACTICE ${n}-${i}` }, other_names: [], addresses: [{ address_purpose: 'LOCATION', address_1: `${i} MAIN ST`, city: 'AUSTIN', state: 'TX', telephone_number: `512-000-${1000 + i}` }] })) });
    const f = vi.fn().mockResolvedValueOnce(page(200)).mockResolvedValueOnce(page(50));
    vi.stubGlobal('fetch', f);
    expect(await searchNpi('dentist', AUSTIN)).toHaveLength(250);
    expect(new URL(String(f.mock.calls[1][0])).searchParams.get('skip')).toBe('200');
    const g = vi.fn().mockResolvedValueOnce(page(10));
    vi.stubGlobal('fetch', g);
    await searchNpi('dentist', AUSTIN);
    expect(g).toHaveBeenCalledTimes(1);
  });
  it('does nothing, and makes no request, for places outside the US or types the registry does not hold', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await searchNpi('dentist', { ...AUSTIN, countryCode: 'au' })).toEqual([]);
    expect(await searchNpi('plumber', AUSTIN)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
  it('is optional: a failing registry gives no leads, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await searchNpi('dentist', AUSTIN)).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response));
    expect(await searchNpi('dentist', AUSTIN)).toEqual([]);
  });
});

describe('mergeSources', () => {
  const osm = (o: Partial<SourceLead> = {}): SourceLead => ({ name: 'Smile 360', address: '3660 Stoneridge Rd, Austin', website: 'https://smile360.example', signals: [], osmUrl: 'https://www.openstreetmap.org/node/1', ...o });
  const reg = (o: Partial<SourceLead> = {}): SourceLead => ({ name: '360 Dental Care', address: '3660 Stoneridge Rd Ste B101, Austin', phone: '512-327-3631', signals: [],
    npi: { number: '1', url: 'https://npiregistry.cms.hhs.gov/provider-view/1', official: { name: 'Dr. Michael Nussbaum', title: 'President' } }, ...o });

  it('matches the same practice by phone number, and fills the map entry in from the registry', () => {
    const m = mergeSources([osm({ phone: '+1 512-327-3631' })], [reg()]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ name: 'Smile 360', website: 'https://smile360.example', npi: { official: { name: 'Dr. Michael Nussbaum' } } });
    expect(m[0].npiOnly).toBeUndefined();
  });
  it('matches by street number plus a shared word in the name when the map has no phone', () => {
    const m = mergeSources([osm({ name: '360 Smile Studio', address: '3660 Stoneridge Rd, Austin' })], [reg({ phone: '512-999-0000' })]);
    expect(m).toHaveLength(1);
    expect(m[0].phone).toBe('512-999-0000'); // missing phone filled in
  });
  it('does not merge a different practice at the same address when no name word is shared', () => {
    expect(mergeSources([osm({ name: 'Stoneridge Orthodontics', address: '3660 Stoneridge Rd, Austin' })], [reg({ phone: '512-999-0000' })])).toHaveLength(2);
  });
  it('does not merge different practices that only share a word', () => {
    const m = mergeSources([osm({ name: 'Austin Dental Studio', address: '10 Elm St, Austin', phone: '512-555-0001' })], [reg()]);
    expect(m).toHaveLength(2);
  });
  it('adds registry-only practices after the map ones, marked, up to the limit', () => {
    const extra = Array.from({ length: 80 }, (_, i) => reg({ name: `Practice ${i}`, address: `${i} Oak St, Austin`, phone: `512-000-${2000 + i}` }));
    const m = mergeSources([osm()], extra, 50);
    expect(m).toHaveLength(51);
    expect(m[0].name).toBe('Smile 360');
    expect(m.slice(1).every(l => l.npiOnly === true)).toBe(true);
  });
  it('does not overwrite what the map already has', () => {
    const m = mergeSources([osm({ phone: '512-327-3631', address: 'Different Address 5' })], [reg()]);
    expect(m[0].address).toBe('Different Address 5');
  });
  it('with no registry results returns the map results untouched', () => {
    const o = [osm()];
    expect(mergeSources(o, [])).toEqual(o);
  });
});

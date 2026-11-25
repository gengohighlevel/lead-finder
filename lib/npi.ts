import type { OsmLead } from './osm';
import type { OvertureInfo } from './db';
import type { Place } from './place';

/**
 * US healthcare practices from the public NPI registry (CMS): free, no key, official records. It adds what the map lacks in the
 * US (a chiropractor search found almost nothing on the map): the practice's name, address and phone, plus the authorized
 * official the practice registered, usually the owner. It holds no websites or emails, so those still come from the map and
 * the practice's own site.
 */
export type NpiInfo = { number: string; url: string; official?: { name: string; title?: string; credential?: string } };
export type SourceLead = OsmLead & { npi?: NpiInfo; npiOnly?: boolean; overture?: OvertureInfo };

const API = 'https://npiregistry.cms.hhs.gov/api/';
const PAGE = 200;     // the registry's maximum per request
const MAX_PAGES = 2;  // skip may not pass 1000; two pages is plenty for one city

const TAXONOMY: [RegExp, string][] = [
  [/orthodont/, 'Orthodontics'], [/dent|dds|dmd/, 'Dentist'], [/chiropract/, 'Chiropractor'], [/physio|physical therap/, 'Physical Therapist'],
  [/optom|optic/, 'Optometrist'], [/podiat/, 'Podiatrist'], [/pharmac/, 'Pharmacy'], [/psycholog/, 'Psychologist'], [/dermatolog/, 'Dermatology'],
  [/acupunct/, 'Acupuncturist'], [/audiolog/, 'Audiologist'], [/dietit|nutrition/, 'Dietitian'], [/massage/, 'Massage Therapist'],
  [/urgent care/, 'Urgent Care'], [/counsel|therapist/, 'Counselor'], [/clinic|medical cent/, 'Clinic/Center'], [/doctor|physician|\bgp\b|family medicine/, 'Family Medicine'],
];
/** The registry's name for a business type, or undefined when it does not hold that kind of business. */
export function npiTaxonomy(type: string): string | undefined {
  const t = type.toLowerCase();
  return TAXONOMY.find(([re]) => re.test(t))?.[1];
}

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

/** "Austin, Travis County, Texas, United States" -> Austin, TX. Only US places that are a city or town. */
export function placeCityState(place: Place): { city: string; state: string } | undefined {
  if (place.countryCode?.toLowerCase() !== 'us') return undefined;
  const parts = place.label.split(',').map(s => s.trim()).filter(Boolean);
  const state = [...parts].reverse().map(p => STATES[p.toLowerCase()]).find(Boolean);
  const city = parts[0];
  if (!state || !city || STATES[city.toLowerCase()] === state && parts.length < 3 && STATES[city.toLowerCase()]) return undefined;
  if (/\b(county|parish|borough|state|province)\b/i.test(city) || (STATES[city.toLowerCase()] && parts.length <= 2)) return undefined;
  return { city, state };
}

const KEEP_UPPER = /^(?:P\.?A\.?|P\.?C\.?|PLLC|PLC|LLC|LLP|LP|INC|DDS|DMD|MD|DO|DC|OD|DPM|MS|PhD|II|III|IV|USA|TX|CA|NY|FL|NW|NE|SW|SE|N|S|E|W)$/i;
const SMALL = new Set(['and', 'of', 'the', 'for', 'at', 'in', 'a', 'an']);

/** "360 DENTAL CARE P.A." -> "360 Dental Care P.A.". Leaves names that are already mixed case alone. */
export function titleCase(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t !== t.toUpperCase()) return t;
  return t.split(' ').map((w, i) => {
    if (/^[^A-Za-z]*$/.test(w) || w === '&') return w;
    if (KEEP_UPPER.test(w) && /^(?:P\.?A\.?|P\.?C\.?|PLLC|LLC|LLP|INC|DDS|DMD|MD|DO|DC|OD|DPM|II|III|IV)$/i.test(w)) return w.toUpperCase().replace(/^PA$/, 'PA').replace(/^PC$/, 'PC');
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    // O'BRIEN -> O'Brien, MCDONALD -> McDonald, SMITH-JONES -> Smith-Jones
    return lower.replace(/(^|[-'’])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase()).replace(/^Mc(\p{L})/u, (_, c) => 'Mc' + c.toUpperCase());
  }).join(' ');
}

const ACRONYMS = new Set('ceo coo cfo cto cio cmo vp svp evp dc dds dmd md do od dpm dvm dpt phd rn np pa lmt pt ot pta cota llc pllc pc'.split(' '));
/** A job title as the registry holds it ("PRESIDENT", "president", "Coo") made readable: "President", "COO". */
export function tidyTitle(raw: string | undefined): string | undefined {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t || /^-+$/.test(t)) return undefined;
  return t.replace(/[A-Za-z][A-Za-z'’]*/g, w => ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase()
    : w === w.toUpperCase() || w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);
}

const DOCTOR_CREDENTIAL = /\b(?:D\.?D\.?S|D\.?M\.?D|M\.?D|D\.?O|D\.?C|O\.?D|D\.?P\.?M|D\.?V\.?M|Ph\.?D)\b/i;

type Rec = {
  number?: string; basic?: Record<string, string | undefined>; other_names?: { type?: string; organization_name?: string }[];
  addresses?: Record<string, string | undefined>[];
};

function toLead(r: Rec): SourceLead | undefined {
  const b = r.basic ?? {};
  if (b.status && b.status !== 'A') return undefined;
  const dba = r.other_names?.find(o => /doing business as/i.test(o.type ?? ''))?.organization_name;
  const name = titleCase(dba?.trim() || b.organization_name || '');
  if (!name || !r.number) return undefined;
  const loc = r.addresses?.find(a => a.address_purpose === 'LOCATION') ?? r.addresses?.[0];
  if (!loc) return undefined;
  const street = titleCase(loc.address_1 ?? ''), city = titleCase(loc.city ?? '');

  const first = titleCase(b.authorized_official_first_name ?? ''), last = titleCase(b.authorized_official_last_name ?? '');
  let official: NpiInfo['official'];
  if (first && last && !/^-+$/.test(first)) {
    const credential = b.authorized_official_credential?.trim() || undefined;
    const prefix = (b.authorized_official_name_prefix ?? '').trim();
    const dr = /^dr\.?$/i.test(prefix) || (!prefix || /^-+$/.test(prefix)) && !!credential && DOCTOR_CREDENTIAL.test(credential);
    const title = tidyTitle(b.authorized_official_title_or_position);
    official = { name: `${dr ? 'Dr. ' : ''}${first} ${last}`, ...(title ? { title } : {}), ...(credential ? { credential } : {}) };
  }
  return {
    name, address: [street, city].filter(Boolean).join(', ') || undefined, phone: loc.telephone_number || undefined,
    signals: [], city: city || undefined, region: loc.state || undefined,
    npi: { number: r.number, url: `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`, ...(official ? { official } : {}) },
  };
}

const SIGNIFICANT = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  .filter(w => w.length > 2 && !new Set(['llc', 'pllc', 'inc', 'pllc', 'dds', 'dmd', 'the', 'and', 'dental', 'dentistry', 'family', 'cosmetic', 'center', 'centre', 'clinic', 'care', 'associates', 'group', 'practice', 'office', 'health', 'medical', 'professional', 'professionals']).has(w));
const fingerprint = (l: SourceLead) => `${(l.name ?? '').toLowerCase().replace(/\b(?:p\.?a\.?|p\.?c\.?|pllc|llc|inc|dds|dmd)\b/g, '').replace(/[^a-z0-9]/g, '')}|${(l.address ?? '').toLowerCase().match(/\d+/)?.[0] ?? ''}`;

/** The registry as leads. Optional: any failure gives no leads rather than an error. */
export async function searchNpi(type: string, place: Place): Promise<SourceLead[]> {
  const taxonomy = npiTaxonomy(type), where = placeCityState(place);
  if (!taxonomy || !where) return [];
  const out: SourceLead[] = [], seen = new Set<string>();
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ version: '2.1', taxonomy_description: taxonomy, city: where.city, state: where.state, enumeration_type: 'NPI-2', address_purpose: 'LOCATION', limit: String(PAGE), skip: String(page * PAGE) });
      const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': 'lead-finder/1.0' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) break;
      const data = (await res.json()) as { results?: Rec[] };
      const rows = data.results ?? [];
      for (const r of rows) {
        const lead = toLead(r);
        if (!lead) continue;
        const key = fingerprint(lead);
        if (seen.has(key)) continue;
        seen.add(key); out.push(lead);
      }
      if (rows.length < PAGE) break;
    }
  } catch { /* the registry is a bonus source */ }
  return out;
}

const digits = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-10);
const streetNo = (a?: string) => a?.match(/\d+/)?.[0];

/**
 * Map results first and untouched, enriched where the registry knows the same practice (matched by phone, or by street number
 * plus a shared word of the name). Registry practices the map does not have follow, marked, at most `extra` of them.
 */
export function mergeSources(map: SourceLead[], registry: SourceLead[], extra = 50): SourceLead[] {
  if (!registry.length) return map;
  const out = map.map(l => ({ ...l }));
  const byPhone = new Map<string, SourceLead>();
  for (const l of out) if (digits(l.phone).length === 10) byPhone.set(digits(l.phone), l);
  const rest: SourceLead[] = [];
  for (const r of registry) {
    const hit = (digits(r.phone).length === 10 && byPhone.get(digits(r.phone)))
      || out.find(l => streetNo(l.address) && streetNo(l.address) === streetNo(r.address) && SIGNIFICANT(l.name).some(w => SIGNIFICANT(r.name).includes(w)));
    if (!hit) { rest.push({ ...r, npiOnly: true }); continue; }
    hit.npi ??= r.npi;
    hit.phone ??= r.phone;
    hit.address ??= r.address;
    hit.city ??= r.city;
    hit.region ??= r.region;
  }
  return [...out, ...rest.slice(0, extra)];
}

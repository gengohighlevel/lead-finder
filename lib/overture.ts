import type { Place } from './place';
import type { SourceLead } from './npi';
import { throttle } from './geocode';
import { domainOf, normName } from './research';
import { latestRelease, queryRows } from './overtureDb';

/**
 * Overture Maps places: a free, open, worldwide dataset (Meta, Foursquare and others) with names, phones and websites.
 * It fills what OpenStreetMap lacks, mostly service businesses with no storefront. Optional source: any failure gives
 * no leads rather than an error. It never supplies an email: the listed ones are unverified and often a sole trader's
 * personal address, so emails still come only from the business's own website.
 */

const SLUG = /^[a-z0-9_]+$/;
const RELEASE_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;
const MIN_CONFIDENCE = 0.3;   // below this the sample showed wrong categories and long-dead listings
const SQL_LIMIT = 600;        // rows pulled from the data before the exact area is applied
const MAX_LEADS = 150;
const TIMEOUT_MS = 25_000;
const NODE_RADIUS_KM = 5;

// Overture has no single "dentist": the practice types are spread over several categories. Keys mirror lib/osmTags.ts.
const CATS: Record<string, string[]> = {
  dentist: ['dental_clinic', 'general_dentistry', 'dentist', 'cosmetic_dentistry', 'pediatric_dentistry', 'orthodontics', 'endodontics', 'periodontics'],
  doctor: ['doctors_office', 'family_practice', 'primary_care_or_general_clinic'], clinic: ['primary_care_or_general_clinic', 'public_health_clinic', 'urgent_care_clinic', 'outpatient_care_facility'],
  pharmacy: ['pharmacy', 'drugstore'], veterinarian: ['veterinarian'], chiropractor: ['chiropractic'], physiotherapist: ['physical_therapy'],
  optician: ['eyewear_store', 'optometry'], optometrist: ['optometry', 'vision_or_eye_care_clinic'], massage: ['massage_therapy'],
  restaurant: ['restaurant'], cafe: ['cafe', 'coffee_shop'], bar: ['bar', 'cocktail_bar', 'pub'], bakery: ['bakery'], hotel: ['hotel'], 'bed and breakfast': ['bed_and_breakfast'],
  gym: ['gym', 'fitness_trainer', 'sport_or_fitness_facility'], 'yoga studio': ['yoga_studio'],
  salon: ['hair_salon', 'beauty_salon', 'hair_stylist'], barber: ['barber'], beauty: ['beauty_salon', 'skin_care_and_makeup'], 'nail salon': ['nail_salon'],
  spa: ['spa', 'day_spa', 'medical_spa'], tattoo: ['tattoo_and_piercing', 'tattoo'],
  lawyer: ['attorney_or_law_firm', 'legal_service'], accountant: ['accountant', 'bookkeeper', 'tax_service'], 'tax advisor': ['tax_service'],
  realtor: ['real_estate_agent', 'real_estate_service'], insurance: ['insurance_agency'], architect: ['architect', 'architectural_designer'],
  'marketing agency': ['marketing_agency', 'advertising_agency', 'internet_marketing_service'], 'advertising agency': ['advertising_agency', 'marketing_agency'],
  'it company': ['information_technology_company', 'it_service_and_computer_repair'], 'travel agency': ['travel_agent', 'travel_service'],
  'employment agency': ['employment_agency'], consultant: ['business_consulting'], 'financial advisor': ['financial_advising'],
  movers: ['mover'], 'self storage': ['self_storage_facility', 'storage_facility'],
  plumber: ['plumbing'], electrician: ['electrician'], hvac: ['hvac_service'], roofer: ['roofing'], contractor: ['contractor', 'builder', 'building_or_construction_service'],
  painter: ['painting'], carpenter: ['carpenter'], gardener: ['landscaping', 'gardener', 'lawn_service'], locksmith: ['key_and_locksmith'],
  photographer: ['photography_service', 'event_photography_service', 'session_photography_service'], tiler: ['flooring_contractor'], glazier: ['glass_and_mirror_sales_service'],
  florist: ['florist', 'flowers_and_gifts_store'], mechanic: ['automotive_repair', 'automotive_service'], 'car dealer': ['auto_dealer', 'used_auto_dealer'],
  'driving school': ['driving_school'], 'pet shop': ['pet_store'], jeweler: ['jewelry_store'], 'dry cleaner': ['dry_cleaning'], laundry: ['laundromat', 'laundry_service'],
  childcare: ['child_care_and_day_care', 'day_care_preschool'], kindergarten: ['preschool', 'day_care_preschool'],
  // solopreneurs: one-person businesses that often have no website and live on Instagram or Facebook
  'makeup artist': ['makeup_artist', 'permanent_makeup'], 'lash technician': ['eyelash_service'], 'brow artist': ['eyebrow_service'],
  esthetician: ['esthetician', 'waxing'], waxing: ['waxing'], 'hair stylist': ['hair_stylist', 'hair_salon'],
  'personal trainer': ['fitness_trainer'], 'life coach': ['life_coach'], 'health coach': ['health_coaching'], nutritionist: ['nutrition_service'],
  therapist: ['counseling', 'psychotherapy'], hypnotherapist: ['hypnotherapy'], 'speech therapist': ['speech_therapy'], doula: ['doula_service'],
  tutor: ['tutoring_service', 'private_tutor'], 'music teacher': ['music_school', 'vocal_coach'], 'dog trainer': ['dog_trainer'],
  'pet groomer': ['pet_groomer'], 'pet sitter': ['pet_sitting'], 'wedding planner': ['wedding_planning'], 'event planner': ['party_and_event_planning'],
  dj: ['dj_service'], videographer: ['videographer'], 'interior designer': ['interior_design'], 'graphic designer': ['graphic_designer'],
  'web designer': ['web_designer'], bookkeeper: ['bookkeeper'], notary: ['notary_public'], 'house cleaner': ['home_cleaning', 'cleaning_service'],
  handyman: ['handyman'], tailor: ['tailor', 'sewing_and_alterations'], caterer: ['caterer'],
  // rentals: owners and operators who live on bookings
  'car rental': ['car_rental_service'], 'truck rental': ['truck_rental_service'], 'motorcycle rental': ['motorcycle_rental_service'], 'rv rental': ['rv_rental_service'],
  'yacht rental': ['boat_charter', 'boat_rental_and_training', 'boat_hire_service'],
  // not service_apartment: that is hotel-style chains (Mantra, Peppers, Sonesta), not owners. Ask for 'serviced apartment' on its own.
  'short term rental': ['holiday_rental_home', 'vacation_rental_agent', 'cabin'], 'serviced apartment': ['service_apartment'],
  'vacation rental manager': ['vacation_rental_agent', 'property_management'], 'property manager': ['property_management'],
};
const ALIAS: Record<string, string> = {
  dental: 'dentist', 'dental clinic': 'dentist', vet: 'veterinarian', physio: 'physiotherapist', coffee: 'cafe', 'hair salon': 'salon', hairdresser: 'salon',
  attorney: 'lawyer', 'law firm': 'lawyer', accounting: 'accountant', 'real estate': 'realtor', 'real estate agent': 'realtor', 'insurance agent': 'insurance',
  'moving company': 'movers', mover: 'movers', removals: 'movers', removalist: 'movers', storage: 'self storage', builder: 'contractor', landscaper: 'gardener',
  'car repair': 'mechanic', daycare: 'childcare', fitness: 'gym',
  mua: 'makeup artist', makeup: 'makeup artist', 'make up artist': 'makeup artist', 'lash tech': 'lash technician', 'lash artist': 'lash technician', 'eyelash technician': 'lash technician',
  'brow technician': 'brow artist', 'hairstylist': 'hair stylist', 'hair dresser': 'hair stylist', 'massage therapist': 'massage', 'nail technician': 'nail salon', 'nail artist': 'nail salon',
  'tattoo artist': 'tattoo', 'personal training': 'personal trainer', trainer: 'personal trainer', coach: 'life coach', dietitian: 'nutritionist', counselor: 'therapist', counsellor: 'therapist',
  'private tutor': 'tutor', tutoring: 'tutor', 'dog groomer': 'pet groomer', groomer: 'pet groomer', 'dog walker': 'pet sitter', 'wedding photographer': 'photographer',
  'event photographer': 'photographer', 'cleaner': 'house cleaner', 'house cleaning': 'house cleaner', 'cleaning service': 'house cleaner', seamstress: 'tailor', 'dressmaker': 'tailor',
  'car hire': 'car rental', 'rental car': 'car rental', 'car rentals': 'car rental', 'car rental company': 'car rental', 'car hire company': 'car rental', 'van rental': 'truck rental', 'scooter rental': 'motorcycle rental',
  'yacht charter': 'yacht rental', 'yacht hire': 'yacht rental', 'boat rental': 'yacht rental', 'boat hire': 'yacht rental', 'boat charter': 'yacht rental', 'sailing charter': 'yacht rental', 'yacht': 'yacht rental', 'boat rentals': 'yacht rental',
  'short-term rental': 'short term rental', 'short term rentals': 'short term rental', 'vacation rental': 'short term rental', 'vacation rentals': 'short term rental', 'holiday rental': 'short term rental',
  'holiday rentals': 'short term rental', 'holiday home': 'short term rental', 'holiday let': 'short term rental', 'airbnb host': 'short term rental', 'airbnb': 'short term rental', 'str host': 'short term rental', 'villa rental': 'short term rental',
  'property management': 'property manager', 'vacation rental management': 'vacation rental manager', 'short term rental manager': 'vacation rental manager',
  'personal chef': 'caterer', catering: 'caterer', 'notary public': 'notary', 'bookkeeping': 'bookkeeper', 'handy man': 'handyman', 'virtual assistant': 'consultant',
};

/** Overture categories for a business type. Unknown types try the words themselves as a category name. */
export function overtureCategories(type: string): string[] {
  const t = type.trim().toLowerCase().replace(/\s+/g, ' ');
  const singular0 = t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
  for (const k of [t, singular0]) { const key = ALIAS[k] ?? k; if (CATS[key]) return CATS[key]; }
  const slug = t.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug || slug.length > 40) return [];
  const singular = slug.endsWith('s') && !slug.endsWith('ss') ? slug.slice(0, -1) : slug;
  return [...new Set([slug, `${slug}_service`, singular, `${singular}_service`])];
}

// ---- the exact area ----

export type Boundary = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (x: number, y: number, rings: number[][][]) => !!rings.length && inRing(x, y, rings[0]) && !rings.slice(1).some(h => inRing(x, y, h));

/** Is the point (lon, lat) inside the boundary? Holes are respected. */
export function pointInBoundary(lon: number, lat: number, b: Boundary): boolean {
  return b.type === 'Polygon' ? inPolygon(lon, lat, b.coordinates) : b.coordinates.some(p => inPolygon(lon, lat, p));
}

const km = (aLon: number, aLat: number, bLon: number, bLat: number) => {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

const boundaries = new Map<string, Boundary>();
/** The place's real outline from Nominatim (the same free service the app already uses). undefined when it cannot be had. */
async function fetchBoundary(place: Place): Promise<Boundary | undefined> {
  if (place.osmType === 'node') return undefined;
  const key = `${place.osmType}${place.osmId}`;
  const hit = boundaries.get(key);
  if (hit) return hit;
  try {
    await throttle();
    const id = `${place.osmType === 'relation' ? 'R' : 'W'}${place.osmId}`;
    const res = await fetch(`https://nominatim.openstreetmap.org/lookup?osm_ids=${id}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0005`,
      { headers: { 'User-Agent': 'lead-finder/1.0' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return undefined;
    const g = ((await res.json()) as { geojson?: Boundary }[])?.[0]?.geojson;
    if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) { boundaries.set(key, g); return g; }
  } catch { /* fall back to the box */ }
  return undefined;
}

function searchBox(place: Place): [number, number, number, number] {
  if (place.bbox && place.bbox.every(Number.isFinite)) return place.bbox;
  const dLat = NODE_RADIUS_KM / 111, dLon = NODE_RADIUS_KM / (111 * Math.max(Math.cos((place.lat * Math.PI) / 180), 0.2));
  return [place.lat - dLat, place.lat + dLat, place.lon - dLon, place.lon + dLon];
}

// ---- the data ----

const num = (n: unknown) => { if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('bad number in query'); return n; };
const list = (xs: string[]) => { if (!xs.length || !xs.every(x => SLUG.test(x))) throw new Error('bad category'); return xs.map(x => `'${x}'`).join(','); };

/** The query for one release. Every value is checked first, so nothing a user types can reach the SQL as code. */
export function buildPlacesSql(o: { release: string; categories: string[]; bbox: [number, number, number, number]; limit: number }): string {
  if (!RELEASE_RE.test(o.release)) throw new Error('bad release');
  const [s, n, w, e] = o.bbox.map(num);
  const cats = list(o.categories);
  return `SELECT id, names.primary AS name, taxonomy.primary AS cat, websites[1] AS web, phones[1] AS phone, socials,
  addresses[1].freeform AS street, addresses[1].locality AS city, addresses[1].region AS region,
  confidence AS conf, operating_status AS status, sources[1].dataset AS dataset, bbox.xmin AS lon, bbox.ymin AS lat
FROM read_parquet('s3://overturemaps-us-west-2/release/${o.release}/theme=places/type=place/*', hive_partitioning=1)
WHERE bbox.xmin BETWEEN ${w} AND ${e} AND bbox.ymin BETWEEN ${s} AND ${n}
  AND (taxonomy.primary IN (${cats}) OR list_has_any(taxonomy.alternates, [${cats}]))
  AND confidence >= ${MIN_CONFIDENCE} AND coalesce(operating_status, 'open') NOT IN ('closed','permanently_closed')
ORDER BY confidence DESC LIMIT ${num(o.limit)}`;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function rowToLead(r: Record<string, unknown>): SourceLead | undefined {
  const name = str(r.name);
  if (!name) return undefined;
  const socials = (Array.isArray(r.socials) ? r.socials : []).map(String);
  const ig = socials.map(s => s.match(/instagram\.com\/([A-Za-z0-9._]+)/i)?.[1]).find(Boolean);
  const facebook = socials.find(s => /^https?:\/\/(?:[a-z0-9-]+\.)?facebook\.com\//i.test(s));
  const city = str(r.city);
  return {
    name, website: str(r.web), phone: str(r.phone), instagram: ig,
    address: [str(r.street), city].filter(Boolean).join(', ') || undefined,
    signals: [], city, region: str(r.region),
    overture: { id: String(r.id ?? ''), confidence: Number(r.conf) || 0, ...(str(r.dataset) ? { dataset: str(r.dataset) } : {}), ...(facebook ? { facebook } : {}) },
  };
}

const cache = new Map<string, SourceLead[]>();

async function find(type: string, place: Place): Promise<SourceLead[]> {
  const categories = overtureCategories(type);
  if (!categories.length) return [];
  const key = `${categories.join(',')}|${place.osmType}${place.osmId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [boundary, release] = await Promise.all([fetchBoundary(place), latestRelease()]);
  const rows = await queryRows(buildPlacesSql({ release, categories, bbox: searchBox(place), limit: SQL_LIMIT }));
  const inside = rows.filter(r => {
    const lon = Number(r.lon), lat = Number(r.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    if (boundary) return pointInBoundary(lon, lat, boundary);
    return place.osmType === 'node' ? km(place.lon, place.lat, lon, lat) <= NODE_RADIUS_KM : true;
  });
  const out = inside.sort((a, b) => Number(b.conf) - Number(a.conf)).map(rowToLead).filter((l): l is SourceLead => !!l).slice(0, MAX_LEADS);
  cache.set(key, out);
  return out;
}

/** Businesses of this type inside the place, best listing first. Never throws and never waits longer than TIMEOUT_MS. */
export async function searchOverture(type: string, place: Place): Promise<SourceLead[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([find(type, place), new Promise<SourceLead[]>(res => { timer = setTimeout(() => res([]), TIMEOUT_MS); })]);
  } catch { return []; } finally { clearTimeout(timer); }
}

// ---- merging ----

const GENERIC = new Set(['the', 'and', 'pty', 'ltd', 'llc', 'inc', 'company', 'services', 'service', 'group', 'movers', 'mover', 'moving', 'removals', 'removalist', 'removalists', 'storage', 'dental', 'dentist', 'clinic', 'centre', 'center', 'care', 'plumbing', 'electrical', 'cleaning', 'australia', 'brisbane']);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !GENERIC.has(w));
const phone10 = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-9);

function same(a: SourceLead, b: SourceLead): boolean {
  const da = domainOf(a.website), db = domainOf(b.website);
  if (da && da === db) return true;
  const na = normName(a.name), nb = normName(b.name);
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 6 && long.includes(short)) return true;
  // the same phone is a match only when the names also share a distinctive word (1300 numbers are shared by unrelated firms)
  const pa = phone10(a.phone);
  return pa.length >= 8 && pa === phone10(b.phone) && words(a.name).some(w => words(b.name).includes(w));
}

/**
 * Map results first. Where Overture knows the same business it fills what the map lacks (website, phone, Instagram) instead of
 * adding a twin; businesses the map does not have follow, at most `max` of them. Duplicates inside Overture are dropped.
 */
export function mergeOverture(base: SourceLead[], extra: SourceLead[], max = 100): SourceLead[] {
  if (!extra.length) return base;
  const out = base.map(l => ({ ...l }));
  let added = 0;
  for (const o of extra) {
    const hit = out.find(l => same(l, o));
    if (hit) {
      hit.website ??= o.website; hit.phone ??= o.phone; hit.instagram ??= o.instagram; hit.address ??= o.address;
      hit.city ??= o.city; hit.region ??= o.region; hit.overture ??= o.overture;
    } else if (added < max) { out.push({ ...o }); added++; }
  }
  return out;
}

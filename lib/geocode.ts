import { LocationNotFoundError, type Place } from './place';

const EU = ['at','be','bg','hr','cy','cz','dk','ee','fi','fr','de','gr','hu','ie','it','lv','lt','lu','mt','nl','pl','pt','ro','sk','si','es','se'];
const FOCUS = ['us', 'ca', 'au', 'nz', 'ph', ...EU];

/** 'all' | 'eu' | 'world' | 'us' | 'ca' | 'au' | 'nz' | 'ph' | any 2-letter code -> Nominatim countrycodes list ('' = no filter) */
export function countryCodes(market?: string): string {
  const m = (market ?? 'all').toLowerCase();
  if (m === 'all') return FOCUS.join(',');
  if (m === 'eu') return EU.join(',');
  if (m === 'world') return '';
  return /^[a-z]{2}$/.test(m) ? m : FOCUS.join(',');
}

export function areaClause(p: Pick<Place, 'osmType' | 'osmId' | 'lat' | 'lon'>): { def: string; filter: string } {
  if (p.osmType === 'relation') return { def: `area(${3_600_000_000 + p.osmId})->.a;`, filter: '(area.a)' };
  if (p.osmType === 'way') return { def: `area(${2_400_000_000 + p.osmId})->.a;`, filter: '(area.a)' };
  return { def: '', filter: `(around:5000,${p.lat},${p.lon})` };
}

let last = 0;
/** Nominatim's usage policy: at most one request per second, shared by every caller in this process. */
export async function throttle() {
  const wait = 1000 - (Date.now() - last);
  last = Date.now() + Math.max(wait, 0); // reserve slot synchronously so concurrent calls queue
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

type Row = { osm_type: string; osm_id: number; display_name: string; lat: string; lon: string; category?: string; boundingbox?: string[]; address?: { country_code?: string } };

export async function geocode(query: string, countrycodes?: string): Promise<Place[]> {
  await throttle();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&q=${encodeURIComponent(query)}`
    + (countrycodes ? `&countrycodes=${encodeURIComponent(countrycodes)}` : '');
  const res = await fetch(url, { headers: { 'User-Agent': 'lead-finder/1.0' } });
  if (!res.ok) throw new Error(`Geocoding service error (${res.status}). Wait a few seconds and try again.`);
  const rows = (await res.json()) as Row[];
  if (!Array.isArray(rows) || !rows.length) throw new LocationNotFoundError(query);
  const areaLike = rows.filter(r => r.category === 'boundary' || r.category === 'place');
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const r of areaLike.length ? areaLike : rows) {
    if (seen.has(r.display_name)) continue;
    seen.add(r.display_name);
    out.push({
      osmType: r.osm_type as Place['osmType'], osmId: r.osm_id, lat: Number(r.lat), lon: Number(r.lon),
      label: r.display_name, countryCode: r.address?.country_code,
      ...(r.boundingbox?.length === 4 ? { bbox: r.boundingbox.map(Number) as [number, number, number, number] } : {}),
    });
  }
  return out;
}

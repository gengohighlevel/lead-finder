import type { OsmLead } from './osm';
import type { Place } from './place';
import { throttle } from './geocode';
import { mapTypeToTags } from './osmTags';

type Row = {
  place_id: number; osm_type?: string; osm_id?: number; name?: string; category?: string;
  address?: Record<string, string | undefined>; extratags?: Record<string, string | undefined> | null;
};
const SKIP = new Set(['boundary', 'place', 'highway', 'landuse', 'natural', 'railway', 'waterway']);
const PAGE = 40; // Nominatim's maximum per request

function igHandle(v?: string): string | undefined {
  if (!v) return undefined;
  const m = v.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return (m ? m[1] : v).replace(/^@/, '').replace(/\/$/, '') || undefined;
}

/**
 * Fallback business search through OpenStreetMap's place search (Nominatim) when every map server is down.
 * Same OpenStreetMap data, fewer results (40 a page) and a box instead of the exact boundary. Free; one request a second.
 */
export async function searchNominatim(type: string, place: Place, opts: { pages?: number; throttleMs?: number } = {}): Promise<OsmLead[]> {
  // A known business type is searched by its map tag ("[craft=plumber]"): in a test it found 3 Austin plumbers where
  // the plain word found none. Types with several tags (spa) are searched once per tag. Unknown types use the words.
  const queries = mapTypeToTags(type).map(t => `[${t.replace(/"/g, '')}]`);
  const seenLeads = new Set<string>();
  const merged: OsmLead[] = [];
  for (const q of queries.length ? queries : [type.trim()]) {
    for (const l of await searchOne(q, place, opts)) {
      const key = l.osmUrl ?? `${l.name}|${l.address ?? ''}`;
      if (!seenLeads.has(key)) { seenLeads.add(key); merged.push(l); }
    }
  }
  return merged.slice(0, 100);
}

async function searchOne(q: string, place: Place, opts: { pages?: number; throttleMs?: number }): Promise<OsmLead[]> {
  const [s, n, w, e] = place.bbox ?? [place.lat - 0.17, place.lat + 0.17, place.lon - 0.2, place.lon + 0.2];
  const pages = opts.pages ?? 3;
  const seen: number[] = [];
  const leads: OsmLead[] = [];
  for (let p = 0; p < pages; p++) {
    if (opts.throttleMs === 0) { /* tests */ } else await throttle();
    const params = new URLSearchParams({
      format: 'jsonv2', q, viewbox: [w, n, e, s].join(','), bounded: '1',
      limit: String(PAGE), extratags: '1', addressdetails: '1',
    });
    if (seen.length) params.set('exclude_place_ids', seen.join(','));
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'User-Agent': 'lead-finder/1.0' } });
    if (!res.ok) break;
    const rows = (await res.json()) as Row[];
    if (!Array.isArray(rows)) break;
    for (const r of rows) {
      seen.push(r.place_id);
      if (!r.name || SKIP.has(r.category ?? '')) continue;
      const a = r.address ?? {}, x = r.extratags ?? {};
      const city = a.city ?? a.town ?? a.village ?? a.suburb;
      const street = [a.house_number, a.road].filter(Boolean).join(' ');
      leads.push({
        name: r.name,
        address: [street, city].filter(Boolean).join(', ') || undefined,
        phone: x.phone ?? x['contact:phone'],
        email: x.email ?? x['contact:email'],
        website: x.website ?? x['contact:website'],
        instagram: igHandle(x['contact:instagram'] ?? x.instagram),
        signals: [],
        osmUrl: r.osm_type && r.osm_id ? `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` : undefined,
        city, region: a.state ?? a.province,
      });
    }
    if (rows.length < PAGE) break;
  }
  return leads.slice(0, 100);
}

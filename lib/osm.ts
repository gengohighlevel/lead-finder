import type { NewLead } from './db';
import { mapTypeToTags, nameKeywords } from './osmTags';
import { LocationNotFoundError, type Place } from './place';
import { areaClause } from './geocode';
export { mapTypeToTags };

export { LocationNotFoundError };

type OsmElement = { type?: string; id?: number; tags?: Record<string, string> };

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export class MapServersBusyError extends Error {
  constructor() { super('The free map servers are busy right now. Wait a minute and try again, or try a smaller area.'); this.name = 'MapServersBusyError'; }
}

const HEDGE_MS = 2500;    // a server that has not answered by now gets company: the next server is asked too
const PER_TRY_MS = 20_000;

async function askOne(url: string, query: string, signal: AbortSignal): Promise<{ elements: OsmElement[] }> {
  const res = await fetch(url, {
    method: 'POST', signal,
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const data = (await res.json()) as { elements: OsmElement[]; remark?: string };
  if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) throw new Error(data.remark);
  return data;
}

/**
 * Hedged request across the free mirrors. Ask one; if it fails, ask the next at once; if it is merely slow,
 * ask the next after HEDGE_MS as well. The first good answer wins and the rest are cancelled.
 * Worst case is one PER_TRY_MS wait instead of trying each server in turn.
 */
function overpass(query: string): Promise<{ elements: OsmElement[] }> {
  return new Promise((resolve, reject) => {
    const ctls: AbortController[] = [];
    let next = 0, running = 0, settled = false;
    let hedge: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(hedge); ctls.forEach(c => c.abort()); fn();
    };
    const launch = () => {
      if (settled || next >= ENDPOINTS.length) return;
      const url = ENDPOINTS[next++];
      running++;
      clearTimeout(hedge);
      hedge = setTimeout(launch, HEDGE_MS);
      const ctl = new AbortController();
      ctls.push(ctl);
      const timer = setTimeout(() => ctl.abort(), PER_TRY_MS);
      askOne(url, query, ctl.signal).then(
        data => finish(() => resolve(data)),
        () => {
          running--;
          if (next < ENDPOINTS.length) launch();
          else if (running === 0) finish(() => reject(new MapServersBusyError()));
        },
      ).finally(() => clearTimeout(timer));
    };
    launch();
  });
}

const HEADERS = { 'User-Agent': 'lead-finder/1.0' };
export type OsmLead = NewLead & { osmUrl?: string; city?: string; region?: string };
const cache = new Map<string, OsmLead[]>();
function igHandle(v?: string): string | undefined {
  if (!v) return undefined;
  const m = v.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const h = (m ? m[1] : v).replace(/^@/, '').replace(/\/$/, '');
  return h || undefined;
}

export async function searchOsm(type: string, place: Place): Promise<OsmLead[]> {
  const key = `${type.trim().toLowerCase()}|${place.osmType}${place.osmId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { def, filter } = areaClause(place);
  const tags = mapTypeToTags(type);
  const filters = tags.length
    ? tags.map(t => `nwr[${t}]${filter};`)
    : [`nwr["name"~"${nameKeywords(type).join('|')}",i]${filter};`];
  const query = `[out:json][timeout:25];${def}(${filters.join('')});out center tags 200;`;
  const data = await overpass(query);

  const leads: OsmLead[] = [];
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    if (!t.name) continue;
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const address = [street, t['addr:city']].filter(Boolean).join(', ') || undefined;
    leads.push({
      name: t.name,
      address,
      phone: t.phone ?? t['contact:phone'],
      email: t.email ?? t['contact:email'],
      website: t.website ?? t['contact:website'],
      instagram: igHandle(t['contact:instagram'] ?? t.instagram),
      signals: [],
      osmUrl: el.type && el.id ? `https://www.openstreetmap.org/${el.type}/${el.id}` : undefined,
      city: t['addr:city'], region: t['addr:state'] ?? t['addr:province'],
    });
  }
  const out = leads.slice(0, 100);
  cache.set(key, out);
  return out;
}

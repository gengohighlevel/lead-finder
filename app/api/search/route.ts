import { NextResponse } from 'next/server';
import { searchOsm, MapServersBusyError, type OsmLead } from '@/lib/osm';
import { searchNpi, mergeSources, type SourceLead } from '@/lib/npi';
import { searchOverture, mergeOverture } from '@/lib/overture';
import type { Place } from '@/lib/place';
import { searchNominatim } from '@/lib/nominatimSearch';
import { saveLeadsReport } from '@/lib/db';
import { mapTypeToTags } from '@/lib/osmTags';
import { dedupeLeads } from '@/lib/research';
import { hasRealName } from '@/lib/leadName';

const FALLBACK_AFTER_MS = 8000;

/**
 * The map search gives the exact area and more results, so it is preferred. If it has not answered after
 * FALLBACK_AFTER_MS, the place search starts alongside it; whichever then finishes first is used.
 * When the map servers are down this caps the wait at ~8 s + the place search, instead of waiting them out.
 */
async function findBusinesses(type: string, place: Place): Promise<{ raw: OsmLead[]; source: 'map' | 'fallback' }> {
  const map = searchOsm(type, place).then(raw => ({ raw, source: 'map' as const }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fallback = new Promise<{ raw: OsmLead[]; source: 'fallback' }>((resolve, reject) => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true; clearTimeout(timer);
      searchNominatim(type, place).then(raw => resolve({ raw, source: 'fallback' }), reject);
    };
    timer = setTimeout(start, FALLBACK_AFTER_MS);
    map.catch(e => (e instanceof MapServersBusyError ? start() : reject(e)));
  });
  try {
    // a map answer always wins if it is already in; otherwise the first good answer
    return await Promise.any([map, fallback]);
  } catch (e) {
    throw e instanceof AggregateError ? e.errors[0] : e;
  } finally { clearTimeout(timer); }
}

/**
 * Step 1 of a search: find the businesses and answer straight away. Websites are checked afterwards in batches
 * (/api/enrich), so the list appears in seconds instead of after every site has been read.
 */
export async function POST(req: Request) {
  const { type, place } = await req.json().catch(() => ({}));
  const validPlace = place && ['relation', 'way', 'node'].includes(place.osmType) && Number.isInteger(place.osmId)
    && Number.isFinite(place.lat) && Number.isFinite(place.lon);
  if (typeof type !== 'string' || !type.trim() || !validPlace) return NextResponse.json({ error: 'business type and a chosen place are required' }, { status: 400 });
  try {
    // the map, the US registry and Overture are asked at the same time; the last two are optional and never fail the search
    const registryP = searchNpi(type, place).catch((): SourceLead[] => []);
    const overtureP = searchOverture(type, place).catch((): SourceLead[] => []);
    const mapRes = await findBusinesses(type, place).then(r => r, (e: unknown) => e as Error);
    const [registry, overture] = await Promise.all([registryP, overtureP]);
    if (mapRes instanceof Error && !registry.length && !overture.length) throw mapRes;
    const mapLeads = mapRes instanceof Error ? [] : mapRes.raw;
    const source = mapRes instanceof Error ? (registry.length ? 'registry' : 'overture') : mapRes.source;
    const leads = dedupeLeads(mergeOverture(mergeSources(mapLeads, registry), overture).filter(l => hasRealName(l.name))).map(({ osmUrl, city, region, npi, npiOnly, overture: ov, ...l }) => ({ ...l, origin: { osmUrl, city, region, npi, npiOnly, overture: ov } }));
    const key = `${type.trim().toLowerCase()}|${place.osmType}${place.osmId}`;
    const saved = saveLeadsReport(key, leads);
    return NextResponse.json({
      leads: saved.leads, skippedExisting: saved.skipped.length, skippedNames: saved.skipped.slice(0, 20), matchedBy: mapTypeToTags(type).length ? 'category' : 'name', source,
      fromRegistry: leads.filter(l => l.origin.npi).length, fromOverture: leads.filter(l => l.origin.overture).length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'search failed' }, { status: 502 });
  }
}

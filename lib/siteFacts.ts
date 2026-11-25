import * as cheerio from 'cheerio';

/**
 * Specific facts read from a business's OWN website, used to make the first email about that business and nobody else's.
 * Only two things, and only when the page states them:
 *   locality  the suburb or town in the page's structured address data (schema.org), e.g. "Kenmore"
 *   services  what the site's menus and headings name, from a short fixed list per kind of business (so a service is
 *             only mentioned when its own word is on the page; the app never guesses one)
 * Pure. Takes the page text already fetched.
 */
export type SiteFacts = { locality?: string; services: string[] };

/** What to look for, by business type. Each entry: the words on the page -> how we say it in an email. */
const VOCAB: { when: RegExp; items: [RegExp, string][] }[] = [
  { when: /dent|orthodon/i, items: [[/implant/i, 'dental implants'], [/invisalign|clear aligner/i, 'Invisalign'], [/whiten/i, 'teeth whitening'], [/veneer/i, 'veneers'], [/braces|orthodon/i, 'braces'], [/emergency/i, 'emergency dental care'], [/root canal/i, 'root canals'], [/denture/i, 'dentures'], [/children|kids|child\b|paediatric|pediatric/i, "children's dentistry"], [/cosmetic/i, 'cosmetic dentistry'], [/wisdom/i, 'wisdom teeth']] },
  { when: /physio|chiro|osteo|massage|podiat/i, items: [[/sports/i, 'sports injuries'], [/dry needling/i, 'dry needling'], [/back pain|neck pain/i, 'back and neck pain'], [/pregnan|prenatal|pelvic/i, 'pregnancy care'], [/workcover|workers comp/i, 'workers compensation'], [/remedial|deep tissue/i, 'remedial massage']] },
  { when: /\bvet|veterin/i, items: [[/desex|spay|neuter/i, 'desexing'], [/vaccin/i, 'vaccinations'], [/emergency/i, 'emergency care'], [/dental/i, 'pet dental care'], [/puppy|kitten/i, 'puppy and kitten care']] },
  { when: /salon|hair|barber|beauty|nail|spa\b|makeup|lash|brow|esthetic|aesthetic|tattoo/i, items: [[/balayage|colour|color/i, 'hair colour'], [/bridal|wedding/i, 'bridal bookings'], [/lash/i, 'lash extensions'], [/brow/i, 'brows'], [/facial/i, 'facials'], [/wax/i, 'waxing'], [/nail|manicure/i, 'nails'], [/microblad/i, 'microblading'], [/makeup lesson|makeup/i, 'makeup']] },
  { when: /hvac|air.?con|heating|cooling|refrigerat/i, items: [[/ducted/i, 'ducted air conditioning'], [/split system/i, 'split systems'], [/hydronic/i, 'hydronic heating'], [/commercial/i, 'commercial work'], [/emergency|24.?7|24.?hour/i, 'emergency call-outs']] },
  { when: /plumb|drain|gas fit/i, items: [[/blocked drain|drain/i, 'blocked drains'], [/hot water/i, 'hot water'], [/gas/i, 'gas fitting'], [/emergency|24.?7|24.?hour/i, 'emergency call-outs'], [/bathroom/i, 'bathroom renovations']] },
  { when: /mov(er|ing)|removal|relocat|storage/i, items: [[/interstate/i, 'interstate moves'], [/packing/i, 'packing'], [/storage/i, 'storage'], [/piano/i, 'piano moving'], [/office|commercial/i, 'office relocations']] },
  { when: /build|renovat|carpent|construct|roof|paint/i, items: [[/extension/i, 'home extensions'], [/kitchen/i, 'kitchens'], [/bathroom/i, 'bathrooms'], [/renovat/i, 'renovations'], [/new home|custom home/i, 'new homes'], [/roof/i, 'roofing']] },
  { when: /real estate|realtor|property/i, items: [[/property management/i, 'property management'], [/sales|selling/i, 'property sales'], [/rental|lease/i, 'rentals'], [/appraisal|valuation/i, 'appraisals']] },
  { when: /gym|fitness|yoga|pilates|crossfit/i, items: [[/personal train/i, 'personal training'], [/yoga/i, 'yoga'], [/pilates/i, 'pilates']] },
  { when: /rental|charter|yacht|vacation|holiday|airbnb|boat/i, items: [[/pet.?friendly/i, 'pet-friendly stays'], [/pool/i, 'pool stays'], [/long.?term|monthly/i, 'longer stays']] },
];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const placeName = (s: unknown): string | undefined => { const t = typeof s === 'string' ? clean(s) : ''; return /^[\p{L}][\p{L}\s'’.-]{1,29}$/u.test(t) ? t : undefined; };

function walk(o: unknown, found: string[]): void {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(x => walk(x, found)); return; }
  const r = o as Record<string, unknown>;
  const loc = placeName(r.addressLocality);
  if (loc) found.push(loc);
  for (const v of Object.values(r)) walk(v, found);
}

export function extractSiteFacts(html: string, allHtml: string, type = ''): SiteFacts {
  const page = cheerio.load(`${html ?? ''}\n${allHtml ?? ''}`);
  // locality: structured address data the business published
  const places: string[] = [];
  page('script[type="application/ld+json"]').each((_, el) => { try { walk(JSON.parse(page(el).contents().text()), places); } catch { /* not valid JSON: ignore */ } });
  page('[itemprop="addressLocality"]').each((_, el) => { const p = placeName(page(el).attr('content') ?? page(el).text()); if (p) places.push(p); });
  const counts = new Map<string, number>();
  for (const p of places) counts.set(p, (counts.get(p) ?? 0) + 1);
  const locality = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  // services: only what the menus, headings and titles say (not footers or body text), so a mention means the business offers it
  const named = page('title, h1, h2, h3, nav a, header a, li a').map((_, el) => clean(page(el).text())).get().filter(t => t && t.length < 80).join(' | ');
  const vocab = VOCAB.find(v => v.when.test(type))?.items ?? [];
  const services = vocab.filter(([re]) => re.test(named)).map(([, label]) => label).slice(0, 2);
  return { ...(locality ? { locality } : {}), services };
}

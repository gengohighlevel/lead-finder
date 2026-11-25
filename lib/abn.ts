import { normName } from './research';

/**
 * Australian Business Register "ABN Lookup" (free web services, needs a free key: ABN_GUID in .env).
 * For a business in Australia it confirms the business exists and is still active, and for a SOLE TRADER it gives the
 * person's own name (the register holds a legal name for individuals only). Companies, trusts and partnerships get no
 * person: the register does not name owners or directors, and this never guesses one.
 * Optional source: with no key, or on any failure, it answers nothing rather than an error. Names only, never emails.
 * The register may withdraw an entry (e.g. for privacy); if it tells you to delete one, delete it.
 */
const BASE = 'https://abr.business.gov.au/json';
const GUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const TIMEOUT_MS = 10_000;

export type AbnInfo = {
  abn: string; status: string; entityName: string; entityType: string; entityTypeCode: string;
  state?: string; postcode?: string; gst: boolean; acn?: string; url: string;
  /** A sole trader's own name, as the register holds it. Never set for a company, trust or partnership. */
  person?: string;
};

export const abnEnabled = (): boolean => GUID_RE.test(process.env.ABN_GUID ?? '');
/** "51824753556" -> "51 824 753 556". */
export const formatAbn = (abn: string) => abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
export const abnViewUrl = (abn: string) => `https://abr.business.gov.au/ABN/View?abn=${abn.replace(/\D/g, '')}`;

/** The service always wraps its answer as callback({...}), even when no callback is asked for. */
export function parseJsonp(text: string): Record<string, unknown> | undefined {
  const t = text.trim().replace(/;$/, '');
  try {
    if (t.startsWith('{')) return JSON.parse(t);
    const m = t.match(/^[A-Za-z_$][\w$]*\(([\s\S]*)\)$/);
    return m ? JSON.parse(m[1]) : undefined;
  } catch { return undefined; }
}

const tc = (w: string) => (w === w.toUpperCase() && /\p{L}/u.test(w)
  ? w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase()).replace(/^Mc(\p{L})/u, (_, c) => `Mc${c.toUpperCase()}`)
  : w);

/** "DOE, Jane Mary" -> "Jane Mary Doe". A single word is not enough to be sure it is a person. */
export function personFromEntityName(raw: string): string | undefined {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return undefined;
  let full = s;
  if (s.includes(',')) {
    const [family, ...rest] = s.split(',');
    const given = rest.join(',').trim();
    if (!family.trim() || !given) return undefined;
    full = `${given} ${family.trim()}`;
  }
  const tokens = full.split(' ');
  return tokens.length >= 2 ? tokens.map(tc).join(' ') : undefined;
}

const STATES: Record<string, string> = {
  queensland: 'QLD', 'new south wales': 'NSW', victoria: 'VIC', 'south australia': 'SA', 'western australia': 'WA',
  tasmania: 'TAS', 'northern territory': 'NT', 'australian capital territory': 'ACT',
};
/** "Brisbane, Queensland, Australia" / "QLD" / "Queensland" -> "QLD". Whole parts only, so "Victoria Point" is not Victoria. */
export function auState(text?: string): string | undefined {
  if (!text) return undefined;
  const parts = text.split(',').map(p => p.trim().toLowerCase()).filter(Boolean).reverse();
  for (const p of parts) {
    if (STATES[p]) return STATES[p];
    if (/^(nsw|vic|qld|sa|wa|tas|nt|act)$/.test(p)) return p.toUpperCase();
  }
  return undefined;
}

type Names = { Abn?: string; IsCurrent?: boolean; Name?: string; Postcode?: string; State?: string };
const key = (s: string) => normName(s.replace(/\b(?:pty|ltd|limited|proprietary|t\/a|trading as)\b/gi, ''));
function sameName(a: string, b: string): boolean {
  const x = key(a), y = key(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short);
}

// The register publishes no rate limit, so be gentle: three requests at a time however many leads are being checked.
const MAX_AT_ONCE = 3;
let active = 0;
const waiting: (() => void)[] = [];
async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_AT_ONCE) await new Promise<void>(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

async function call(path: string, params: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  return gate(() => callNow(path, params));
}
async function callNow(path: string, params: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  const res = await fetch(`${BASE}/${path}?${new URLSearchParams({ ...params, guid: process.env.ABN_GUID ?? '' })}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return undefined;
  return parseJsonp(await res.text());
}

const cache = new Map<string, AbnInfo | undefined>();
export const clearAbnCache = () => cache.clear();

type Lead = { name: string; region?: string; postcode?: string };

/** The ABN record of an Australian business, found by its name, state and (when known) postcode. Never throws. */
export async function lookupAbn(lead: Lead): Promise<AbnInfo | undefined> {
  if (!abnEnabled() || !lead.name?.trim()) return undefined;
  const state = auState(lead.region);
  const ck = `${key(lead.name)}|${state ?? ''}|${lead.postcode ?? ''}`;
  if (cache.has(ck)) return cache.get(ck);
  try {
    const found = await call('MatchingNames.aspx', { name: lead.name.trim(), maxResults: '10' });
    if (!found || (found.Message && !(Array.isArray(found.Names) && found.Names.length))) return undefined; // refused key or service trouble: not remembered
    let hits = ((found.Names as Names[] | undefined) ?? []).filter(n =>
      n.IsCurrent !== false && n.Abn && /^\d{11}$/.test(n.Abn) && n.Name && sameName(n.Name, lead.name) && (!state || n.State === state));
    const exact = hits.filter(n => key(n.Name!) === key(lead.name));
    if (exact.length) hits = exact;
    const inPostcode = lead.postcode ? hits.filter(n => n.Postcode === lead.postcode) : [];
    if (inPostcode.length) hits = inPostcode;
    const abns = [...new Set(hits.map(h => h.Abn!))];
    if (abns.length !== 1) { cache.set(ck, undefined); return undefined; } // nothing found, or two businesses: no guessing

    const d = await call('AbnDetails.aspx', { abn: abns[0] });
    if (!d || d.Message || !d.Abn) return undefined;
    const status = String(d.AbnStatus ?? ''), code = String(d.EntityTypeCode ?? '');
    const info: AbnInfo = {
      abn: String(d.Abn), status, entityName: String(d.EntityName ?? ''), entityType: String(d.EntityTypeName ?? ''), entityTypeCode: code,
      state: d.AddressState ? String(d.AddressState) : undefined, postcode: d.AddressPostcode ? String(d.AddressPostcode) : undefined,
      gst: !!d.Gst, ...(d.Acn ? { acn: String(d.Acn) } : {}), url: abnViewUrl(String(d.Abn)),
      ...(status === 'Active' && code === 'IND' ? { person: personFromEntityName(String(d.EntityName ?? '')) } : {}),
    };
    if (!info.person) delete info.person;
    cache.set(ck, info);
    return info;
  } catch { return undefined; }
}

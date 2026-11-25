import type { StoredLead } from './db';
import type { GhlStatus } from './ghlDetect';
import { GAP_LABEL } from './research';

export type SearchSummary = { key: string; type: string; place: string; count: number; qualified: number; pushed: number; lastChecked?: string };
export type Stats = {
  total: number; withPerson: number; contactable: number; withEmail: number; withAngle: number; qualified: number; pushed: number; avgScore: number;
  priority: Record<'A' | 'B' | 'C' | 'D', number>;
  ghl: Record<GhlStatus, number>;
  services: { name: string; count: number }[];
  gaps: { key: string; label: string; count: number }[];
  searches: SearchSummary[];
};

const tally = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** Dashboard numbers. Pure: takes every saved lead, returns counts. "Qualified" = priority A or B. */
export function computeStats(leads: StoredLead[]): Stats {
  const s: Stats = {
    total: leads.length, withPerson: 0, contactable: 0, withEmail: 0, withAngle: 0, qualified: 0, pushed: 0, avgScore: 0,
    priority: { A: 0, B: 0, C: 0, D: 0 }, ghl: { likely: 0, potential: 0, insufficient: 0 }, services: [], gaps: [], searches: [],
  };
  const services = new Map<string, number>(), gaps = new Map<string, number>(), searches = new Map<string, SearchSummary>();
  let scoreSum = 0, scored = 0;
  for (const l of leads) {
    const r = l.research;
    const qualified = r?.score.priority === 'A' || r?.score.priority === 'B';
    if (l.email || l.phone) s.contactable++;
    if (l.email) s.withEmail++;
    if (r?.people?.length) s.withPerson++;
    if (r?.outreach) { s.withAngle++; tally(services, r.outreach.service); }
    if (qualified) s.qualified++;
    if (l.pushedAt) s.pushed++;
    if (r) { s.priority[r.score.priority]++; s.ghl[r.ghlStatus]++; scoreSum += r.score.total; scored++; }
    for (const g of l.signals) tally(gaps, g);

    let g = searches.get(l.searchKey);
    if (!g) {
      g = { key: l.searchKey, type: l.searchKey.split('|')[0], place: '', count: 0, qualified: 0, pushed: 0 };
      searches.set(l.searchKey, g);
    }
    g.count++;
    if (qualified) g.qualified++;
    if (l.pushedAt) g.pushed++;
    if (!g.place && r?.city) g.place = [r.city, r.region].filter(Boolean).join(', ');
    if (r?.verifiedAt && (!g.lastChecked || r.verifiedAt > g.lastChecked)) g.lastChecked = r.verifiedAt;
  }
  s.avgScore = scored ? Math.round(scoreSum / scored) : 0;
  s.services = sorted(services).map(([name, count]) => ({ name, count }));
  s.gaps = sorted(gaps).map(([key, count]) => ({ key, label: GAP_LABEL[key] ?? key, count }));
  s.searches = [...searches.values()].sort((a, b) => (b.lastChecked ?? '').localeCompare(a.lastChecked ?? ''));
  return s;
}

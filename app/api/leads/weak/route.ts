import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { getAllLeads } from '@/lib/db';
import { selectWeak, WEAK_CRITERIA, type WeakCriterion } from '@/lib/weak';

export const parseCriteria = (v: unknown): WeakCriterion[] | undefined =>
  Array.isArray(v) && v.every(c => typeof c === 'string' && c in WEAK_CRITERIA) ? (v as WeakCriterion[]) : undefined;

/** Preview only: which leads in the whole library are weak by these criteria. Deletes nothing. */
export const POST = safeRoute(async (req: Request) => {
  const criteria = parseCriteria((await req.json().catch(() => ({}))).criteria);
  if (!criteria) return NextResponse.json({ error: 'criteria must be a list of known criteria' }, { status: 400 });
  const all = getAllLeads();
  const r = selectWeak(all, criteria);
  const byId = new Map(all.map(l => [l.id, l]));
  return NextResponse.json({ count: r.ids.length, protectedPushed: r.protectedPushed, byCriterion: r.byCriterion, sample: r.ids.slice(0, 8).map(id => byId.get(id)!.name) });
});

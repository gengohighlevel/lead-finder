import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { deleteLeads, getAllLeads, getLeadsByIds } from '@/lib/db';
import { selectWeak, WEAK_CRITERIA, type WeakCriterion } from '@/lib/weak';
import { backupNow } from '@/lib/backup';

/**
 * Delete leads. Either { ids } (the ones you selected) or { criteria, expected } (weak leads, where `expected` must equal the
 * count you were shown, so a changed list is never deleted by surprise). The library is backed up first: if that fails,
 * nothing is deleted. A lead already pushed to GHL is never deleted here.
 */
export const POST = safeRoute(async (req: Request) => {
  const { ids, criteria, expected } = await req.json().catch(() => ({})) as { ids?: unknown; criteria?: unknown; expected?: unknown };
  let targets: number[]; let skippedPushed = 0;
  if (ids !== undefined) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || !ids.every(Number.isInteger)) return NextResponse.json({ error: 'ids must be a list of lead ids' }, { status: 400 });
    const found = getLeadsByIds(ids as number[]);
    targets = found.filter(l => !l.pushedAt).map(l => l.id);
    skippedPushed = found.length - targets.length;
  } else {
    if (!Array.isArray(criteria) || !criteria.length || !criteria.every(c => typeof c === 'string' && c in WEAK_CRITERIA) || !Number.isInteger(expected)) {
      return NextResponse.json({ error: 'criteria and the expected count are required' }, { status: 400 });
    }
    const r = selectWeak(getAllLeads(), criteria as WeakCriterion[]);
    if (r.ids.length !== expected) return NextResponse.json({ error: `The list changed: it now has ${r.ids.length} leads, not ${expected}. Preview it again.` }, { status: 409 });
    targets = r.ids; skippedPushed = r.protectedPushed;
  }
  if (!targets.length) return NextResponse.json({ deleted: 0, skippedPushed, ids: [] });
  const backup = await backupNow('before-delete');          // throws if it cannot be made and verified: then nothing is deleted
  const deleted = deleteLeads(targets);
  return NextResponse.json({ deleted, skippedPushed, ids: targets, backup: backup.file });
});

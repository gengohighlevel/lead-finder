import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { getLeadsByIds, updateOpener, updateResearch } from '@/lib/db';
import { senderFromEnv } from '@/lib/emailDraft';
import { cleanEdits, runCounterPitch } from '@/lib/counterPitchRun';

/**
 * Rebuild one lead's first-touch email from its saved research, without any AI call and without sending anything.
 *   { id, type?, edits? }  edits = reworded subject / observation / impact / question; the evidence, source and confidence are kept.
 *                          Without edits the email is generated again from the research (use after a re-check).
 */
export const POST = safeRoute(async (req: Request) => {
  const { id, type, edits } = (await req.json().catch(() => ({}))) as { id?: unknown; type?: unknown; edits?: unknown };
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const l = getLeadsByIds([id as number])[0];
  if (!l) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  if (!l.research) return NextResponse.json({ error: 'This lead has not been researched yet.' }, { status: 400 });
  const prior = l.research.counterPitch;
  const e = edits === undefined ? undefined : cleanEdits(edits);
  if (e && prior?.status === 'needs_research') return NextResponse.json({ error: 'There is not enough research to write an email. Add the missing research first.' }, { status: 400 });
  const kind = typeof type === 'string' && type.trim() ? type.trim().slice(0, 80) : prior?.research.industry ?? 'local business';
  const cp = runCounterPitch(l, kind, { sender: senderFromEnv() }, e && Object.keys(e).length ? e : undefined, prior);
  updateResearch(l.id, { ...l.research, counterPitch: cp.record });
  if (cp.text) updateOpener(l.id, cp.text);
  return NextResponse.json({ lead: getLeadsByIds([l.id])[0] });
});

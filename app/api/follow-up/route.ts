import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { addSuppressions, getLeadsByIds, listSuppressions } from '@/lib/db';
import { leadEntries } from '@/lib/dnc';
import { followUpFor, noResponseFollowUp } from '@/lib/followUp';
import { leaderFirstName, senderFromEnv } from '@/lib/emailDraft';

/**
 * What to do with a reply (or with silence). Nothing is sent from here.
 *   { id, reply }        a reply you pasted: it is classified and a draft answer is suggested.
 *                        An opt-out ("No", "stop", "remove me") or a plain no puts the lead on the do-not-contact list at once.
 *   { id, noResponse }   a low-pressure follow-up for a lead that has not replied.
 */
export const POST = safeRoute(async (req: Request) => {
  const { id, reply, noResponse } = (await req.json().catch(() => ({}))) as { id?: unknown; reply?: unknown; noResponse?: unknown };
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const l = getLeadsByIds([id as number])[0];
  const cp = l?.research?.counterPitch;
  if (!l) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  if (!cp || cp.status === 'needs_research') return NextResponse.json({ error: 'No email research is saved for this lead, so there is nothing to follow up on.' }, { status: 400 });
  const ctx = { research: cp.research, firstName: leaderFirstName(l.research?.people) };
  const sender = senderFromEnv().name?.trim() || 'Your name';
  if (noResponse) return NextResponse.json({ result: noResponseFollowUp(ctx, sender) });
  if (typeof reply !== 'string' || !reply.trim() || reply.length > 5000) return NextResponse.json({ error: 'paste the reply (up to 5000 characters)' }, { status: 400 });
  const result = followUpFor(reply, ctx, sender);
  let suppressed = false;
  if (result.suppress) {
    const entries = leadEntries(l);
    if (entries.length) { addSuppressions(entries, `replied: ${result.kind === 'opt_out' ? 'opt-out' : 'not interested'}`); suppressed = true; }
  }
  return NextResponse.json({ result, suppressed, ...(suppressed ? { suppressions: listSuppressions() } : {}) });
});

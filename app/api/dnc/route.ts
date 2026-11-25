import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { addSuppressions, getLeadsByIds, listSuppressions, removeSuppression } from '@/lib/db';
import { leadEntries, parseEntries } from '@/lib/dnc';

/**
 * The do-not-contact list. One of:
 *   { text, reason? }      paste emails, domains or phone numbers (one per line, or comma separated)
 *   { fromLead, reason? }  add a lead: its email, its website's domain and its phone
 *   { remove }             take an entry off by id
 */
export const POST = safeRoute(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const { text, fromLead, remove, reason } = body as { text?: unknown; fromLead?: unknown; remove?: unknown; reason?: unknown };
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 200)) return NextResponse.json({ error: 'reason must be text of at most 200 characters' }, { status: 400 });

  if (remove !== undefined) {
    if (!Number.isInteger(remove)) return NextResponse.json({ error: 'remove must be an id' }, { status: 400 });
    removeSuppression(remove as number);
    return NextResponse.json({ suppressions: listSuppressions() });
  }
  if (fromLead !== undefined) {
    if (!Number.isInteger(fromLead)) return NextResponse.json({ error: 'fromLead must be a lead id' }, { status: 400 });
    const l = getLeadsByIds([fromLead as number])[0];
    if (!l) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
    const entries = leadEntries(l);
    if (!entries.length) return NextResponse.json({ error: 'this lead has no email, website or phone to add' }, { status: 400 });
    const r = addSuppressions(entries, (reason as string | undefined) || 'added from a lead');
    return NextResponse.json({ ...r, suppressions: listSuppressions() });
  }
  if (typeof text !== 'string' || text.length > 200_000) return NextResponse.json({ error: 'text, fromLead or remove required' }, { status: 400 });
  const { entries, unreadable } = parseEntries(text);
  const r = addSuppressions(entries, reason as string | undefined);
  return NextResponse.json({ ...r, unreadable, suppressions: listSuppressions() });
});

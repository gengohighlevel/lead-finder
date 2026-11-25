import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { addSuppressions, deleteLeads, getAllLeads, getLeadsByIds } from '@/lib/db';
import { matchSuppression, parseEntry, type Entry, type Suppression } from '@/lib/dnc';
import { backupNow } from '@/lib/backup';

/**
 * Forget a business (a removal request): put its email, website domain and phone on the do-not-contact list, then delete it
 * everywhere in the library (every search that found it, pushed or not). The list entries stay, so it is flagged if found again.
 */
export const POST = safeRoute(async (req: Request) => {
  const { id, reason } = await req.json().catch(() => ({})) as { id?: unknown; reason?: unknown };
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 200)) return NextResponse.json({ error: 'reason must be text of at most 200 characters' }, { status: 400 });
  const lead = getLeadsByIds([id as number])[0];
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  const entries = [lead.email, lead.website, lead.phone].map(v => (v ? parseEntry(v) : undefined)).filter((e): e is Entry => !!e);
  if (!entries.length) return NextResponse.json({ error: 'this lead has no email, website or phone to remember, so it cannot be forgotten safely: use Delete instead' }, { status: 400 });
  const backup = await backupNow('before-forget');
  addSuppressions(entries, (reason as string | undefined)?.trim() || 'asked to be removed');
  const asList: Suppression[] = entries.map((e, i) => ({ ...e, id: -(i + 1), createdAt: '' }));
  const ids = getAllLeads().filter(l => matchSuppression(l, asList)).map(l => l.id);
  const deleted = deleteLeads(ids);
  return NextResponse.json({ deleted, ids, backup: backup.file, note: 'It is removed from this app and on your do-not-contact list. If it was pushed to GoHighLevel, delete or unsubscribe the contact there (GHL) too.' });
});

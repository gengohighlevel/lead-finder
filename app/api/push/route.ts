import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { getLeadsByIds, markPushed, updateOpener } from '@/lib/db';
import { pushToGhl } from '@/lib/ghl';
import { checkLeadEmails } from '@/lib/emailCheckLeads';
import { loadGateState } from '@/lib/gateState';

export const POST = safeRoute(async (req: Request) => {
  const { ids, tags, openers } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'select at least one lead' }, { status: 400 });
  if (!ids.every(Number.isInteger)) return NextResponse.json({ error: 'ids must be whole numbers' }, { status: 400 });
  try {
    // only edits for the leads being pushed, as text, kept to a sane length
    for (const [id, text] of Object.entries((openers && typeof openers === 'object' ? openers : {}) as Record<string, unknown>)) {
      if (/^\d+$/.test(id) && ids.includes(Number(id)) && typeof text === 'string') updateOpener(Number(id), text.slice(0, 2000));
    }
    const cleanTags = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string' && !!t.trim() && t.length <= 60).slice(0, 20) : [];
    // every email is checked under the current rules right before the push; only a verified one is handed to GHL
    await checkLeadEmails(getLeadsByIds(ids));
    const { state, problem } = loadGateState();   // your country rules and do-not-contact list
    const results = await pushToGhl(getLeadsByIds(ids), cleanTags, state);
    for (const r of results) if (r.ok) markPushed(r.id);
    return NextResponse.json({ results, ...(problem ? { warning: problem } : {}) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'push failed' }, { status: 400 });
  }
});

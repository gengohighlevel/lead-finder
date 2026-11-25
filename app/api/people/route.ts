import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { crawlPeoplePages } from '@/lib/crawl';
import { extractFromPages, mergePeople } from '@/lib/people';
import { getLeadsByIds, updatePeople } from '@/lib/db';
import { mapLimit } from '@/lib/pipeline';

/**
 * People finder: reads each business's own team and about pages for the names and titles they publish.
 * Leads with no website are skipped. Names only, never emails.
 */
export const POST = safeRoute(async (req: Request) => {
  const { ids, force } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) return NextResponse.json({ error: 'ids required' }, { status: 400 });

  const todo = getLeadsByIds(ids).filter(l => l.website && l.research && (force || l.research.peopleCheckedAt === undefined));
  await mapLimit(todo, 8, async l => {
    // one site that cannot be read leaves that lead unchecked; it never fails the other leads in the batch
    try {
      const pages = await crawlPeoplePages(l.website!);
      // people already on record (the registry's authorized official) stay, merged with what the website names
      const people = mergePeople([...(l.research?.people ?? []), ...extractFromPages(pages, l.name)], l.name);
      updatePeople(l.id, people, new Date().toISOString());
    } catch (e) { console.error(`[api /api/people] lead ${l.id} (${l.website})`, e); }
  });
  return NextResponse.json({ leads: getLeadsByIds(ids) });
});

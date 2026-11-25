/**
 * Reads each researched lead's website again and saves only the specifics for the personalised email (suburb, services named in its
 * menus: lib/siteFacts.ts). Nothing else about the lead changes, nothing is sent. Back up the library and stop the app first.
 * Usage: LEADS_DB=path npx tsx scripts/collect-site-facts.ts [--dry] [--all]   (--all re-reads leads that already have facts)
 */
import { getAllLeads, updateResearch } from '../lib/db';
import { crawlSite } from '../lib/crawl';
import { extractSiteFacts } from '../lib/siteFacts';
import { mapLimit } from '../lib/pipeline';

async function main() {
const dry = process.argv.includes('--dry'), all = process.argv.includes('--all');
const targets = getAllLeads().filter(l => l.website && l.research && (all || !l.research.siteFacts));
console.log(`${targets.length} websites to read`);
let done = 0, withPlace = 0, withServices = 0, failed = 0;
await mapLimit(targets, 16, async l => {
  try {
    const crawl = await crawlSite(l.website!);
    if (!crawl?.html) { failed++; return; }
    const facts = extractSiteFacts(crawl.html, crawl.allHtml ?? '', l.searchKey.split('|')[0]);
    if (facts.locality) withPlace++;
    if (facts.services.length) withServices++;
    if (!dry) updateResearch(l.id, { ...l.research!, siteFacts: facts });
  } catch { failed++; }
  if (++done % 50 === 0) console.log(`  ${done}/${targets.length}`);
});
console.log(`${dry ? '[dry run] ' : ''}read ${done}; suburb found ${withPlace}; services found ${withServices}; unreadable ${failed}`);
}
main();

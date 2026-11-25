/**
 * Gives every saved lead an outreach angle, with no AI call and nothing sent:
 *  1. leads never researched: read their website (same step as "Re-check websites"), country taken from the other leads of the same search
 *  2. leads researched but never scored: playbook angle + Counter Pitch email (or "needs further research")
 * Back up the library first and stop the app so two programs do not write at once.
 * Usage: npx tsx --env-file=.env.server scripts/backfill-angles.ts [--dry]
 */
import { getAllLeads, getLeadsByIds, updateOpener, updateResearch } from '../lib/db';
import { POST as enrich } from '../app/api/enrich/route';
import { templateOutreach } from '../lib/opener';
import { runCounterPitch } from '../lib/counterPitchRun';
import { senderFromEnv } from '../lib/emailDraft';
import { socialLabel } from '../lib/channel';

const dry = process.argv.includes('--dry');
const typeOf = (k: string) => k.split('|')[0];
const COUNTRY_BY_KEY: Record<string, string> = { 'dentist|austin, tx': 'us', 'dentist|texas': 'us', 'dentist|sydney australia': 'au', 'moving company|relation14027280': 'au' };

const all = getAllLeads();
const countryOfKey = (k: string): string | undefined => {
  const seen: Record<string, number> = {};
  for (const l of all) if (l.searchKey === k && l.research?.country) seen[l.research.country.toLowerCase()] = (seen[l.research.country.toLowerCase()] ?? 0) + 1;
  return Object.entries(seen).sort((a, b) => b[1] - a[1])[0]?.[0] ?? COUNTRY_BY_KEY[k];
};

async function main() {
  // 1. research the never-researched
  const groups = new Map<string, number[]>();
  for (const l of all) if (!l.research) groups.set(l.searchKey, [...(groups.get(l.searchKey) ?? []), l.id]);
  for (const [key, ids] of groups) {
    const countryCode = countryOfKey(key);
    console.log(`research ${ids.length} x ${key} (country ${countryCode ?? 'unknown'})`);
    if (dry) continue;
    for (let i = 0; i < ids.length; i += 24) {
      const res = await enrich(new Request('http://x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids.slice(i, i + 24), type: typeOf(key), place: { countryCode, label: key.split('|')[1] } }) }));
      if (!res.ok) throw new Error(`enrich failed: ${await res.text()}`);
      console.log(`  ${Math.min(i + 24, ids.length)}/${ids.length}`);
    }
  }
  // 2. angle + Counter Pitch email for every researched lead that has none
  const sender = senderFromEnv();
  const keyOf = new Map(all.map(l => [l.id, l.searchKey]));
  let written = 0, needs = 0, review = 0, kept = 0;
  for (const l of getLeadsByIds(all.map(x => x.id))) {
    const r = l.research;
    if (!r || r.counterPitch) continue;
    const type = typeOf(keyOf.get(l.id) ?? '');
    const outreach = r.outreach ?? templateOutreach(l.name, l.signals, r.ghlStatus, type, socialLabel(l, r));
    const cp = runCounterPitch({ ...l, research: { ...r, outreach } }, type, { sender });
    if (cp.record.status === 'needs_research') needs++; else if (cp.record.status === 'review') review++; else written++;
    if (dry) continue;
    updateResearch(l.id, { ...r, outreach, counterPitch: cp.record });
    updateOpener(l.id, cp.text ?? `${outreach.observation} ${outreach.openingQuestion}`);
  }
  console.log(`${dry ? '[dry run] ' : ''}email written ${written}; needs further research (short angle, no email) ${needs}; flagged for review ${review}; kept ${kept}`);
}
main();

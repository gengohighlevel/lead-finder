/**
 * Rewrites saved leads' outreach angle as the current Counter Pitch email, from the research already stored on each lead (no AI call, nothing sent).
 * A lead without enough checked research gets no email: it is flagged "needs further research" and keeps its short angle.
 * Only touches an angle that is still the app's own text (the old "fact + question" line, or an earlier email draft); an angle you
 * edited by hand is left alone. Usage: LEADS_DB=path npx tsx scripts/redraft-openers.ts [--dry]
 */
import { getAllLeads, updateOpener, updateResearch } from '../lib/db';
import { senderFromEnv } from '../lib/emailDraft';
import { runCounterPitch } from '../lib/counterPitchRun';

const dry = process.argv.includes('--dry');
const sender = senderFromEnv();
let changed = 0, edited = 0, none = 0, same = 0, needs = 0, review = 0;
for (const l of getAllLeads()) {
  const r = l.research, o = r?.outreach;
  if (!r || !o) { none++; continue; }
  const old = (l.opener ?? '').trim();
  const auto = old === '' || old === `${o.observation} ${o.openingQuestion}`.trim() || old.startsWith('Subject:');
  if (!auto) { edited++; continue; }
  const cp = runCounterPitch(l, r.counterPitch?.research.industry ?? 'local business', { sender });
  const text = cp.text ?? `${o.observation} ${o.openingQuestion}`;
  if (cp.record.status === 'needs_research') needs++;
  if (cp.record.status === 'review') review++;
  if (!dry) updateResearch(l.id, { ...r, counterPitch: cp.record });
  if (text === old) { same++; continue; }
  if (!dry) updateOpener(l.id, text);
  changed++;
}
console.log(`${dry ? '[dry run] would update' : 'updated'} ${changed}; already current ${same}; kept your own edits ${edited}; no outreach yet ${none}; needs further research (no email) ${needs}; written but flagged for review ${review}`);

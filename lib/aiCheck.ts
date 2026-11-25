import { hasTechWords } from './playbook';

/**
 * Quality gate for what the local model writes. A small model drifts: it repeats the fact instead of asking, asks about
 * something else, flatters, or pushes. Only a question that is relevant and helpful goes into an email; anything else is replaced
 * by the playbook's own question (checked by hand), so the owner never sees a drifted line.
 */

/** Words a question about each service is expected to touch. A question about something else (e.g. "looking for a new dentist?") fails. */
const TOPIC: Record<string, RegExp> = {
  'Lead Management System': /inquir|enquir|messag|lead|call|email|contact|repl|respon|track|reach|dm\b|comes? in/i,
  'Web development + Lead Management System': /website|site\b|online|found|search|inquir|enquir|messag|call|customer|google/i,
  'Appointment Booking System': /book|call|phone|voicemail|answer|miss|appointment|schedul|calendar|reserv|slot|after.hours|remind|no.show|show up|reschedul/i,
  'Sales Pipeline System': /track|source|lead|quote|proposal|estimate|follow|deal|pending|waiting|answer|decid|next/i,
  'Automated Follow-Up System': /follow|price|quote|hear|repl|think about|chase|back to|touch|reach/i,
  'Client Onboarding System': /\byes\b|start|welcome|form|onboard|first|sign|paperwork|begin|new client|get going/i,
  'Customer Reactivation System': /past|previous|returning|come back|bring back|lapsed|haven.t|again|repeat|before|former/i,
  'Review & Reputation System': /review|rating|feedback|google|testimonial|star/i,
  'Payment Follow-Up System': /invoice|payment|paid|overdue|past due|chase|unpaid|bill|owe/i,
  'Customer Retention System': /again|after|stay in touch|check.in|hear from|return|repeat|rebook|next visit|between/i,
  'AI-Assisted Lead Qualification System': /inquir|enquir|lead|call back|repl|respon|priorit|serious|fit|first|qualif|sort/i,
  'Web development': /website|site\b|phone|mobile|online|visitor|secure|redesign|update|look/i,
  'GHL optimisation + AI agents': /follow|set.?up|manual|tool|system|lead|customer|inquir|repl|using|work|hoped/i,
};

/** Flattery, hype and pressure: the playbook says no hype and no pressure. */
const BAD_TONE = /\b(amazing|incredible|revolutionary|game.?chang\w*|best|love|great|awesome|fantastic|guarantee\w*|limited|hurry|act now|today only|don.t miss)\b|\b(book|schedule|jump on|hop on)\s+(a\s+)?(quick\s+)?(call|demo|meeting|chat)\b|\b(can|could|may) i (send|book|call|show)\b|\bwould you like (me )?to\b/i;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'on', 'in', 'to', 'for', 'is', 'are', 'it', 'you', 'your', 'do', 'does', 'how', 'what', 'when', 'who', 'that', 'this', 'with', 'there', 'any']);
const words = (s: string): string[] => (s.toLowerCase().match(/[a-z']+/g) ?? []).filter(w => !STOP.has(w));

export type CheckContext = { service: string; /** the checked fact the message already opens with */ observation: string };

export function usableQuestion(q: string, ctx: CheckContext): boolean {
  const t = q.trim();
  if (!t.endsWith('?') || (t.match(/\?/g) ?? []).length !== 1 || /[.!]\s+\S/.test(t)) return false;   // exactly one question, one sentence
  const n = t.split(/\s+/).length;
  if (n < 4 || n > 30) return false;
  if (/^(i|we)\s+(couldn.t|could not|found|noticed|saw|came across|can|help)\b/i.test(t)) return false;   // a statement dressed up
  if (hasTechWords(t) || BAD_TONE.test(t)) return false;
  const topic = TOPIC[ctx.service];
  if (topic && !topic.test(t)) return false;                                                        // about something else
  const have = new Set(words(ctx.observation));
  const mine = words(t);
  if (mine.length && mine.filter(w => have.has(w)).length / mine.length >= 0.6) return false;       // just the fact again
  return true;
}

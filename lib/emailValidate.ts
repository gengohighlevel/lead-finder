import { hasTechWords } from './playbook';
import type { Confidence } from './counterPitch';

/**
 * Quality gate for a first-touch Counter Pitch email. Reads the email as plain text (so it also checks edits made by hand) and
 * runs the ten checks. Rule-based on purpose: a failing email is regenerated or flagged for review, never sent as is.
 * Pure and client-safe.
 */
export const COPY_MAX_WORDS = 50;
export const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export type Check = { id: string; label: string; ok: boolean; detail?: string };
export type Validation = { ok: boolean; checks: Check[]; words: number };
export type ParsedEmail = { subject: string; greeting: string; copy: string; text: string };

/** Split "Subject: …" + body into the parts the checks need. `copy` = the paragraphs between the greeting and the sign-off (word count and tone are judged on it). */
export function parseEmail(text: string): ParsedEmail {
  const m = text.match(/^Subject:\s*(.*)\n+/);
  const subject = m?.[1]?.trim() ?? '';
  const body = m ? text.slice(m[0].length) : text;
  const paras = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const greeting = paras.length && /^(hi|hello|hey|dear)\b/i.test(paras[0]) ? paras.shift()! : '';
  const copy: string[] = [];
  for (const p of paras) {
    if (/^P\.?S\.?\b/i.test(p)) break;                                         // the opt-out
    if (!/[?.!]$/.test(p) && wordCount(p) <= 3) break;                         // the sign-off ("Your name")
    copy.push(p);
  }
  return { subject, greeting, copy: copy.join('\n\n'), text };
}

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'but', 'with', 'that', 'this', 'from', 'have', 'what', 'when', 'who', 'how', 'can', 'its', 'not', 'any']);
const stems = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => !STOP.has(w)).map(w => w.slice(0, 5));

const SELLING = /\b(we|our|I)\s+(offer|provide|help|build|specialis\w*|specializ\w*|can (help|build|fix|set)|do|run|work with|create|design|develop)\b|\bmy (company|agency|business|services?|team)\b|\b(gohighlevel|ghl|leadconnector|crm|chatbot|ai agents?|ai assistant|web development|web design|automation)\b/i;
const FREE_OR_PROMO = /\b(free (offer|audit|consultation|trial|quote|build)|guaranteed results?|limited[- ]time|special offer|discount|act now|don'?t miss|exclusive|risk[- ]free|no obligation)\b/i;
const MEETING = String.raw`(?:a|an)\s+(?:quick\s+|short\s+|brief\s+|free\s+)?(?:\d+[- ]minute\s+)?(?:call|demo|meeting|chat|zoom)\b`;
// the SENDER asking for a call ("can we book a call", "book a call"), not a description of what their customers do ("for your clients to book a meeting")
const CALL_ASK = new RegExp(String.raw`(?:^|[.!?]\s+)(?:please\s+)?(?:book|schedule|grab)\s+${MEETING}|\b(?:can|could|shall|should|let'?s|would you like to|want to|how about|why don'?t we|i'?d like to|i can|i'?ll)\s+(?:we\s+|you\s+|us\s+)?(?:quickly\s+)?(?:book|schedule|set up|jump on|hop on|grab|have)\s+${MEETING}|\b\d+[- ]minute (?:call|chat|demo)\b|\bare you free (?:for|on)\b|\bwould you be open to (?:a|an)\b`, 'i');
// asking THEM to buy; a description of what their customers do ('sign up elsewhere') is fine
const BUY_ASK = /\b(?:would you|do you want to|want to|ready to|you (?:should|can|could|need to)|please|let me|we can|i can)\s+(?:\w+\s+)?(?:buy|purchase|sign up|subscribe|pay for|invest)\b|\b(?:buy|purchase|subscribe to) (?:our|my|this|now)\b/i;
const FABRICATED = /\b\d+(\.\d+)?\s?%|[$£€]\s?\d|\b\d+x\b|\b(guarantee\w*|proven|definitely|certainly|obviously|clearly)\b|\b(you(?:'re| are) (losing|missing out)|costing you|losing (you )?(customers|sales|money|revenue|leads))\b/i;
const JARGON = /\b(leverag\w*|synerg\w*|streamlin\w*|cutting[- ]edge|seamless\w*|robust|game[- ]chang\w*|best[- ]in[- ]class|solutions?|innovative|world[- ]class|scalab\w*|empower\w*|unlock|supercharge|reach(ing)? out|hope this (email )?finds you|touch base|circle back|i came across|my name is|i'?m (a|an|the)\b)/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const SUBJECT_BAD = /\b(free|guarantee\w*|urgent|act now|limited|offer|re:|fwd:|\$\d+|winner|congratulations)\b/i;
const HEDGE = /\b(may|might|could|appears?|seems?|couldn'?t find|can'?t find|couldn'?t see|not sure|looks like)\b/i;

/**
 * The ten checks:
 *  1 subject supported by the body   2 observation factual or qualified   3 about the prospect   4 no service pitch   5 one problem
 *  6 one operational question        7 50 words or fewer                  8 no fabricated claims or guarantees   9 opt-out   10 natural
 */
export function validateEmail(text: string, ctx: { confidence: Confidence; businessName?: string }): Validation {
  const e = parseEmail(text);
  const copy = e.copy;
  const words = wordCount(copy);
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail?: string) => checks.push({ id, label, ok, ...(!ok && detail ? { detail } : {}) });

  const sw = wordCount(e.subject);
  const subjStems = stems(e.subject), bodyStems = new Set(stems(copy));
  const overlap = subjStems.some(s => bodyStems.has(s));
  add('subject', 'Subject is supported by the research and the body', !!e.subject && sw >= 3 && sw <= 7 && overlap && !SUBJECT_BAD.test(e.subject) && !/!/.test(e.subject),
    !e.subject ? 'no subject line' : sw < 3 || sw > 7 ? `subject has ${sw} words (use 3 to 7)` : SUBJECT_BAD.test(e.subject) ? 'subject uses a promotional or misleading word' : !overlap ? 'the body never mentions what the subject is about' : 'subject uses "!"');

  const certain = FABRICATED.test(ctx.businessName ? copy.split(ctx.businessName).join(' ') : copy);
  add('observation', ctx.confidence === 'verified' ? 'Observation is factual' : 'Observation is qualified as a reading, not a fact',
    !!copy && !certain && (ctx.confidence === 'verified' || HEDGE.test(copy)), !copy ? 'no observation' : certain ? 'states something as certain that was not verified' : 'unverified problem is stated as fact; use "may" or "couldn\'t find"');

  const aboutThem = /\b(your|you|you're|you've)\b|'s\b/i.test(copy) || (ctx.businessName ? copy.toLowerCase().includes(ctx.businessName.toLowerCase()) : false);
  add('prospect', 'Focuses on the prospect, not the sender', aboutThem && !/^(we|our|i help|i offer|my)\b/i.test(copy.trim()), 'the email must be about their business');

  const pitched = SELLING.test(copy) || hasTechWords(copy) || FREE_OR_PROMO.test(copy) || CALL_ASK.test(copy) || BUY_ASK.test(copy);
  add('no-pitch', 'No services, call request or purchase ask', !pitched, 'remove the service, tech word, offer or call/buy request');

  const sentences = (copy.replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, 'DOMAIN').match(/[^.!?]+[.!?]+/g) ?? []).length;   // a web address is not a sentence end
  add('one-problem', 'One business problem only', sentences > 0 && sentences <= 4 && !/\b(also noticed|another (issue|problem)|in addition|additionally|on top of that|as well as)\b/i.test(copy), 'keep to one problem, in at most 4 sentences');

  const q = (copy.match(/\?/g) ?? []).length;
  add('one-question', 'Exactly one operational question', q === 1 && /\?\s*$/.test(copy.trim()), q === 0 ? 'no question' : 'ask only one question, at the end');

  add('length', `${COPY_MAX_WORDS} words or fewer (greeting, signature and opt-out excluded)`, words > 0 && words <= COPY_MAX_WORDS, `${words} words`);

  add('claims', 'No invented numbers, losses or guarantees', !FABRICATED.test(ctx.businessName ? copy.split(ctx.businessName).join(' ') : copy) && !FABRICATED.test(ctx.businessName ? e.subject.split(ctx.businessName).join(' ') : e.subject), 'remove the number, loss claim or guarantee');

  add('opt-out', 'Has the reply-"No" opt-out', /reply\s+["“'‘]?no["”'’]?/i.test(e.text) && /remove/i.test(e.text), 'add: If this isn\'t relevant, just reply "No" and I\'ll remove you from my list.');

  // the business's own name may be in capitals ("ACME Plumbing"): not shouting
  const strip = (s: string) => (ctx.businessName ? s.split(ctx.businessName).join(' ') : s);
  const all = strip(`${e.subject}\n${e.greeting}\n${copy}`);
  const noName = strip(e.text);
  const natural = !/[—–]/.test(noName) && !EMOJI.test(noName) && !/!/.test(all) && !JARGON.test(copy) && !FREE_OR_PROMO.test(all) && !/\b[A-Z]{4,}\b/.test(all.replace(/\b(GHL|HTTPS?|AU|NZ|UK|USA)\b/g, ''));
  add('natural', 'Natural and conversational (no dashes, emojis, jargon or hype)', natural,
    /[—–]/.test(noName) ? 'remove the dash' : EMOJI.test(noName) ? 'remove the emoji' : /!/.test(all) ? 'remove "!"' : 'remove jargon, hype or shouting');

  return { ok: checks.every(c => c.ok), checks, words };
}

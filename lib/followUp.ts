import { OPT_OUT, spellingFor, type CounterPitchResearch } from './counterPitch';

/**
 * Reply handling and follow-ups for the Counter Pitch loop. The goal is a conversation, not a closed sale, so a "no" is respected,
 * not argued with. Pure: it reads a reply the user pasted and suggests the next step and a draft. Nothing is sent from here.
 */
export type ReplyKind = 'opt_out' | 'negative' | 'existing_solution' | 'more_info' | 'positive' | 'unclear';

const norm = (t: string) => t.toLowerCase().replace(/[“”"'’`.!,;:()\-]+/g, ' ').replace(/\s+/g, ' ').trim();

// a short reply that is only "no" / "stop" is exactly what the P.S. asked for
const BARE_NO = /^(no|nope|stop|unsubscribe|remove|remove me|no thanks stop)$/;
const OPT_OUT_WORDS = /\b(unsubscribe|remove me|take me off|delete my (email|details|data)|stop (emailing|contacting|sending)|do not (contact|email)|don t (contact|email)|opt out|off (your|the) list|spam)\b/;
const NEGATIVE = /\b(not interested|no thanks|no thank you|not relevant|not for us|not for me|don t need|do not need|no need|leave us alone|not looking|not a priority|not now)\b/;
const EXISTING = /\b(already (have|use|using|got|handle|handled|do|doing|working|sorted|set up|in place)|we (have|use|handle|run) (a|an|the|our|one)|(sorted|handled|covered|in place|taken care of)|our (team|staff|receptionist|office|agency|developer|provider) (handles?|does|manages?|is)|have a (system|process|tool|team|person))\b/;
const LACKS = /\b(no we (don t|do not|haven t|have not)|we (don t|do not|haven t|have not)( really)?( have| got)?|not yet|nothing in place|no process|no system|good question|that s a (good|fair) (question|point)|you re right|you are right|fair point|we should|been meaning|need to look)\b/;
const MORE_INFO = /\b(tell me more|tell us more|more (info|information|details)|what do you mean|what did you (see|find|notice)|can you explain|could you explain|how (do|does|did) you|elaborate|what is this|who are you|what s this about|what exactly|which (page|form))\b|\?\s*$/;
const POSITIVE = /\b(yes|yeah|yep|interested|sounds good|let s (talk|chat)|happy to|open to|keen|go ahead)\b/;

export function classifyReply(reply: string): ReplyKind {
  const t = norm(reply);
  if (!t) return 'unclear';
  if (BARE_NO.test(t) || OPT_OUT_WORDS.test(t)) return 'opt_out';
  if (EXISTING.test(t) && !LACKS.test(t)) return 'existing_solution';
  if (LACKS.test(t)) return 'positive';          // "no, we don't have a process" answers the question: they are talking
  if (NEGATIVE.test(t)) return 'negative';
  if (MORE_INFO.test(t)) return 'more_info';
  if (POSITIVE.test(t)) return 'positive';
  return 'unclear';
}

/** Opt-out and a plain no end outreach: the lead goes on the do-not-contact list at once. */
export const stopsOutreach = (k: ReplyKind): boolean => k === 'opt_out' || k === 'negative';

/** Per-gap angle for a no-response follow-up: a different way in, never a repeat of the first email and never a claim. */
const FRESH_ANGLE: Record<string, (w: ReturnType<typeof spellingFor>) => string> = {
  booking_by_form: w => `Picture someone sending an ${w.enquiry} on a Sunday evening. What happens to it?`,
  no_booking: () => 'Picture someone on your site at 9pm on a Sunday who wants a time. What would they do?',
  no_website: () => 'If someone searched for you right now, what would they find?',
  no_chat: () => 'If a visitor has one quick question and is not ready to call, what is their next step?',
  not_mobile: () => 'Have you opened your site on a phone lately? It is worth two minutes.',
  no_https: () => 'It is easy to check: open your site and look at the address bar for a padlock.',
};

export type FollowUpContext = { research: CounterPitchResearch; firstName?: string };
export type FollowUpDraft = { kind: ReplyKind | 'no_response'; /** the next step for you, in words */ action: string; /** true: add the lead to the do-not-contact list */ suppress: boolean; /** null: no message should be sent */ draft: string | null };

const hi = (c: FollowUpContext) => (c.firstName ?? c.research.prospectName ? `Hi ${c.firstName ?? c.research.prospectName},` : `Hi ${c.research.businessName} team,`);
const sign = (name = 'Your name') => name;

/** What to do with a reply, and a draft answer where one is right. */
export function followUpFor(reply: string, c: FollowUpContext, sender = 'Your name'): FollowUpDraft {
  const kind = classifyReply(reply);
  const r = c.research;
  switch (kind) {
    case 'opt_out':
      return { kind, suppress: true, draft: null, action: 'Opt-out. The lead is on your do-not-contact list now and will not be contacted again by any campaign. Do not reply.' };
    case 'negative':
      return { kind, suppress: true, draft: null, action: 'They are not interested. Respect it: outreach stops and the lead is on your do-not-contact list. Do not try to overcome it.' };
    case 'existing_solution':
      return { kind, suppress: false, action: 'They already have something. Ask once whether it covers the gap; if they are not open to it, leave it there.',
        draft: `${hi(c)}\n\nThanks for letting me know, good to hear it's covered. Is it working well, or are there parts that still take manual effort?\n\nIf it's all running smoothly, no problem at all and I'll leave it there.\n\n${sign(sender)}` };
    case 'more_info':
      return { kind, suppress: false, action: 'Explain what you saw before mentioning any solution.',
        draft: `${hi(c)}\n\nHappy to explain. ${r.observation ?? ''}${r.evidence ? ` (what I checked: ${r.evidence.charAt(0).toLowerCase()}${r.evidence.slice(1)}.)` : ''} ${r.impact ?? ''}\n\nI'm not selling anything here, I just wanted to know whether it's on your radar.\n\n${sign(sender)}`.replace(/ {2,}/g, ' ') };
    case 'positive':
      return { kind, suppress: false, action: 'They are engaging. Qualify the problem with one question; do not pitch yet.',
        draft: `${hi(c)}\n\nThanks for coming back to me. So I understand your setup, ${qualify(r)}\n\n${sign(sender)}` };
    default:
      return { kind: 'unclear', suppress: false, draft: null, action: 'The reply is not clear. Read it yourself and decide. Nothing was changed.' };
  }
}

const qualify = (r: CounterPitchResearch): string => {
  const w = spellingFor(r.country);
  switch (r.gap) {
    case 'booking_by_form': return `how do ${w.enquiries} from the form reach your team today, and how long does a reply usually take?`;
    case 'no_booking': return 'how do people book with you today, and what happens to someone who tries after hours?';
    case 'no_website': return `where do most new ${w.enquiries} come from today?`;
    case 'no_chat': return 'what do visitors do today if they have a question but are not ready to call?';
    case 'not_mobile': return `roughly how many of your ${w.enquiries} come from people on phones?`;
    case 'no_https': return 'who looks after the website today?';
    default: return 'what does your process look like today?';
  }
};

/** A low-pressure follow-up when there has been no reply. A different angle on the same single problem, with the opt-out. */
export function noResponseFollowUp(c: FollowUpContext, sender = 'Your name'): FollowUpDraft {
  const r = c.research;
  const angle = FRESH_ANGLE[r.gap ?? '']?.(spellingFor(r.country));
  if (!angle) return { kind: 'no_response', suppress: false, draft: null, action: 'No follow-up angle is stored for this lead. Write one by hand.' };
  return {
    kind: 'no_response', suppress: false, action: 'No reply yet. Send once, a few days after the first email, and stop if there is no answer.',
    draft: `${hi(c)}\n\n${angle}\n\nNo worries if it's not a priority.\n\n${sign(sender)}\n\nP.S. ${OPT_OUT}`,
  };
}

import { GAP_LABEL, type Outreach } from './research';
import type { GhlStatus } from './ghlDetect';
import { COPY_RULES, GAP_ORDER, pickPlay } from './playbook';
import { usableQuestion } from './aiCheck';

const SIGNAL_TEXT: Record<string, string> = {
  no_website: "I couldn't find a website for {n}. We build sites that turn searches into booked calls.",
  booking_by_form: "I noticed {n} takes booking requests by form. A booking calendar with automatic reminders could turn those into confirmed times without the back-and-forth.",
  no_booking: "I noticed {n} doesn't offer online booking. An appointment booking system with automatic reminders could cut no-shows and save you phone time.",
  no_chat: "I noticed {n}'s site has no way to capture visitors who aren't ready to call. An AI lead qualification assistant could reply instantly and route good prospects to you.",
  no_analytics: "I noticed {n}'s site isn't tracking where leads come from. A sales pipeline system would show what's working from inquiry to closed deal.",
  no_instagram: "I couldn't find an Instagram presence linked from {n}'s site. Automated follow-up could keep you in front of past customers.",
  not_mobile: "{n}'s site doesn't look mobile-friendly, which loses leads from phones. We can rebuild it fast.",
  no_https: "{n}'s site isn't on HTTPS, so browsers warn visitors. We can fix that and modernize the site.",
};
const ORDER = GAP_ORDER;
/** Speed: qwen3 "thinks" for a minute before answering unless told not to (61 s -> 5 s measured); keep_alive stops it unloading between leads. Models that don't think ignore `think`. */
const FAST = { think: false, keep_alive: '30m' };

export function templateOpener(name: string, signals: string[]): string {
  const s = ORDER.find(k => signals.includes(k));
  if (!s) return `Hi ${name}, I help local businesses automate lead follow-up and bookings. Open to a quick chat?`;
  return SIGNAL_TEXT[s].replaceAll('{n}', name);
}

export async function generateOpener(input: {
  name: string; type: string; signals: string[]; offer: string;
}): Promise<{ text: string; usedFallback: boolean }> {
  const url = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
  const prompt = `You write cold-outreach openers for an agency.
Agency offers:
${input.offer}

Lead: "${input.name}" (${input.type}).
Gaps found: ${input.signals.length ? input.signals.join(', ') : 'none detected'}.

Write 1-2 sentences naming ONE specific gap and the ONE most relevant offer. Plain, friendly, no hype, no emojis, no greeting like "Dear". Output only the sentences.`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, ...FAST }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const text = String(((await res.json()) as { response?: string }).response ?? '').trim();
    if (!text) throw new Error('empty');
    return { text, usedFallback: false };
  } catch {
    return { text: templateOpener(input.name, input.signals), usedFallback: true };
  } finally { clearTimeout(t); }
}

// What we actually observed (facts only). The pitch (service, questions) comes from the playbook.
const OBSERVATION: Record<string, string> = {
  no_website: "I couldn't find a website for {n}.",
  no_booking: "I couldn't find an online booking tool on {n}'s website.",
  booking_by_form: "{n}'s website takes enquiries through a form, but I couldn't find a way to book a time directly.",
  no_chat: "I couldn't find a live chat on {n}'s website.",
  no_analytics: "I couldn't see any lead-source tracking on {n}'s website.",
  no_instagram: "I couldn't find Instagram linked from {n}'s website.",
};
// Website-only fixes have no playbook service.
const WEB: Record<string, Omit<Outreach, 'observation'> & { observation: string }> = {
  not_mobile: { observation: "{n}'s website may not be set up for phones.", opportunity: 'A mobile-friendly rebuild with clear contact and booking paths', openingQuestion: 'Have you checked how your site looks on a phone recently?', service: 'Web development', discoveryQuestion: 'What share of your inquiries come from mobile visitors?' },
  no_https: { observation: "{n}'s website opens on http:// without the secure padlock, so some browsers show a warning.", opportunity: 'A secure, modern website', openingQuestion: 'Is a website refresh on your list this year?', service: 'Web development', discoveryQuestion: 'Who manages your website today?' },
};
const GHL_TEMPLATE = { observation: '{n} appears to use GoHighLevel / LeadConnector on its website.', opportunity: 'Optimising the existing GHL setup: workflows, pipelines, AI agents', openingQuestion: 'Are you getting everything you hoped for out of your current CRM setup?', service: 'GHL optimisation + AI agents', discoveryQuestion: 'Which parts of your follow-up are still manual today?' };
const GENERIC_OBSERVATION = 'I came across {n} while researching local businesses.';

/** `social` is the social page(s) the business has, e.g. "Instagram": a business with no website but a page is described that way. */
export function templateOutreach(name: string, signals: string[], ghlStatus: GhlStatus, type = '', social?: string): Outreach {
  const key = ORDER.find(k => signals.includes(k));
  let t: Outreach;
  if (ghlStatus === 'likely') t = GHL_TEMPLATE;
  else if (key && WEB[key]) t = WEB[key];
  else {
    const play = pickPlay(signals, type);
    t = {
      observation: key === 'no_website' && social ? `I found {n} on ${social} but couldn't find a website.` : key ? OBSERVATION[key] : GENERIC_OBSERVATION, opportunity: play.opportunity, openingQuestion: play.question,
      service: key === 'no_website' ? 'Web development + Lead Management System' : play.service, discoveryQuestion: play.hook,
    };
  }
  return { ...t, observation: t.observation.replaceAll('{n}', name) };
}

const sentences = (t: string) => t.match(/[^.!?]+[.!?]+/g)?.map(x => x.trim()) ?? (t ? [t] : []);
const lastQuestion = (t: string) => [...sentences(t)].reverse().find(x => x.endsWith('?')) ?? '';
const firstQuestion = (t: string) => sentences(t).find(x => x.endsWith('?')) ?? '';

export async function generateOutreach(input: {
  name: string; type: string; observed: string[]; gaps: string[]; ghlStatus: GhlStatus; offer: string; social?: string;
}): Promise<Outreach & { usedFallback: boolean; /** Ollama could not be reached or sent nothing usable: the only case worth telling the owner to start it */ aiDown: boolean }> {
  const url = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';
  const anchor = templateOutreach(input.name, input.gaps, input.ghlStatus, input.type, input.social);
  const observed = input.social && input.gaps.includes('no_website') ? [...input.observed, `Has a ${input.social} page but no website`] : input.observed;
  const prompt = `You help an agency write cold outreach. Use ONLY the facts below. Do not invent problems, numbers, people or compliments.

${COPY_RULES}

Agency offers:
${input.offer}

Pitch angle to use: ${anchor.service}
Example of the right kind of question: ${anchor.discoveryQuestion}

Business: "${input.name}" (${input.type})
GoHighLevel status: ${input.ghlStatus === 'likely' ? 'website shows GHL/LeadConnector code (likely user)' : input.ghlStatus === 'potential' ? 'no GHL code found' : 'unknown'}
Observed: ${observed.length ? observed.join('; ') : 'nothing notable'}
Gaps found: ${input.gaps.length ? input.gaps.map(g => GAP_LABEL[g] ?? g).join('; ') : 'none detected'}

Fact the message will open with (already written, do not repeat or change it): ${anchor.observation}

Return JSON with these string keys:
"opening_question": ONE friendly, non-pushy question only, ending with "?". Do not repeat the fact above and do not state any new fact about the business,
"discovery_question": ONE question ending with "?" to learn how they handle this today.
No emojis, no hype.`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 90_000);
  let reached = false;   // Ollama answered (even if the answer was unusable)
  try {
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, format: 'json', ...FAST }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    reached = true;
    const raw = JSON.parse(String(((await res.json()) as { response?: string }).response ?? '{}'));
    const pick = (k: string) => (typeof raw[k] === 'string' ? raw[k].trim() : '');
    // the model only supplies questions: the factual line comes from what was actually checked, never from the model
    const o = { openingQuestion: lastQuestion(pick('opening_question')), discoveryQuestion: firstQuestion(pick('discovery_question')) };
    if (!o.openingQuestion && !o.discoveryQuestion) return { ...anchor, usedFallback: true, aiDown: false };   // it answered, just with no question
    // Quality gate (lib/aiCheck.ts): a question reaches the email only if it is a real, on-topic, non-pushy question that does not
    // just repeat the fact. Each is judged on its own; a bad one is replaced by the playbook's question, a good one is kept.
    const ctx = { service: anchor.service, observation: anchor.observation };
    const openOk = usableQuestion(o.openingQuestion, ctx);
    const discOk = usableQuestion(o.discoveryQuestion, ctx) && o.discoveryQuestion !== o.openingQuestion;
    return {
      observation: anchor.observation, opportunity: anchor.opportunity, service: anchor.service,
      openingQuestion: openOk ? o.openingQuestion : anchor.openingQuestion,
      discoveryQuestion: discOk ? o.discoveryQuestion : anchor.discoveryQuestion,
      usedFallback: !openOk && !discOk, aiDown: false,
    };
  } catch {
    return { ...anchor, usedFallback: true, aiDown: !reached };
  } finally { clearTimeout(t); }
}

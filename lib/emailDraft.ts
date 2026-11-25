import { isLeaderTitle, type Person } from './people';
import { OPT_OUT, type CounterPitchResearch } from './counterPitch';
import { COPY_MAX_WORDS, wordCount } from './emailValidate';

/**
 * The first-touch email (Counter Pitch Feedback Loop): greeting, one checked observation and why it may matter, ONE question,
 * a sign-off, and the reply-"No" opt-out as a P.S. It never pitches a service and never introduces the sender's company in the copy.
 * Built from the structured research (lib/counterPitch.ts), never from model text, so it cannot claim anything unverified.
 * The legal footer (who you are, where the address came from) sits after the opt-out and is not part of the word count.
 */
export const EMAIL_MAX_WORDS = COPY_MAX_WORDS;
export { wordCount };

export type Sender = { name?: string; proof?: string; title?: string; business?: string; address?: string; replyTo?: string; privacyUrl?: string };
export type DraftOptions = { sender?: Sender; country?: string; website?: string | null; people?: Person[] };
export type EmailDraft = { subject: string; body: string; /** "Subject: …" + blank line + body: the text kept in the opener field */ text: string; /** words in the copy (greeting, sign-off, opt-out and footer excluded) */ words: number; /** sender name, business, address and reply address are all set, so the legal footer is complete */ complete: boolean };

/** Sender details from the environment (SENDER_NAME, SENDER_TITLE, SENDER_BUSINESS, SENDER_ADDRESS, SENDER_EMAIL, SENDER_PRIVACY_URL). */
export const senderFromEnv = (e: Record<string, string | undefined> = process.env): Sender => ({
  name: e.SENDER_NAME, proof: e.SENDER_PROOF, title: e.SENDER_TITLE, business: e.SENDER_BUSINESS, address: e.SENDER_ADDRESS, replyTo: e.SENDER_EMAIL, privacyUrl: e.SENDER_PRIVACY_URL,
});
export const senderComplete = (s: Sender = {}): boolean => !!(s.name?.trim() && s.business?.trim() && s.address?.trim() && s.replyTo?.trim());

/** First name of the owner or director, only when the app found one with a deciding title. Letters only, so nothing odd lands in a greeting. */
export function leaderFirstName(people?: Person[]): string | undefined {
  const p = people?.find(x => isLeaderTitle(x.title));
  const first = p?.name.trim().split(/\s+/)[0] ?? '';
  return /^[\p{L}][\p{L}'’-]{1,19}$/u.test(first) ? first : undefined;
}

const siteOf = (w?: string | null): string | undefined => {
  try { return w ? new URL(/^https?:/i.test(w) ? w : `https://${w}`).hostname.replace(/^www\./, '') : undefined; } catch { return undefined; }
};

/** What the email is about, for the NZ / UK "why you are getting this" line. */
const TOPIC: Record<string, string> = {
  booking_by_form: 'how enquiries are handled', no_booking: 'online booking', no_website: 'your online presence',
  no_chat: 'your website', not_mobile: 'your website', no_https: 'your website',
};

/** Who you are and why they are getting this: the sender block plus the NZ / UK lines from the compliance checklist. Only when the sender details are complete. */
function footer(s: Sender, country: string | undefined, site: string | undefined, topic: string): string {
  const who = [s.name, s.business, s.address, s.replyTo].map(x => (x ?? '').trim()).filter(Boolean).join(' | ');
  const where = site ? `on ${site}` : 'in a public business listing';
  const c = (country ?? '').toUpperCase();
  let why = '';
  if (c === 'NZ') why = `I found your business email ${where} and I am emailing about ${topic}. I keep your name and business email only to contact you about this, and I do not share them. You can ask to see or correct what I hold.`;
  else if (c === 'GB' || c === 'UK') why = `I found your details ${where} and I am emailing about ${topic}.${s.privacyUrl?.trim() ? ` Privacy notice: ${s.privacyUrl.trim()}` : ''}`;
  return [who, why].filter(Boolean).join('\n');
}

/** Assemble the email from the research. `dropImpact` is the shorter version used when the first try is over the word limit. */
export function counterPitchEmail(r: CounterPitchResearch, subject: string, opts: DraftOptions & { dropImpact?: boolean } = {}): EmailDraft {
  const s = opts.sender ?? {};
  const first = leaderFirstName(opts.people) ?? r.prospectName;
  const greeting = first ? `Hi ${first},` : `Hi ${r.businessName} team,`;
  const observation = [r.observation, opts.dropImpact ? '' : r.impact].filter(Boolean).join(' ');
  const copy = `${observation}\n\n${r.question ?? ''}`.trim();
  const sign = (s.name ?? '').trim() || 'Your name';
  let body = `${greeting}\n\n${copy}\n\n${sign}\n\nP.S. ${OPT_OUT}`;
  const complete = senderComplete({ ...s, name: sign });
  if (complete) body += `\n\n${footer({ ...s, name: sign }, opts.country ?? r.country, siteOf(opts.website ?? r.website), TOPIC[r.gap ?? ''] ?? 'your business')}`;
  return { subject, body, text: `Subject: ${subject}\n\n${body}`, words: wordCount(copy), complete };
}

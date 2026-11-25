/**
 * Ways to reach a lead, best first, and a short first message for the social ones.
 * A one-person business with no website answers on Instagram, Facebook or WhatsApp, not on a contact form, so for them
 * the social page comes first. Nothing here guesses a contact: every channel comes from something the business lists
 * or its own website shows.
 */
export type ChannelKind = 'instagram' | 'facebook' | 'whatsapp' | 'phone' | 'email';
export type Channel = { kind: ChannelKind; label: string; url: string };

type LeadLike = { website?: string; email?: string; phone?: string; instagram?: string };
type ResearchLike = { facebook?: string; country?: string; emailCheck?: { status: string } };

const LABEL: Record<ChannelKind, string> = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', phone: 'Phone', email: 'Email' };
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const FACEBOOK = /^https?:\/\/(?:[a-z0-9-]+\.)?facebook\.com\//i;

/** Light check used in the browser: only numbers already in international form. The server passes the full parser (lib/phone.ts). */
const plainE164 = (raw: string | undefined): string | undefined => { const m = raw?.replace(/[\s().-]/g, ''); return m && /^\+[1-9]\d{6,14}$/.test(m) ? m : undefined; };

export function reachChannels(l: LeadLike & { name?: string }, r?: ResearchLike, toE164: (raw: string | undefined, country?: string) => string | undefined = plainE164,
  /** WhatsApp is offered only for a number this says is a mobile. With no way to tell, it is not offered. */
  isMobile?: (e164: string) => boolean): Channel[] {
  const found = new Map<ChannelKind, string>();
  if (l.instagram && HANDLE.test(l.instagram)) found.set('instagram', `https://www.instagram.com/${l.instagram}/`);
  if (r?.facebook && FACEBOOK.test(r.facebook)) found.set('facebook', r.facebook);
  const e164 = toE164(l.phone, r?.country);
  if (e164) { if (isMobile?.(e164)) found.set('whatsapp', `https://wa.me/${e164.slice(1)}`); found.set('phone', `tel:${e164}`); }
  // an address that cannot receive mail is not a way to reach them
  if (l.email && r?.emailCheck?.status !== 'bad') found.set('email', `mailto:${l.email}`);
  const order: ChannelKind[] = l.website
    ? ['email', 'instagram', 'facebook', 'whatsapp', 'phone']
    : ['instagram', 'facebook', 'whatsapp', 'phone', 'email'];
  return order.filter(k => found.has(k)).map(k => ({ kind: k, label: LABEL[k], url: found.get(k)! }));
}

/** "Instagram", "Facebook" or "Instagram and Facebook": the social pages a lead has, for wording. */
export function socialLabel(l: Pick<LeadLike, 'instagram'>, r?: Pick<ResearchLike, 'facebook'>): string | undefined {
  const ig = !!l.instagram && HANDLE.test(l.instagram), fb = !!r?.facebook && FACEBOOK.test(r.facebook);
  return ig && fb ? 'Instagram and Facebook' : ig ? 'Instagram' : fb ? 'Facebook' : undefined;
}

/**
 * A first message for a social channel: who you are not, where you found them, and one question. No links, no handles,
 * no pitch. Returns nothing when the best social way in is missing or there is no question to ask.
 */
export function dmDraft(name: string, question: string, channels: Channel[]): { text: string; platform: string; channel: Channel } | undefined {
  const q = question.trim();
  const channel = channels.find(c => c.kind === 'instagram' || c.kind === 'facebook' || c.kind === 'whatsapp');
  if (!q || !channel) return undefined;
  const text = channel.kind === 'whatsapp'
    ? `Hi, I found ${name} while looking at local businesses. ${q}`
    : `Hi, I came across ${name} on ${channel.label}. ${q}`;
  return { text, platform: channel.label, channel };
}

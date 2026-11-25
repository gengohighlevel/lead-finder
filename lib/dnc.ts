import { FREEMAIL } from './emailStatus';

/**
 * The do-not-contact list: people and businesses you must not contact again (unsubscribed, said no, asked to be removed).
 * An entry is an email address, a whole business domain, or a phone number. A lead matches by its email, the domain of its
 * email, its website, or its phone. Pure and client-safe: the page and the server apply exactly the same rules.
 */
export type SuppressionKind = 'email' | 'domain' | 'phone';
export type Suppression = { id: number; kind: SuppressionKind; value: string; reason?: string; createdAt: string };
export type Entry = { kind: SuppressionKind; value: string };

// Platforms where one address belongs to many unrelated businesses: never block these as a whole.
const SHARED = ['facebook.com', 'fb.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'pinterest.com', 'yelp.com', 'google.com', 'g.page', 'goo.gl', 'linktr.ee', 'bit.ly', 'tripadvisor.com', 'airbnb.com', 'vrbo.com', 'booking.com', 'wa.me', 'whatsapp.com', 'm.me'];
export const isShared = (host: string) => SHARED.some(d => host === d || host.endsWith(`.${d}`));
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Read one entry from free text. undefined when it is not an email, a domain or a phone number. */
export function parseEntry(raw: string): Entry | undefined {
  const t = (raw ?? '').trim();
  if (!t) return undefined;
  if (/^@/.test(t) || !t.includes('@')) {
    // a domain or URL, or a phone number
    if (/^[+(\d][\d\s().-]{5,}$/.test(t)) { const d = t.replace(/\D/g, ''); return d.length >= 7 ? { kind: 'phone', value: d } : undefined; }
    const host = t.replace(/^@/, '').replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/^www\./i, '').toLowerCase();
    if (!DOMAIN.test(host) || FREEMAIL.has(host) || isShared(host)) return undefined;
    return { kind: 'domain', value: host };
  }
  return EMAIL.test(t) ? { kind: 'email', value: t.toLowerCase() } : undefined;
}

/** A pasted list: one per line, or separated by commas or semicolons. */
export function parseEntries(text: string): { entries: Entry[]; unreadable: string[] } {
  const entries: Entry[] = [], unreadable: string[] = [], seen = new Set<string>();
  for (const part of (text ?? '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)) {
    const e = parseEntry(part);
    if (!e) { unreadable.push(part); continue; }
    const k = `${e.kind}:${e.value}`;
    if (!seen.has(k)) { seen.add(k); entries.push(e); }
  }
  return { entries, unreadable };
}

const hostOf = (u?: string) => (u ?? '').trim().toLowerCase().match(/^(?:[a-z]+:\/\/)?([^/?#:]+)/)?.[1]?.replace(/^www\./, '');
const inDomain = (host: string | undefined, d: string) => !!host && (host === d || host.endsWith(`.${d}`));
const phoneKey = (p?: string) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-9) : ''; };

export type SuppressionMatch = { suppression: Suppression; via: 'email' | 'email domain' | 'website' | 'phone' };

/** Is this lead on the list, and why. */
export function matchSuppression(l: { email?: string; website?: string; phone?: string }, list: Suppression[]): SuppressionMatch | undefined {
  const email = l.email?.trim().toLowerCase();
  const emailDomain = email?.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : undefined;
  const site = hostOf(l.website);
  const pk = phoneKey(l.phone);
  for (const s of list) {
    if (s.kind === 'email' && email && s.value === email) return { suppression: s, via: 'email' };
    if (s.kind === 'domain') {
      if (inDomain(site, s.value)) return { suppression: s, via: 'website' };
      if (emailDomain && !FREEMAIL.has(emailDomain) && inDomain(emailDomain, s.value)) return { suppression: s, via: 'email domain' };
    }
    if (s.kind === 'phone' && pk && pk === s.value.slice(-9)) return { suppression: s, via: 'phone' };
  }
  return undefined;
}

/** The entries that put a lead on the list: its email, its website's domain and its phone (those that can be read). */
export function leadEntries(l: { email?: string; website?: string; phone?: string }): Entry[] {
  return [l.email, l.website, l.phone].map(v => (v ? parseEntry(v) : undefined)).filter((e): e is Entry => !!e);
}

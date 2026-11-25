import { GAP_LABEL, SITE_CHECK_VERSION } from './research';
import { GAP_ORDER, isQuoteLed } from './playbook';
import type { SiteFacts } from './siteFacts';

/**
 * Counter Pitch Feedback Loop: structured research for a first-touch email.
 * The email is about the PROSPECT's business: one checked observation, why it may matter, and one question that asks whether
 * they already have a process for it. Every sentence comes from a template tied to a gap the website check actually found, so the
 * app cannot state a problem it did not see. No service is pitched in this email.
 *
 * Pure and client-safe (no network, no database).
 */

/** verified = seen on pages we read; inferred = a reasonable reading (the page may hide it); weak = not enough to write about. */
export type Confidence = 'verified' | 'inferred' | 'weak';

/** What the email is built from. Edited fields keep the evidence and source next to them. */
export type CounterPitchResearch = {
  prospectName?: string; businessName: string; industry: string; country?: string; website?: string;
  /** where the observation was made (the website, or the map listing when there is no website) */
  source?: string;
  gap?: string; observation?: string; evidence?: string; friction?: string; impact?: string;
  confidence: Confidence; question?: string;
};

export type CounterPitchInput = {
  name: string; type?: string; signals: string[]; ghlStatus?: 'likely' | 'potential' | 'insufficient';
  /** "Instagram" etc.: the social page the business has when it has no website */
  social?: string; website?: string; country?: string; prospectName?: string;
  /** research.siteCheck (which version of the website rules produced the signals); undefined with a website = never checked */
  siteCheck?: number; hasResearch?: boolean;
  /** what the website check saw (research.processes): contact_form, phone_link, booking_link, online_booking, live_chat … */
  processes?: string[];
  /** suburb and services read from the business's own site (lib/siteFacts.ts) */
  facts?: SiteFacts;
};

export type CounterPitchPlan = { status: 'ready' | 'needs_research'; missing: string[]; research: CounterPitchResearch; subject?: string };

/** Spelling by country: "enquiry" in AU/NZ/UK/IE/EU, "inquiry" in US/CA/PH and when the country is unknown. */
const BRITISH = new Set(['AU', 'NZ', 'GB', 'UK', 'IE', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
export const spellingFor = (country?: string) => {
  const brit = BRITISH.has((country ?? '').toUpperCase());
  return { enquiry: brit ? 'enquiry' : 'inquiry', enquiries: brit ? 'enquiries' : 'inquiries', Enquiries: brit ? 'Enquiries' : 'Inquiries' };
};
type Words = ReturnType<typeof spellingFor>;
/** The kind of business decides the words: patients book appointments, clients book sessions, customers ask for quotes. */
type Kind = 'health' | 'beauty' | 'trade' | 'professional' | 'fitness' | 'rental' | 'general';
const KIND: [RegExp, Kind][] = [
  [/dent|clinic|physio|chiropract|optom|optic|doctor|medical|orthodon|podiat|psycholog|therap|\bvet|veterin|surgery|hearing/i, 'health'],
  [/salon|hair|barber|beauty|nail|\bspa\b|massage|makeup|lash|brow|tattoo|esthetic|aesthetic/i, 'beauty'],
  [/plumb|electric|hvac|air.?con|roof|contract|build|renovat|paint|carpent|garden|landscap|mov(er|ing)|removal|clean|pest|handyman|locksmith|tiler|plaster|solar|fenc/i, 'trade'],
  [/real estate|realtor|lawyer|attorney|\blaw\b|account|insurance|bookkeep|architect|designer|consult|coach|photograph|tutor/i, 'professional'],
  [/gym|fitness|yoga|pilates|crossfit|personal train/i, 'fitness'],
  [/rental|charter|yacht|vacation|holiday|airbnb|boat|car hire|\bhire\b/i, 'rental'],
];
const VOCAB: Record<Kind, { who: string; visit: string }> = {
  health: { who: 'patients', visit: 'appointment' }, beauty: { who: 'clients', visit: 'booking' }, trade: { who: 'customers', visit: 'job' },
  professional: { who: 'clients', visit: 'meeting' }, fitness: { who: 'members', visit: 'session' }, rental: { who: 'guests', visit: 'booking' }, general: { who: 'customers', visit: 'booking' },
};
export const kindOf = (type = ''): Kind => KIND.find(([re]) => re.test(type))?.[1] ?? 'general';

type Ctx = {
  n: string; /** the name when short enough for a subject line */ short?: string; domain?: string; w: Words; social?: string;
  who: string; Who: string; /** singular: patient, client */ one: string; visit: string; kind: Kind; has: Set<string>; seed: number;
  /** services the site names, e.g. "dental implants and Invisalign" */ svc?: string; /** suburb from the site's address data */ loc?: string;
};

/** What the page showed, in words: "a contact form and a phone number". Only things actually seen. */
const SEEN: [string, string][] = [['contact_form', 'a contact form'], ['quote_request', 'a quote request form'], ['online_booking', 'online booking'], ['booking_link', 'a Book link'], ['phone_link', 'a phone number'], ['messaging_link', 'a WhatsApp or Messenger link']];
const seen = (has: Set<string>, skip: string[] = []): string => {
  const parts = SEEN.filter(([k]) => has.has(k) && !skip.includes(k)).map(([, v]) => v).slice(0, 2);
  return parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0] ?? '';
};
/** Possessive: "Smile Dental's", but "Specialist Orthodontists'" (a name that already ends in s). */
export const poss = (n: string) => (/s$/i.test(n.trim()) ? `${n.trim()}'` : `${n.trim()}'s`);
const hash = (s: string) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
/** The same business always gets the same wording; different businesses get different wording. */
const pick = <T,>(xs: T[], seed: number, salt: number): T => xs[((seed >>> salt) + salt) % xs.length];

type Template = {
  confidence: Confidence; friction: string;
  observation: (c: Ctx) => string; impact: (c: Ctx) => string; question: (c: Ctx) => string; subject: (c: Ctx) => string;
};

/** One template family per gap that can honestly start a conversation. Wording varies with what was seen on THIS site, the kind of
 *  business and its domain. Impact lines are hedged ("may"); the observation is only what was seen. */
const TEMPLATES: Record<string, Template> = {
  booking_by_form: {
    confidence: 'verified', friction: 'Enquiries wait in a form until someone replies and books by hand.',
    observation: c => pick([
      ...(c.has.has('booking_link') ? [`${poss(c.n)} site has a Book link, but I couldn't find a booking calendar behind it, only a form.`] : []),
      ...(c.has.has('phone_link') ? [`${poss(c.n)} website lists a phone number and takes ${c.w.enquiries} through a form, but I couldn't find a way to book a time directly.`] : []),
      `${poss(c.n)} website takes ${c.w.enquiries} through a form, but I couldn't find a way to book a time directly.`,
      `To get in touch with ${c.n} online you fill in a form, and I couldn't find a way to book a time directly.`,
      ...(c.domain ? [`On ${c.domain}, your ${c.w.enquiries} go through a form and I couldn't find a way to book a time directly.`] : []),
    ], c.seed, 1),
    impact: c => ({ health: `A patient comparing a few practices may not wait for a reply.`, beauty: `A client choosing between a few studios may book wherever replies first.`, trade: `Someone collecting a few quotes may go with whoever replies first.`,
      professional: `A client comparing a few firms may not wait for a reply.`, fitness: `Someone trying a few gyms may join wherever replies first.`, rental: `A guest comparing a few places may book wherever replies first.`, general: `People comparing a few businesses may not wait for a reply.` })[c.kind],
    question: c => pick([`Does your team already have a process for following up with those ${c.w.enquiries}?`, `Is your team already tracking how quickly those ${c.w.enquiries} get a reply?`, `Is there already a set time each day when those ${c.w.enquiries} get answered?`], c.seed, 2),
    subject: c => pick([`${c.w.Enquiries} waiting behind a form?`, ...(c.short ? [`Who answers the form at ${c.short}?`] : []), ...(c.domain ? [`Form ${c.w.enquiries} on ${c.domain}?`] : []), `${c.Who[0].toUpperCase()}${c.Who.slice(1)} waiting behind a form?`], c.seed, 3),
  },
  no_booking: {
    confidence: 'verified', friction: 'Bookings may only be possible by phone during opening hours.',
    observation: c => pick([
      `I couldn't find a way to book online on ${poss(c.n)} website.`,
      `${poss(c.n)} website doesn't seem to let ${c.who} book online, at least not that I could find.`,
      ...(c.has.has('phone_link') ? [`${poss(c.n)} website lists a phone number, but I couldn't find a way to book online.`] : []),
      ...(c.has.has('contact_form') ? [`${poss(c.n)} site has a contact form, but I couldn't find a way to book online.`] : []),
      ...(c.domain ? [`On ${c.domain} I couldn't find a way for your ${c.who} to book ${c.visit === 'booking' ? 'anything' : c.visit === 'appointment' ? 'an appointment' : `a ${c.visit}`} online.`] : []),
    ], c.seed, 1),
    impact: c => ({ health: `A patient wanting an appointment after hours may try another practice.`, beauty: `A client wanting a slot in the evening may book somewhere else.`, trade: `Someone wanting a time after hours may try another business.`,
      professional: `A client wanting a time after hours may contact another firm.`, fitness: `Someone wanting to try a session after work may sign up elsewhere.`, rental: `A guest wanting to book at night may choose another place.`, general: `Someone wanting a time after hours may give up or try a competitor.` })[c.kind],
    question: c => pick([`Do you already have a way for ${c.who} to book after hours?`, `Is online booking something you're already looking at?`, `Is your team already handling after-hours ${c.visit}s some other way?`], c.seed, 2),
    subject: c => pick([c.short ? `After-hours ${c.visit}s at ${c.short}?` : `After-hours ${c.visit}s going elsewhere?`, ...(c.short ? [`${c.short}: booking after hours?`] : []), `${c.Who[0].toUpperCase()}${c.Who.slice(1)} booking after hours?`], c.seed, 3),
  },
  no_website: {
    confidence: 'inferred', friction: 'People searching online may have no clear way to find or contact the business.',
    observation: c => (c.social ? pick([`I found ${c.n} on ${c.social} but couldn't find a website.`, `${c.n} has ${/^[aeiou]/i.test(c.social) ? 'an' : 'a'} ${c.social} page, but I couldn't find a website.`, `${c.n} is easy to find on ${c.social}, but I couldn't find a website for it.`], c.seed, 1)
      : pick([`I couldn't find a website for ${c.n}.`, `${c.n} doesn't seem to have a website, at least none I could find.`, `Searching for ${c.n} online, I couldn't find a website.`], c.seed, 1)),
    impact: c => `${c.Who[0].toUpperCase()}${c.Who.slice(1)} searching for you online may struggle to find a way to get in touch.`,
    question: c => pick([`Is getting a website something you're already working on?`, `Do you already have a way for ${c.who} to find you online?`], c.seed, 2),
    subject: c => pick([`Can ${c.who} find ${c.short ?? 'you'} online?`, ...(c.short ? [`${c.short}: where is the website?`, `Searching for ${c.short} online?`] : [`Can ${c.who} search and find you?`]), ...(c.social ? [`${c.social} page but no website?`] : [])], c.seed, 3),
  },
  no_chat: {
    confidence: 'inferred', friction: 'Visitors who are not ready to call have no easy first step.',
    observation: c => { const x = seen(c.has, ['online_booking']); return pick([
      `I couldn't find a live chat or quick-message option on ${poss(c.n)} website.`,
      `${poss(c.n)} website has no live chat or quick-message option that I could find.`,
      ...(c.domain ? [`On ${c.domain} I couldn't find a live chat or quick-message option for your ${c.who}.`] : []),
      ...(x ? [`${poss(c.n)} website has ${x}, but I couldn't find a live chat or quick-message option.`] : []),
      ...(c.has.has('online_booking') ? [`${poss(c.n)} website has online booking, but I couldn't find a way to ask a quick question.`] : []),
    ], c.seed, 1); },
    impact: c => pick([`${c.Who[0].toUpperCase()}${c.Who.slice(1)} with a quick question who aren't ready to call may leave without getting in touch.`, `A ${c.who.replace(/s$/, '').replace('pet owner', 'pet owner')} with one quick question may not want to phone, and may simply leave.`, `Someone with a small question may not bother to call, and may move on.`], c.seed, 4),
    question: c => pick([`Is your team already tracking where those visitors drop off?`, `Is there already a way for ${c.who} to ask a quick question online?`], c.seed, 2),
    subject: c => pick([`${c.Who[0].toUpperCase()}${c.Who.slice(1)} with a quick question?`, ...(c.short ? [`Quick questions on the ${c.short} site?`] : []), ...(c.domain ? [`Quick questions on ${c.domain}?`] : [])], c.seed, 3),
  },
  not_mobile: {
    confidence: 'inferred', friction: 'The page code has no mobile viewport tag.',
    observation: c => pick([`${poss(c.n)} website may not be set up for phones.`, ...(c.domain ? [`On ${c.domain} the page code has no mobile setting, so your site may not suit phones.`] : [])], c.seed, 1),
    impact: c => `${c.Who[0].toUpperCase()}${c.Who.slice(1)} on a phone may find it hard to read or tap, and leave.`,
    question: c => pick([`Is a mobile fix something your team has planned?`, `Have you checked how the site looks on a phone lately?`], c.seed, 2),
    subject: c => pick([`Your website on a phone?`, ...(c.short ? [`${c.short} on a phone?`] : []), ...(c.domain ? [`${c.domain} on a phone?`] : [])], c.seed, 3),
  },
  no_https: {
    confidence: 'verified', friction: 'Browsers warn visitors about an insecure page.',
    observation: c => pick([`${poss(c.n)} website opens on http:// without the secure padlock, so some browsers show a warning.`, `Some browsers show a warning when they open ${poss(c.n)} website, because it has no secure padlock (it opens on http://).`, ...(c.domain ? [`Your site, ${c.domain}, opens on http:// without the padlock, so some browsers warn visitors.`] : [])], c.seed, 1),
    impact: c => pick([`${c.Who[0].toUpperCase()}${c.Who.slice(1)} may hesitate to send details through a page that shows a warning.`, `A browser warning may put off someone who is about to fill in your form.`, `Visitors may leave as soon as their browser warns them.`], c.seed, 4),
    question: c => pick([`Is this something your team is already working on?`, `Does someone already look after the website's security settings?`], c.seed, 2),
    subject: c => pick([...(c.domain ? [`Browser warning on ${c.domain}?`] : []), `Browser warning on your website?`, ...(c.short ? [`${c.short}: padlock missing?`] : [])], c.seed, 3),
  },
};

/** When the site gave specifics (a suburb, services named in its menus), the wording uses them. A fact only ever replaces generic wording. */
const EXTRA: Record<string, { obs?: (c: Ctx) => string[]; impact?: (c: Ctx) => string[]; subject?: (c: Ctx) => string[] }> = {
  booking_by_form: {
    obs: c => (c.svc ? [`${poss(c.n)} site covers ${c.svc}, but ${c.w.enquiries} go through a form and I couldn't find a way to book a time directly.`] : []),
    impact: c => [...(c.svc ? [`A ${c.one} looking into ${c.svc} may not wait for a reply.`] : []), ...(c.loc ? [`A ${c.one} comparing a few options in ${c.loc} may not wait for a reply.`] : [])],
    subject: c => (c.loc ? [`${c.loc} ${c.who} waiting behind a form?`] : []),
  },
  no_booking: {
    obs: c => (c.svc ? [`${poss(c.n)} site covers ${c.svc}, but I couldn't find a way to book online.`] : []),
    impact: c => [...(c.svc ? [`Someone looking into ${c.svc} after hours may try another provider.`] : []), ...(c.loc ? [`A ${c.one} in ${c.loc} wanting a time after hours may book somewhere else.`] : [])],
    subject: c => (c.loc ? [`${c.loc} ${c.who} booking after hours?`] : []),
  },
  no_chat: {
    obs: c => (c.svc ? [`${poss(c.n)} site covers ${c.svc}, but I couldn't find a live chat or quick-message option.`] : []),
    impact: c => (c.svc ? [`A ${c.one} with a question about ${c.svc!.split(' and ')[0]} may not want to phone, and may leave.`] : []),
    subject: c => (c.loc ? [`${c.loc} ${c.who} with a quick question?`] : []),
  },
};
for (const [gap, x] of Object.entries(EXTRA)) {
  const t = TEMPLATES[gap], o = t.observation, im = t.impact, su = t.subject;
  t.observation = c => { const f = x.obs?.(c) ?? []; return f.length ? pick(f, c.seed, 1) : o(c); };
  t.impact = c => { const f = x.impact?.(c) ?? []; return f.length ? pick(f, c.seed, 4) : im(c); };
  t.subject = c => { const f = x.subject?.(c) ?? []; return f.length ? pick(f, c.seed, 3) : su(c); };
}

/** Gaps that show no business problem on their own: not enough to write an email about. */
const WEAK = new Set(['no_instagram', 'no_analytics']);

export const OPT_OUT = `If this isn't relevant, just reply "No" and I'll remove you from my list.`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A subject line is 3 to 7 words: when the business name makes it too long, use wording without the name. */
function fitSubject(t: Template, ctx: Ctx): string {
  const words = (x: string) => x.trim().split(/\s+/).length;
  for (const c of [ctx, { ...ctx, short: undefined }, { ...ctx, short: undefined, loc: undefined }]) { const s = cap(t.subject(c)); if (words(s) >= 3 && words(s) <= 7) return s; }
  return cap(t.subject({ ...ctx, short: undefined, domain: undefined }));
}

/** Decide whether there is enough checked research for an email, and what it would say. */
export function planCounterPitch(i: CounterPitchInput): CounterPitchPlan {
  const base: CounterPitchResearch = {
    businessName: i.name, industry: i.type?.trim() || 'local business', confidence: 'weak',
    ...(i.prospectName ? { prospectName: i.prospectName } : {}), ...(i.country ? { country: i.country } : {}), ...(i.website ? { website: i.website } : {}),
  };
  const needs = (...missing: string[]): CounterPitchPlan => ({ status: 'needs_research', missing, research: base });

  if (i.hasResearch === false) return needs('This lead has not been researched yet. Run the research step first.');
  if (i.website && (i.siteCheck ?? 0) < SITE_CHECK_VERSION) return needs('The website was checked under older rules, so its findings may be wrong. Use "Re-check" first.');

  const n = i.name.trim();
  const kind = kindOf(i.type);
  const who = i.type && /\bvet|veterin/i.test(i.type) ? 'pet owners' : VOCAB[kind].who;
  const domain = ((): string | undefined => { try { return i.website ? new URL(/^https?:/i.test(i.website) ? i.website : `https://${i.website}`).hostname.replace(/^www\./, '') : undefined; } catch { return undefined; } })();
  const ctx: Ctx = {
    n, w: spellingFor(i.country), social: i.social, who, Who: who, one: who.replace(/s$/, ''), svc: i.facts?.services.length ? i.facts.services.join(' and ') : undefined, loc: i.facts?.locality, visit: VOCAB[kind].visit, kind, domain, has: new Set(i.processes ?? []), seed: hash(n.toLowerCase()),
    short: n.split(/\s+/).length <= 3 && n.length <= 28 ? n : undefined,
  };
  const usable = GAP_ORDER.filter(g => i.signals.includes(g) && TEMPLATES[g] && !(g === 'no_booking' && isQuoteLed(i.type ?? '')));
  const gap = usable[0];
  if (!gap) {
    const missing: string[] = [];
    const weak = i.signals.filter(s => WEAK.has(s));
    if (weak.length) missing.push(`Only weak signals were found (${weak.map(s => GAP_LABEL[s] ?? s).join('; ')}). They do not show a business problem on their own.`);
    if (i.signals.includes('no_booking') && isQuoteLed(i.type ?? '')) missing.push('This business sells by quote, so a missing booking tool is not a problem for it. Look at how it handles quote requests instead.');
    if (i.ghlStatus === 'likely') missing.push('Its website uses GoHighLevel / LeadConnector, but no problem with how it is used was found. Look at its forms and follow-up by hand.');
    if (!missing.length) missing.push('No specific, checked problem was found, only general listing details. Look at its website, reviews or enquiry handling by hand and note one real observation.');
    missing.push('Add one verified observation with its evidence, then generate again.');
    return needs(...missing);
  }
  const t = TEMPLATES[gap];
  const research: CounterPitchResearch = {
    ...base, gap, confidence: t.confidence,
    observation: t.observation(ctx), evidence: GAP_LABEL[gap] ?? gap, friction: t.friction, impact: t.impact(ctx), question: t.question(ctx),
    source: gap === 'no_website' ? 'Map listing (OpenStreetMap / Overture), no website found' : i.website,
  };
  return { status: 'ready', missing: [], research, subject: fitSubject(t, ctx) };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { verified: 'Verified: seen on the pages checked', inferred: 'Inferred: a reasonable reading, the page may hide it', weak: 'Weak: not enough to write about' };

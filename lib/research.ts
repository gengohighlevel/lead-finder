import type { GhlStatus } from './ghlDetect';
import type { Score } from './score';
import type { Person } from './people';
import type { EmailCheck, EmailApproval } from './emailStatus';
import type { AbnInfo } from './abn';
import type { CounterPitchRecord } from './counterPitchRun';
import type { SiteFacts } from './siteFacts';

export type Outreach = { observation: string; opportunity: string; openingQuestion: string; service: string; discoveryQuestion: string };
export type Research = {
  ghlStatus: GhlStatus; ghlEvidence: string[]; processes: string[]; facebook?: string;
  country?: string; region?: string; city?: string;
  score: Score; sourceUrls: string[]; verifiedAt: string; outreach?: Outreach;
  /** Names the business publishes on its own site. undefined = not looked for yet; [] = looked, none found. */
  people?: Person[]; peopleCheckedAt?: string;
  /** Can this email receive mail? undefined = not checked yet. */
  emailCheck?: EmailCheck;
  /** Where the email came from: the business's own website, or a listing (map data). Only the website counts as proof for a free mailbox. */
  emailSource?: 'website' | 'listing';
  /** You approved this exact address by hand (only possible for an ownership doubt, never for a bad address). */
  emailApproval?: EmailApproval;
  /** Australian Business Register record (needs the free ABN_GUID key): active or cancelled, entity type, and a sole trader's own name. */
  abn?: AbnInfo;
  /** Things we could not judge from the page source (script-built page, website-builder, parked domain), with why. Never shown as a gap. */
  unchecked?: { signals: string[]; reason: string };
  /** GHL pages served from a domain that is neither the business's website nor matches its name: likely an agency, a software company built on GHL, or a parent brand. */
  ghlVia?: { domain: string; hosts: string[]; reason: string };
  /** Which version of the website check produced the gaps above. Older leads carry claims from rules that were wrong too often (see lib/siteAnalysis.ts). */
  siteCheck?: number;
  /** First-touch email built by the Counter Pitch framework (lib/counterPitch.ts): research, email, ten-point check. Absent on leads scored before it existed. */
  counterPitch?: CounterPitchRecord;
  /** Specifics read from the business's own site (suburb, services named in its menus) for the personalised email. */
  siteFacts?: SiteFacts;
};

/** The current website check. Raise it when the rules change so older leads can be re-checked. */
export const SITE_CHECK_VERSION = 5; // 5: leads nobody can reach can no longer rank A or B

export const UNCHECKED_LABEL: Record<string, string> = {
  no_booking: 'online booking', no_chat: 'live chat', no_analytics: 'analytics', no_instagram: 'Instagram link', not_mobile: 'mobile-friendliness',
};

/** Plain-English description of each detected gap (observed evidence, not assumptions). */
export const GAP_LABEL: Record<string, string> = {
  no_website: 'No website found in our sources',
  no_https: 'Website opens on http:// (not secure)',
  no_booking: 'No online booking, enquiry form or Book link found on the home, contact or booking page',
  booking_by_form: 'Bookings by enquiry only: a form or Book link, but no booking calendar found on the home, contact or booking page',
  no_chat: 'No live chat widget found on the home or contact page',
  no_analytics: 'No Google Analytics or ad pixel found on the home or contact page',
  no_instagram: 'No Instagram link found on the home or contact page',
  not_mobile: 'No mobile viewport tag in the page code (may not be mobile-friendly)',
};

const OPPORTUNITY: Record<string, string> = {
  no_website: 'Website that captures and routes inquiries into a CRM',
  no_https: 'Secure, modern website rebuild',
  no_booking: 'Online appointment booking with reminders and no-show follow-up',
  booking_by_form: 'A booking calendar customers can use themselves, so enquiries become confirmed times without back-and-forth',
  no_chat: 'AI receptionist / chat agent to qualify and route inquiries 24/7',
  no_analytics: 'Pipeline and reporting to track lead sources through to closed deals',
  no_instagram: 'Automated follow-up and reactivation to stay in front of past customers',
  not_mobile: 'Mobile-friendly site rebuild to stop losing phone visitors',
};

export function opportunitiesFor(signals: string[]): string[] {
  return signals.filter(s => OPPORTUNITY[s]).map(s => OPPORTUNITY[s]);
}

export const normName = (n: string) => n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
export const domainOf = (u?: string) => {
  if (!u) return undefined;
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return undefined; }
};

/** Drop duplicates by website domain and by normalized business name; first occurrence wins. */
export function dedupeLeads<T extends { name: string; website?: string }>(leads: T[]): T[] {
  const names = new Set<string>(), domains = new Set<string>();
  return leads.filter(l => {
    const n = normName(l.name), d = domainOf(l.website);
    if (names.has(n) || (d && domains.has(d))) return false;
    names.add(n); if (d) domains.add(d);
    return true;
  });
}

import type { Lead } from './db';
import { PROCESS_LABEL, type Process } from './evidence';
import { GAP_LABEL, opportunitiesFor } from './research';
import { toE164, isMobileNumber } from './phone';
import { isLeaderTitle } from './people';
import { reachChannels, dmDraft } from './channel';
import { formatAbn } from './abn';

export const FIELDS = ['company_name', 'industry', 'business_type', 'country', 'region', 'city', 'website', 'linkedin_company_url', 'instagram_url', 'facebook_url',
  'decision_maker_name', 'decision_maker_title', 'decision_maker_linkedin', 'people_found', 'business_email', 'business_phone', 'email_check', 'ghl_status', 'ghl_evidence',
  'observed_business_processes', 'potential_opportunities', 'recommended_service', 'outreach_angle', 'discovery_question', 'qualification_score',
  'qualification_priority', 'evidence_confidence', 'source_urls', 'verified_at',
  // added later, kept at the end so the columns above never move
  'best_channel', 'reach_channels', 'dm_draft', 'abn', 'abn_status',
  // Counter Pitch first-touch email (lib/counterPitch.ts)
  'counter_pitch_status', 'counter_pitch_subject', 'counter_pitch_confidence', 'counter_pitch_missing'] as const;
export type LeadRecord = Record<(typeof FIELDS)[number], string | number | string[] | null>;

export function toRecord(l: Lead, businessType: string): LeadRecord {
  const r = l.research;
  const o = r?.outreach;
  const dm = r?.people?.find(p => isLeaderTitle(p.title));
  const channels = reachChannels(l, r, toE164, isMobileNumber);
  const draft = o ? dmDraft(l.name, o.openingQuestion, channels) : undefined;
  return {
    company_name: l.name, industry: businessType, business_type: businessType,
    country: r?.country ?? null, region: r?.region ?? null, city: r?.city ?? null,
    website: l.website ?? null, linkedin_company_url: null,
    instagram_url: l.instagram ? `https://instagram.com/${l.instagram}` : null, facebook_url: r?.facebook ?? null,
    // only someone with a deciding title is called the decision maker; everyone found is still listed in people_found
    decision_maker_name: dm?.name ?? null, decision_maker_title: dm?.title ?? null, decision_maker_linkedin: null,
    people_found: r?.people?.length ? r.people.map(p => `${p.name}${p.title ? ` (${p.title})` : ''}`).join(' | ') : null,
    business_email: l.email ?? null,
    email_check: r?.emailCheck ? [r.emailCheck.status, ...(r.emailCheck.kind !== 'personal' ? [r.emailCheck.kind] : [])].join(' · ') : null, business_phone: toE164(l.phone, r?.country) ?? l.phone ?? null,
    ghl_status: r?.ghlStatus ?? null, ghl_evidence: r?.ghlEvidence ?? [],
    observed_business_processes: [
      ...(r?.processes ?? []).map(p => PROCESS_LABEL[p as Process] ?? p),
    ],
    potential_opportunities: opportunitiesFor(l.signals),
    recommended_service: o?.service ?? null,
    outreach_angle: o ? `${o.observation} ${o.openingQuestion}` : l.opener ?? null,
    discovery_question: o?.discoveryQuestion ?? null,
    qualification_score: r?.score.total ?? null, qualification_priority: r?.score.priority ?? null,
    evidence_confidence: r?.score.confidence ?? null,
    source_urls: r?.sourceUrls ?? [], verified_at: r?.verifiedAt ?? null,
    best_channel: channels[0]?.label ?? null,
    reach_channels: channels.length ? channels.map(c => `${c.label} ${c.url}`).join(' | ') : null,
    dm_draft: draft?.text ?? null,
    abn: r?.abn ? formatAbn(r.abn.abn) : null, abn_status: r?.abn?.status ?? null,
    counter_pitch_status: r?.counterPitch?.status ?? null, counter_pitch_subject: r?.counterPitch?.subject ?? null,
    counter_pitch_confidence: r?.counterPitch?.status && r.counterPitch.status !== 'needs_research' ? r.counterPitch.research.confidence : null,
    counter_pitch_missing: r?.counterPitch?.missing.length ? r.counterPitch.missing : [],
  };
}

/** Gaps as human-readable evidence (used in UI and GHL note). */
export const gapLabels = (signals: string[]) => signals.map(s => GAP_LABEL[s] ?? s);

// Names and notes come from outside sources. A cell that starts with = + - @ would run as a formula in Excel or Sheets,
// so it gets a leading apostrophe. Phone numbers and plain numbers (also start with + or -) are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;
const NUMBER_LIKE = /^[+-]?\d[\d\s().,-]*$/;
const cell = (v: LeadRecord[keyof LeadRecord]) => {
  let s = v === null ? '' : Array.isArray(v) ? v.join(' | ') : String(v);
  if (FORMULA_START.test(s) && !NUMBER_LIKE.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(records: LeadRecord[]): string {
  return [FIELDS.join(','), ...records.map(r => FIELDS.map(f => cell(r[f])).join(','))].join('\n');
}

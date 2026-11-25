import type { Lead } from './db';
import { canSend, isSendable, type EmailCheck } from './emailStatus';
import { matchSuppression, type Suppression, type SuppressionMatch } from './dnc';
import { DEFAULT_POLICY, countryOfLead, emailPolicyDecision, type Policy } from './outreachPolicy';
import { phoneCountry } from './phone';

/**
 * The one place that decides whether a lead's email may be given to GHL (and so be emailed). In order:
 *   1. do-not-contact list  2. the country rule  3. verification (verified, or approved by hand for that exact address).
 * A hand approval can open the third gate but never the first two.
 */
export type GateState = { policy: Policy; suppressions: Suppression[] };
export const DEFAULT_GATE: GateState = { policy: DEFAULT_POLICY, suppressions: [] };

export type EmailDecision = { send: boolean; by?: 'suppressed' | 'policy' | 'unverified'; reason: string; country?: string };

export const leadSuppression = (l: Pick<Lead, 'email' | 'website' | 'phone'>, g: GateState = DEFAULT_GATE): SuppressionMatch | undefined => matchSuppression(l, g.suppressions);

const whyUnverified = (c?: EmailCheck) => !c ? 'it has not been checked' : c.reasons.length ? c.reasons.join('; ') : c.status === 'ok' ? 'it was checked under older rules' : 'it did not pass the check';

export function emailDecision(l: Lead, g: GateState = DEFAULT_GATE): EmailDecision {
  if (!l.email) return { send: false, reason: 'no email on record' };
  const s = leadSuppression(l, g);
  if (s) return { send: false, by: 'suppressed', reason: `on your do-not-contact list (${s.via}: ${s.suppression.value}${s.suppression.reason ? `, ${s.suppression.reason}` : ''})` };
  const r = l.research;
  const country = countryOfLead(l, r, phoneCountry);
  const pol = emailPolicyDecision(country, r?.emailSource, g.policy);
  if (!pol.allowed) return { send: false, by: 'policy', reason: pol.reason, ...(country ? { country } : {}) };
  if (!canSend(r?.emailCheck, r?.emailApproval, l.email)) return { send: false, by: 'unverified', reason: `not verified: ${whyUnverified(r?.emailCheck)}`, ...(country ? { country } : {}) };
  return { send: true, reason: isSendable(r?.emailCheck) ? 'verified' : 'approved by you', ...(country ? { country } : {}) };
}

import type { Lead } from './db';
import { canBeReached } from './reach';
import { identityKeys } from './leadKeys';
import { hasRealName } from './leadName';

/**
 * Weak leads: ones not worth keeping. A lead is only judged once it has been looked at (researched); one we have not
 * looked at is unknown, not weak. A lead already pushed to GHL is never selected: it is in your CRM.
 */
export type WeakCriterion = 'priority-d' | 'no-way-to-reach' | 'dead-email-only' | 'business-closed' | 'low-confidence' | 'duplicate' | 'junk-name';

export const WEAK_CRITERIA: Record<WeakCriterion, { title: string; hint: string }> = {
  'priority-d': { title: 'Priority D', hint: 'scored under 40: a poor fit' },
  'no-way-to-reach': { title: 'No way to reach them', hint: 'no email, phone, Instagram, Facebook or contact form found' },
  'dead-email-only': { title: 'Only a dead email', hint: 'the only contact is an email that cannot receive mail' },
  'business-closed': { title: 'Business may have closed', hint: 'its ABN is cancelled (Australia)' },
  'junk-name': { title: 'Not a business name', hint: 'the name is just a number, like a unit or cabin number from a map' },
  'duplicate': { title: 'Duplicates', hint: 'the same business saved by another search; the best copy is kept' },
  'low-confidence': { title: 'Low confidence and low priority', hint: 'we know very little and it scores C or D' },
};

export function weakCriteria(l: Lead): WeakCriterion[] {
  const r = l.research;
  const out: WeakCriterion[] = [];
  if (!hasRealName(l.name)) out.push('junk-name');          // judged by the name alone, so it applies even before research
  if (!r) return out;
  const social = !!l.instagram || !!r.facebook;
  const form = r.processes.some(p => p === 'contact_form' || p === 'phone_link' || p === 'email_link');
  if (r.score.priority === 'D') out.push('priority-d');
  if (!canBeReached(l, r)) out.push('no-way-to-reach');
  if (l.email && r.emailCheck?.status === 'bad' && !l.phone && !social && !form) out.push('dead-email-only');
  if (r.abn?.status === 'Cancelled') out.push('business-closed');
  if (r.score.confidence === 'Low' && (r.score.priority === 'C' || r.score.priority === 'D') && !out.includes('priority-d')) out.push('low-confidence');
  return out;
}

/** For each business saved more than once (see lib/leadKeys.ts), every copy except the best. Name alone never matches. */
function duplicateLosers(leads: Lead[]): Set<number> {
  const groups = new Map<string, Lead[]>();
  for (const l of leads) for (const k of identityKeys(l)) groups.set(k, [...(groups.get(k) ?? []), l]);
  const losers = new Set<number>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const best = [...g].sort((a, b) => Number(!!b.pushedAt) - Number(!!a.pushedAt) || Number(!!b.research) - Number(!!a.research) || (b.research?.score.total ?? 0) - (a.research?.score.total ?? 0) || a.id - b.id)[0];
    for (const l of g) if (l.id !== best.id) losers.add(l.id);
  }
  return losers;
}

export function selectWeak(leads: Lead[], criteria: WeakCriterion[]): { ids: number[]; protectedPushed: number; byCriterion: Record<string, number> } {
  const want = new Set(criteria);
  const dup = want.has('duplicate') ? duplicateLosers(leads) : new Set<number>();
  const ids: number[] = [], byCriterion: Record<string, number> = {};
  let protectedPushed = 0;
  for (const l of leads) {
    const hit: WeakCriterion[] = weakCriteria(l).filter(c => want.has(c));
    if (dup.has(l.id)) hit.push('duplicate');
    if (!hit.length) continue;
    if (l.pushedAt) { protectedPushed++; continue; }
    ids.push(l.id);
    for (const c of hit) byCriterion[c] = (byCriterion[c] ?? 0) + 1;
  }
  return { ids, protectedPushed, byCriterion };
}

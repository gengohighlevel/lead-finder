import type { Lead } from './db';
import { planCounterPitch, type CounterPitchResearch } from './counterPitch';
import { counterPitchEmail, leaderFirstName, type DraftOptions } from './emailDraft';
import { validateEmail, type Validation } from './emailValidate';
import { socialLabel } from './channel';

/** What is saved on a lead (inside the research JSON) after a Counter Pitch run. */
export type CounterPitchRecord = {
  version: 1;
  /** ready: passed all ten checks. review: written, but a check failed (fix it by hand or regenerate). needs_research: no email written. */
  status: 'ready' | 'review' | 'needs_research';
  missing: string[];
  research: CounterPitchResearch;
  subject?: string; email?: string; words?: number; validation?: Validation;
  /** true when the wording was edited by hand and the email rebuilt from those edits */
  edited?: boolean;
  generatedAt: string;
};

/** Fields a user may reword. Evidence, source and confidence stay as researched. */
export type Edits = { subject?: string; observation?: string; impact?: string; question?: string };

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : undefined);
export function cleanEdits(raw: unknown): Edits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const e: Edits = {};
  for (const k of ['subject', 'observation', 'impact', 'question'] as const) { const v = clean(r[k], 300); if (v !== undefined) e[k] = v; }
  return e;
}

/**
 * Plan, write and check one lead's first-touch email. No network and nothing is sent.
 * With `edits`, the email is rebuilt from the edited wording on top of the SAME verified research (`prior`), then checked again.
 * Without edits, a failed check triggers one regeneration (the shorter version); if it still fails the lead is flagged for review.
 */
export function runCounterPitch(l: Lead, type: string, opts: Omit<DraftOptions, 'country' | 'website' | 'people'> = {}, edits?: Edits, prior?: CounterPitchRecord): { record: CounterPitchRecord; text?: string } {
  const r = l.research;
  const people = r?.people;
  const input = { name: l.name, type, signals: l.signals, ghlStatus: r?.ghlStatus, social: socialLabel(l, r), website: l.website, country: r?.country, siteCheck: r?.siteCheck, hasResearch: !!r, processes: r?.processes, facts: r?.siteFacts, prospectName: leaderFirstName(people) };
  const plan = planCounterPitch(input);
  const generatedAt = new Date().toISOString();
  if (plan.status === 'needs_research') return { record: { version: 1, status: 'needs_research', missing: plan.missing, research: plan.research, generatedAt } };

  // keep the researched evidence when the user rewords; edits only change the wording
  const base = edits && prior && prior.research.gap === plan.research.gap ? prior.research : plan.research;
  const research: CounterPitchResearch = { ...plan.research, ...base, ...(edits?.observation ? { observation: edits.observation } : {}), ...(edits?.impact !== undefined ? { impact: edits.impact } : {}), ...(edits?.question ? { question: edits.question } : {}) };
  const subject = edits?.subject || plan.subject!;
  const draftOpts: DraftOptions = { ...opts, country: r?.country, website: l.website, people };
  const ctx = { confidence: research.confidence, businessName: l.name };

  let draft = counterPitchEmail(research, subject, draftOpts);
  let validation = validateEmail(draft.text, ctx);
  if (!validation.ok && !edits) {
    const shorter = counterPitchEmail(research, subject, { ...draftOpts, dropImpact: true });
    const v2 = validateEmail(shorter.text, ctx);
    if (v2.checks.filter(c => !c.ok).length < validation.checks.filter(c => !c.ok).length) { draft = shorter; validation = v2; }
  }
  return {
    text: draft.text,
    record: { version: 1, status: validation.ok ? 'ready' : 'review', missing: [], research, subject, email: draft.text, words: draft.words, validation, ...(edits ? { edited: true } : {}), generatedAt },
  };
}

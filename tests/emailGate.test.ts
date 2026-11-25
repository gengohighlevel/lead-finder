import { describe, it, expect } from 'vitest';
import { emailDecision, leadSuppression, DEFAULT_GATE, type GateState } from '../lib/emailGate';
import { normalizePolicy } from '../lib/outreachPolicy';
import { EMAIL_CHECK_VERSION } from '../lib/emailStatus';
import type { Lead } from '../lib/db';

const ok = { status: 'ok', kind: 'personal', reasons: [], checkedAt: 't', v: EMAIL_CHECK_VERSION } as const;
const lead = (o: Partial<Lead> & { country?: string; emailSource?: 'website' | 'listing'; check?: any } = {}): Lead => ({
  id: 1, name: 'Smile', email: 'sarah@smile.example', website: 'https://smile.example', signals: [],
  research: { country: o.country ?? 'us', emailSource: o.emailSource ?? 'website', emailCheck: o.check ?? ok } as any,
  ...(({ country, emailSource, check, ...rest }) => rest)(o),
});

describe('emailDecision', () => {
  it('a verified email in an allowed country is sent', () => {
    expect(emailDecision(lead())).toMatchObject({ send: true });
  });
  it('no email: nothing to send', () => {
    expect(emailDecision(lead({ email: undefined }))).toMatchObject({ send: false, reason: expect.stringMatching(/no email/i) });
  });
  it('the country gate holds a verified email, and says it was the policy, not the check', () => {
    const d = emailDecision(lead({ country: 'de' }));
    expect(d).toMatchObject({ send: false, by: 'policy', country: 'DE' });
    expect(d.reason).toMatch(/DE/);
  });
  it('published-only: an address from a listing is held in Australia, but one from their own site is sent', () => {
    expect(emailDecision(lead({ country: 'au', emailSource: 'listing' }))).toMatchObject({ send: false, by: 'policy' });
    expect(emailDecision(lead({ country: 'au', emailSource: 'website' }))).toMatchObject({ send: true });
  });
  it('an unverified email is held by verification even where the country is allowed', () => {
    expect(emailDecision(lead({ check: { ...ok, status: 'risky', reasons: ['x'], approvable: true } }))).toMatchObject({ send: false, by: 'unverified' });
  });
  it('a hand approval opens the verification gate but never the country gate', () => {
    const risky = { ...ok, status: 'risky', reasons: ['other company'], approvable: true };
    const approved = { ...lead({ check: risky }), research: { ...lead({ check: risky }).research!, emailApproval: { email: 'sarah@smile.example', at: 't' } } } as Lead;
    expect(emailDecision(approved).send).toBe(true);
    expect(emailDecision({ ...approved, research: { ...approved.research!, country: 'de' } } as Lead)).toMatchObject({ send: false, by: 'policy' });
  });
  it('a lead on the do-not-contact list is never sent, whatever else is true', () => {
    const g: GateState = { ...DEFAULT_GATE, suppressions: [{ id: 3, kind: 'domain', value: 'smile.example', reason: 'asked to stop', createdAt: 't' }] };
    const d = emailDecision(lead(), g);
    expect(d).toMatchObject({ send: false, by: 'suppressed' });
    expect(d.reason).toMatch(/do-not-contact/i);
    expect(leadSuppression(lead(), g)?.suppression.id).toBe(3);
    expect(leadSuppression(lead(), DEFAULT_GATE)).toBeUndefined();
  });
  it('a custom policy is honoured', () => {
    const g: GateState = { ...DEFAULT_GATE, policy: normalizePolicy({ DE: 'allow' }) };
    expect(emailDecision(lead({ country: 'de' }), g).send).toBe(true);
  });
  it('falls back to the lead\'s phone country when its own country is missing', () => {
    const l = lead({ phone: '+49 30 12345678' }); (l.research as any).country = undefined;
    expect(emailDecision(l).country).toBe('DE');
  });
});

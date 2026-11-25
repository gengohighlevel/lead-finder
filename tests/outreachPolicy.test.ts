import { describe, it, expect } from 'vitest';
import { DEFAULT_POLICY, normalizePolicy, ruleFor, countryOfLead, emailPolicyDecision, EU } from '../lib/outreachPolicy';

describe('defaults', () => {
  it('US allowed; Canada, Australia, New Zealand only for addresses the business publishes; everything else, EU included, blocked', () => {
    expect(ruleFor('US', DEFAULT_POLICY)).toBe('allow');
    for (const c of ['CA', 'AU', 'NZ', 'PH']) expect(ruleFor(c, DEFAULT_POLICY), c).toBe('published-only');
    for (const c of ['DE', 'FR', 'GB', 'NG', 'AE']) expect(ruleFor(c, DEFAULT_POLICY), c).toBe('block');
    expect(ruleFor(undefined, DEFAULT_POLICY)).toBe('block');
  });
  it('lower-case country codes work', () => expect(ruleFor('au', DEFAULT_POLICY)).toBe('published-only'));
});

describe('normalizePolicy', () => {
  it('overrides defaults from a file; "default" sets the fallback; "EU" expands to all 27 members', () => {
    const p = normalizePolicy({ US: 'published-only', GB: 'allow', EU: 'published-only', default: 'allow' });
    expect(ruleFor('US', p)).toBe('published-only');
    expect(ruleFor('GB', p)).toBe('allow');
    expect(EU).toHaveLength(27);
    for (const c of EU) expect(ruleFor(c, p), c).toBe('published-only');
    expect(ruleFor('NG', p)).toBe('allow');
    expect(ruleFor('AU', p)).toBe('published-only'); // not mentioned: default kept
  });
  it('an explicit country wins over the EU group', () => {
    expect(ruleFor('DE', normalizePolicy({ EU: 'allow', DE: 'block' }))).toBe('block');
    expect(ruleFor('FR', normalizePolicy({ EU: 'allow', DE: 'block' }))).toBe('allow');
  });
  it('ignores anything invalid and falls back to the safe defaults', () => {
    for (const junk of [null, undefined, 'x', 5, [], { US: 'maybe', XX1: 'allow', '': 'allow', AU: 7 }]) {
      const p = normalizePolicy(junk);
      expect(ruleFor('US', p)).toBe('allow');
      expect(ruleFor('AU', p)).toBe('published-only');
      expect(ruleFor('DE', p)).toBe('block');
    }
  });
});

describe('countryOfLead', () => {
  const fromPhone = (p?: string) => (p === '+61412345678' ? 'AU' : undefined);
  it('uses the lead\'s own country first, then its phone number, else unknown', () => {
    expect(countryOfLead({ phone: '+61412345678' }, { country: 'us' }, fromPhone)).toBe('US');
    expect(countryOfLead({ phone: '+61412345678' }, {}, fromPhone)).toBe('AU');
    expect(countryOfLead({}, {}, fromPhone)).toBeUndefined();
    expect(countryOfLead({}, undefined, fromPhone)).toBeUndefined();
  });
  it('treats the market name "EU" or junk as unknown, not a country', () => {
    expect(countryOfLead({}, { country: 'EU' }, fromPhone)).toBeUndefined();
    expect(countryOfLead({}, { country: '??' }, fromPhone)).toBeUndefined();
  });
});

describe('emailPolicyDecision', () => {
  it('allow: any address', () => {
    expect(emailPolicyDecision('US', 'listing', DEFAULT_POLICY)).toMatchObject({ allowed: true, rule: 'allow' });
  });
  it('published-only: only an address found on the business\'s own website', () => {
    expect(emailPolicyDecision('AU', 'website', DEFAULT_POLICY)).toMatchObject({ allowed: true, rule: 'published-only' });
    const held = emailPolicyDecision('AU', 'listing', DEFAULT_POLICY);
    expect(held.allowed).toBe(false);
    expect(held.reason).toMatch(/AU.*own website/i);
    expect(emailPolicyDecision('AU', undefined, DEFAULT_POLICY).allowed).toBe(false);
  });
  it('block, and an unknown country, hold every address and say why', () => {
    const b = emailPolicyDecision('DE', 'website', DEFAULT_POLICY);
    expect(b).toMatchObject({ allowed: false, rule: 'block' });
    expect(b.reason).toMatch(/DE.*switched off/i);
    const u = emailPolicyDecision(undefined, 'website', DEFAULT_POLICY);
    expect(u.allowed).toBe(false);
    expect(u.reason).toMatch(/country is unknown/i);
  });
});

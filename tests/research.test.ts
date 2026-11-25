import { describe, it, expect } from 'vitest';
import { detectGhl } from '../lib/ghlDetect';
import { extractFacebook } from '../lib/evidence';
import { scoreLead, priorityFor } from '../lib/score';

describe('detectGhl', () => {
  it('no website -> insufficient', () => expect(detectGhl(null).status).toBe('insufficient'));
  it('unreachable site -> insufficient', () => expect(detectGhl('').status).toBe('insufficient'));
  it('fingerprints -> likely with evidence', () => {
    const r = detectGhl('<script src="https://widgets.leadconnectorhq.com/loader.js"></script><img src="https://assets.cdn.filesafe.space/x.png">');
    expect(r.status).toBe('likely');
    expect(r.evidence.join(' ')).toMatch(/leadconnectorhq/);
    expect(r.evidence.join(' ')).toMatch(/filesafe/);
  });
  it('reachable site without fingerprints -> potential', () => expect(detectGhl('<html>plain</html>')).toMatchObject({ status: 'potential', evidence: [] }));
});

describe('extractFacebook', () => {
  it('finds page, ignores sharer/plugins', () => {
    expect(extractFacebook('<a href="https://www.facebook.com/sharer/sharer.php?u=x">s</a><a href="https://facebook.com/BerryRoadDental/">fb</a>')).toBe('https://facebook.com/BerryRoadDental');
    expect(extractFacebook('<a href="https://facebook.com/plugins/page.php">x</a>')).toBeUndefined();
  });
});

describe('scoreLead: a lead nobody can reach is never A or B', () => {
  const strong = { type: 'dentist', hasWebsite: true, siteReachable: true, processes: ['contact_form'], signals: ['no_booking', 'no_chat', 'no_instagram', 'no_analytics'] };
  it('caps the score below B and the confidence at Low when there is no way to reach them', () => {
    const open = scoreLead({ ...strong, email: 'a@b.co', emailVerified: true, phone: '+61412345678', reachable: true });
    const stuck = scoreLead({ ...strong, reachable: false });
    expect(open.priority === 'A' || open.priority === 'B').toBe(true);   // the same lead, reachable, still ranks high
    expect(stuck.total).toBeLessThanOrEqual(59);
    expect(['C', 'D']).toContain(stuck.priority);
    expect(stuck.confidence).toBe('Low');
  });
  it('does nothing when reachability is unknown or true', () => {
    expect(scoreLead({ ...strong }).total).toBe(scoreLead({ ...strong, reachable: true }).total);
  });
});

describe('scoreLead: only a verified email counts', () => {
  const base = { type: 'dentist', hasWebsite: true, siteReachable: true, processes: ['contact_form'], signals: ['no_booking'] };
  it('an email that is not verified adds nothing to the score or the confidence', () => {
    const verified = scoreLead({ ...base, email: 'a@b.co', emailVerified: true });
    const unverified = scoreLead({ ...base, email: 'a@b.co', emailVerified: false });
    expect(verified.factors.contactAccessibility).toBe(6);
    expect(unverified.factors.contactAccessibility).toBe(0);
    expect(unverified.confidence).not.toBe('High');
  });
});

describe('scoreLead counts a social page as a way to reach them', () => {
  const base = { type: 'makeup artist', hasWebsite: false, siteReachable: false, processes: [] as string[], signals: ['no_website'] };
  it('adds a little contact value and Medium confidence when the only contact is a social page', () => {
    const none = scoreLead(base), social = scoreLead({ ...base, hasSocial: true });
    expect(none.confidence).toBe('Low');
    expect(social.confidence).toBe('Medium');
    expect(social.factors.contactAccessibility).toBeGreaterThan(none.factors.contactAccessibility);
    expect(social.factors.contactAccessibility).toBeLessThanOrEqual(10);
  });
  it('does not stack on top of an email', () => {
    expect(scoreLead({ ...base, email: 'a@b.co', hasSocial: true }).factors.contactAccessibility).toBe(6);
  });
});

describe('scoreLead for rental businesses', () => {
  it('treats rentals and charters as booking-driven, high-fit businesses', () => {
    for (const type of ['car rental', 'yacht rental', 'boat charter', 'short term rental', 'vacation rental', 'holiday rental', 'airbnb host', 'car hire']) {
      const f = scoreLead({ type, hasWebsite: true, siteReachable: true, processes: [], signals: [] }).factors;
      expect(f.crmRelevance, type).toBe(25);
      expect(f.workflowComplexity, type).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('scoreLead for solopreneur types', () => {
  const base = { hasWebsite: false, siteReachable: false, processes: [] as string[], signals: ['no_website'] };
  it('treats makeup artists, lash techs, tutors, trainers and similar as appointment businesses, not unknown ones', () => {
    for (const type of ['makeup artist', 'lash technician', 'hair stylist', 'wedding planner', 'tutor', 'personal trainer', 'dog groomer', 'interior designer', 'bookkeeper', 'handyman', 'seamstress', 'esthetician']) {
      const f = scoreLead({ type, ...base }).factors;
      expect(f.crmRelevance, type).toBeGreaterThanOrEqual(15);
      expect(f.workflowComplexity, type).toBeGreaterThanOrEqual(10);
    }
    expect(scoreLead({ type: 'zebra herder', ...base }).factors.crmRelevance).toBe(10);
    expect(scoreLead({ type: 'adjuster', ...base }).factors.crmRelevance).toBe(10); // "dj" must not match inside a word
  });
});

describe('scoreLead', () => {
  const strong = { type: 'dentist', hasWebsite: true, siteReachable: true, email: 'a@b.com', phone: '1', processes: ['contact_form', 'phone_link'], signals: ['no_booking', 'no_chat', 'no_analytics'] };
  it('high-fit dentist with gaps scores A/B with High confidence and sums factors', () => {
    const s = scoreLead(strong);
    expect(s.total).toBe(Object.values(s.factors).reduce((a, b) => a + b, 0));
    expect(s.total).toBeGreaterThanOrEqual(70);
    expect(s.confidence).toBe('High');
    expect(s.factors.crmRelevance).toBe(25);
  });
  it('no website, no contacts, low-value type scores low with Low confidence', () => {
    const s = scoreLead({ type: 'bakery', hasWebsite: false, siteReachable: false, processes: [], signals: ['no_website'] });
    expect(s.total).toBeLessThan(50);
    expect(s.confidence).toBe('Low');
  });
  it('factor caps respected', () => {
    const s = scoreLead({ ...strong, signals: ['no_booking', 'no_chat', 'no_analytics', 'no_instagram', 'not_mobile', 'no_https'] });
    expect(s.factors.actionableOpportunity).toBeLessThanOrEqual(15);
    expect(s.total).toBeLessThanOrEqual(100);
  });
  it('priority bands', () => {
    expect([priorityFor(80), priorityFor(79), priorityFor(60), priorityFor(59), priorityFor(40), priorityFor(39)]).toEqual(['A', 'B', 'B', 'C', 'C', 'D']);
  });
});

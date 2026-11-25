import { describe, it, expect } from 'vitest';
import { weakCriteria, selectWeak, WEAK_CRITERIA } from '../lib/weak';
import { hasRealName } from '../lib/leadName';
import type { Lead } from '../lib/db';

const lead = (id: number, o: { priority?: 'A' | 'B' | 'C' | 'D'; confidence?: 'High' | 'Medium' | 'Low'; email?: string; phone?: string; instagram?: string; facebook?: string; processes?: string[]; emailStatus?: 'ok' | 'bad' | 'risky'; abn?: string; pushedAt?: string; noResearch?: boolean; website?: string } = {}): Lead => ({
  id, name: `Biz ${id}`, signals: [], ...(o.email ? { email: o.email } : {}), ...(o.phone ? { phone: o.phone } : {}), ...(o.instagram ? { instagram: o.instagram } : {}),
  ...(o.website ? { website: o.website } : {}), ...(o.pushedAt ? { pushedAt: o.pushedAt } : {}),
  ...(o.noResearch ? {} : { research: {
    ghlStatus: 'insufficient', ghlEvidence: [], processes: o.processes ?? [], sourceUrls: [], verifiedAt: 't',
    score: { total: 50, priority: o.priority ?? 'B', confidence: o.confidence ?? 'Medium', factors: {} },
    ...(o.facebook ? { facebook: o.facebook } : {}), ...(o.emailStatus ? { emailCheck: { status: o.emailStatus, kind: 'personal', reasons: [], checkedAt: 't' } } : {}),
    ...(o.abn ? { abn: { abn: '1', status: o.abn, entityName: 'x', entityType: 'x', entityTypeCode: 'PRV', gst: false, url: 'u' } } : {}),
  } as any }),
});

describe('weakCriteria', () => {
  it('priority D', () => expect(weakCriteria(lead(1, { priority: 'D', phone: '+61412345678' }))).toEqual(['priority-d']));
  it('no way to reach: no email, phone, Instagram, Facebook, form or links', () => {
    expect(weakCriteria(lead(1))).toContain('no-way-to-reach');
    for (const reachable of [{ email: 'a@b.co' }, { phone: '+61412345678' }, { instagram: 'x' }, { facebook: 'https://facebook.com/x' }, { processes: ['contact_form'] }, { processes: ['phone_link'] }, { processes: ['email_link'] }]) {
      expect(weakCriteria(lead(1, reachable)), JSON.stringify(reachable)).not.toContain('no-way-to-reach');
    }
  });
  it('a dead email and nothing else to reach them by', () => {
    expect(weakCriteria(lead(1, { email: 'a@dead.example', emailStatus: 'bad' }))).toContain('dead-email-only');
    expect(weakCriteria(lead(1, { email: 'a@dead.example', emailStatus: 'bad', phone: '+61412345678' }))).not.toContain('dead-email-only');
    expect(weakCriteria(lead(1, { email: 'a@ok.example', emailStatus: 'ok' }))).not.toContain('dead-email-only');
  });
  it('a cancelled ABN means the business may have closed', () => {
    expect(weakCriteria(lead(1, { abn: 'Cancelled', phone: '+61412345678' }))).toEqual(['business-closed']);
    expect(weakCriteria(lead(1, { abn: 'Active', phone: '+61412345678' }))).toEqual([]);
  });
  it('low confidence and a low priority: we know little and it scores low', () => {
    expect(weakCriteria(lead(1, { confidence: 'Low', priority: 'C', phone: '+61412345678' }))).toEqual(['low-confidence']);
    expect(weakCriteria(lead(1, { confidence: 'Low', priority: 'A', phone: '+61412345678' }))).toEqual([]);
  });
  it('a lead we have not looked at yet is not weak, it is unknown', () => {
    expect(weakCriteria(lead(1, { noResearch: true }))).toEqual([]);
  });
  it('a strong lead has none', () => expect(weakCriteria(lead(1, { priority: 'A', email: 'a@b.co', phone: '+61412345678' }))).toEqual([]));
});

describe('selectWeak', () => {
  const leads = [lead(1, { priority: 'D', phone: '1234567' }), lead(2), lead(3, { priority: 'A', phone: '+61412345678' }), lead(4, { priority: 'D', pushedAt: '2026-11-01' }), lead(5, { noResearch: true })];
  it('picks leads matching any chosen criterion and counts each criterion', () => {
    const r = selectWeak(leads, ['priority-d', 'no-way-to-reach']);
    expect(r.ids).toEqual([1, 2]);
    expect(r.byCriterion['priority-d']).toBe(1);
    expect(r.byCriterion['no-way-to-reach']).toBe(1);
  });
  it('never selects a lead already pushed to GHL, and says how many it protected', () => {
    const r = selectWeak(leads, ['priority-d']);
    expect(r.ids).not.toContain(4);
    expect(r.protectedPushed).toBe(1);
  });
  it('no criteria, nothing selected', () => expect(selectWeak(leads, []).ids).toEqual([]));
  it('knows every criterion by name', () => expect(Object.keys(WEAK_CRITERIA).sort()).toEqual(['business-closed', 'dead-email-only', 'duplicate', 'junk-name', 'low-confidence', 'no-way-to-reach', 'priority-d']));
});

describe('duplicates: the same business saved by more than one search', () => {
  const w = (id: number, o: any = {}) => lead(id, { priority: 'B', phone: '+61412345678', ...o });
  it('keeps the best copy (pushed, then researched, then the lowest id) and selects the rest', () => {
    const a = w(1, { website: 'https://www.smile.example/' }), b = w(2, { website: 'http://smile.example/about' }), c = w(3, { website: 'https://smile.example' });
    expect(selectWeak([a, b, c], ['duplicate']).ids).toEqual([2, 3]);
    expect(selectWeak([a, w(2, { website: 'https://smile.example', noResearch: true })], ['duplicate']).ids).toEqual([2]);            // the researched one is kept
    expect(selectWeak([w(1, { website: 'https://smile.example', noResearch: true }), w(2, { website: 'https://smile.example', pushedAt: '2026-11-01' })], ['duplicate']).ids).toEqual([1]); // the pushed one is kept
  });
  it('matches by website, or by phone when there is no website, never by name alone', () => {
    expect(selectWeak([w(1, { phone: '+61 7 3000 1234' }), w(2, { phone: '(07) 3000 1234' })], ['duplicate']).ids).toEqual([2]);
    expect(selectWeak([{ ...w(1), name: 'Same Name' }, { ...w(2, { phone: '+61499999999' }), name: 'Same Name' }], ['duplicate']).ids).toEqual([]);
  });
  it('never treats a shared page (a Facebook page, a link-in-bio) as one business\'s website', () => {
    expect(selectWeak([w(1, { website: 'https://www.facebook.com/a', phone: '+61411111111' }), w(2, { website: 'https://www.facebook.com/b', phone: '+61422222222' })], ['duplicate']).ids).toEqual([]);
  });
  it('is only applied when asked for', () => {
    expect(selectWeak([w(1, { website: 'https://smile.example' }), w(2, { website: 'https://smile.example' })], ['priority-d']).ids).toEqual([]);
  });
  it('a pushed duplicate is protected and counted', () => {
    const r = selectWeak([w(1, { website: 'https://smile.example', pushedAt: '2026-11-01' }), w(2, { website: 'https://smile.example', pushedAt: '2026-11-02' })], ['duplicate']);
    expect(r.ids).toEqual([]);
    expect(r.protectedPushed).toBe(1);
  });
});

describe('hasRealName', () => {
  it('a business name has at least two letters in a row', () => {
    for (const ok of ['Smile Dental', 'HCF', 'A1 Movers', 'Café Zoë', 'Dr. Lee', '7-Eleven', 'Ma']) expect(hasRealName(ok), ok).toBe(true);
    for (const bad of ['10', '505', '#7', ' ', '', '1-2', 'A', '12 B', undefined as any]) expect(hasRealName(bad), String(bad)).toBe(false);
  });
});

describe('junk names (a unit number is not a business)', () => {
  it('a lead named "10" is junk even if it was never researched', () => {
    expect(weakCriteria({ ...lead(1, { noResearch: true }), name: '10' })).toEqual(['junk-name']);
    expect(weakCriteria({ ...lead(2, { priority: 'A', phone: '+61412345678' }), name: '505' })).toContain('junk-name');
    expect(weakCriteria(lead(3, { noResearch: true }))).toEqual([]);
  });
  it('a pushed junk-named lead is still protected', () => {
    expect(selectWeak([{ ...lead(1, { pushedAt: '2026-11-01' }), name: '10' }], ['junk-name'])).toMatchObject({ ids: [], protectedPushed: 1 });
  });
});

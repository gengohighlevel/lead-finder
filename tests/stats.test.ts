import { describe, it, expect } from 'vitest';
import { computeStats } from '../lib/stats';
import type { StoredLead } from '../lib/db';

const score = (total: number, priority: 'A' | 'B' | 'C' | 'D') => ({ total, priority, confidence: 'High' as const,
  factors: { crmRelevance: 0, leadGenDependency: 0, customerValue: 0, workflowComplexity: 0, contactAccessibility: 0, actionableOpportunity: 0 } });
const lead = (o: Partial<StoredLead> & { p?: 'A' | 'B' | 'C' | 'D'; total?: number; service?: string; ghl?: 'likely' | 'potential' | 'insufficient'; at?: string }): StoredLead => ({
  id: Math.random(), name: 'X', signals: [], searchKey: 'dentist|relation1', ...o,
  research: { ghlStatus: o.ghl ?? 'potential', ghlEvidence: [], processes: [], city: 'Norman', region: 'Oklahoma', score: score(o.total ?? 50, o.p ?? 'C'), sourceUrls: [], verifiedAt: o.at ?? '2026-11-22T10:00:00Z',
    outreach: o.service ? { observation: 'o', opportunity: 'p', openingQuestion: 'q?', service: o.service, discoveryQuestion: 'd?' } : undefined },
});

describe('computeStats', () => {
  it('empty database gives zeros, no NaN', () => {
    const s = computeStats([]);
    expect(s).toMatchObject({ total: 0, withPerson: 0, contactable: 0, withAngle: 0, qualified: 0, pushed: 0, avgScore: 0 });
    expect(s.priority).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(s.services).toEqual([]);
    expect(s.searches).toEqual([]);
  });
  it('counts pipeline stages', () => {
    const s = computeStats([
      lead({ p: 'A', total: 90, email: 'a@b.co', service: 'Appointment Booking System', pushedAt: '2026-11-22' }),
      lead({ p: 'B', total: 70, phone: '1', service: 'Appointment Booking System' }),
      lead({ p: 'D', total: 20, signals: ['no_website'] }),
    ]);
    expect(s).toMatchObject({ total: 3, contactable: 2, withEmail: 1, withAngle: 2, qualified: 2, pushed: 1, avgScore: 60 });
    expect(s.priority).toEqual({ A: 1, B: 1, C: 0, D: 1 });
    expect(s.services).toEqual([{ name: 'Appointment Booking System', count: 2 }]);
    expect(s.gaps).toEqual([{ key: 'no_website', label: 'No website found in our sources', count: 1 }]);
  });
  it('counts leads with a named person', () => {
    const withPeople = lead({}); withPeople.research!.people = [{ name: 'Sarah Lee', source: 'https://x', confidence: 'High' }];
    const checkedNone = lead({}); checkedNone.research!.people = [];
    expect(computeStats([withPeople, checkedNone, lead({})]).withPerson).toBe(1);
  });
  it('counts GHL status', () => {
    const s = computeStats([lead({ ghl: 'likely' }), lead({ ghl: 'potential' }), lead({ ghl: 'potential' })]);
    expect(s.ghl).toEqual({ likely: 1, potential: 2, insufficient: 0 });
  });
  it('groups searches, newest first, with type and place', () => {
    const s = computeStats([
      lead({ searchKey: 'dentist|relation1', p: 'A', at: '2026-11-20T10:00:00Z' }),
      lead({ searchKey: 'dentist|relation1', p: 'C', at: '2026-11-20T10:00:00Z', pushedAt: 'x' }),
      lead({ searchKey: 'moving company|relation2', p: 'B', at: '2026-11-22T10:00:00Z' }),
    ]);
    expect(s.searches.map(x => x.key)).toEqual(['moving company|relation2', 'dentist|relation1']);
    expect(s.searches[1]).toMatchObject({ type: 'dentist', place: 'Norman, Oklahoma', count: 2, qualified: 1, pushed: 1 });
  });
  it('services sorted by count, most common first', () => {
    const s = computeStats([lead({ service: 'B' }), lead({ service: 'A' }), lead({ service: 'A' })]);
    expect(s.services.map(x => x.name)).toEqual(['A', 'B']);
  });
});

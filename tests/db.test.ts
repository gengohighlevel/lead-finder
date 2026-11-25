import { describe, it, expect } from 'vitest';
import { saveLeads, getLeads, updateOpener, markPushed, listSuppressions, addSuppressions, removeSuppression } from '../lib/db';

const base = { name: 'A Dental', signals: ['no_booking'] };

describe('db', () => {
  it('saves and reads leads by searchKey', () => {
    const saved = saveLeads('dentist|austin', [base, { name: 'B', signals: [] }]);
    expect(saved).toHaveLength(2);
    const got = getLeads('dentist|austin');
    expect(got.map(l => l.name)).toEqual(['A Dental', 'B']);
    expect(got[0].signals).toEqual(['no_booking']);
    expect(getLeads('other')).toEqual([]);
  });
  it('updateOpener persists', () => {
    const [l] = saveLeads('k2', [base]);
    updateOpener(l.id, 'hello');
    expect(getLeads('k2')[0].opener).toBe('hello');
  });
  it('markPushed sets pushedAt', () => {
    const [l] = saveLeads('k3', [base]);
    markPushed(l.id);
    expect(getLeads('k3')[0].pushedAt).toBeTruthy();
  });
});

describe('db dedupe', () => {
  it('re-search does not duplicate already-pushed leads', () => {
    const [l] = saveLeads('dd', [{ name: 'Same Co', address: '1 Main', signals: [] }, { name: 'Other', signals: [] }]);
    markPushed(l.id);
    const again = saveLeads('dd', [{ name: 'same co', address: '1 Main', signals: [] }, { name: 'Other', signals: [] }]);
    expect(again.map(x => x.name).sort()).toEqual(['Other', 'Same Co']);
    expect(again.find(x => x.name === 'Same Co')?.pushedAt).toBeTruthy();
  });
});

describe('db research', () => {
  it('round-trips research JSON and updateResearch', async () => {
    const { updateResearch } = await import('../lib/db');
    const r: any = { ghlStatus: 'likely', ghlEvidence: ['x'], processes: [], score: { total: 50 }, sourceUrls: [], verifiedAt: 't' };
    const [l] = saveLeads('rr', [{ name: 'R', signals: [], research: r }]);
    expect(getLeads('rr')[0].research).toEqual(r);
    updateResearch(l.id, { ...r, ghlStatus: 'potential' });
    expect(getLeads('rr')[0].research?.ghlStatus).toBe('potential');
  });
});

describe('suppressions (do-not-contact)', () => {
  it('adds entries, never twice, and lists them newest first', () => {
    const r1 = addSuppressions([{ kind: 'email', value: 'a@x.example' }, { kind: 'domain', value: 'y.example' }], 'asked to stop');
    expect(r1).toEqual({ added: 2, existing: 0 });
    expect(addSuppressions([{ kind: 'email', value: 'a@x.example' }, { kind: 'phone', value: '61412345678' }])).toEqual({ added: 1, existing: 1 });
    const list = listSuppressions();
    expect(list.map(s => `${s.kind}:${s.value}`)).toEqual(expect.arrayContaining(['email:a@x.example', 'domain:y.example', 'phone:61412345678']));
    expect(list.find(s => s.value === 'y.example')).toMatchObject({ reason: 'asked to stop' });
    expect(list.find(s => s.value === 'y.example')!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(list.filter(s => s.value === 'a@x.example')).toHaveLength(1);
  });
  it('removes one by id, and says whether it existed', () => {
    addSuppressions([{ kind: 'email', value: 'gone@x.example' }]);
    const id = listSuppressions().find(s => s.value === 'gone@x.example')!.id;
    expect(removeSuppression(id)).toBe(true);
    expect(removeSuppression(id)).toBe(false);
    expect(listSuppressions().some(s => s.value === 'gone@x.example')).toBe(false);
  });
});

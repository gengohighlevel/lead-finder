import { describe, it, expect, beforeEach } from 'vitest';
import { identityKeys } from '../lib/leadKeys';
import { saveLeadsReport, resetLeadsForTests, allowRepeatsForTests, getAllLeads, markPushed } from '../lib/db';
import { selectWeak } from '../lib/weak';

beforeEach(() => { resetLeadsForTests(); allowRepeatsForTests(false); });
const L = (name: string, o: Record<string, string> = {}) => ({ name, signals: [] as string[], ...o });

describe('identityKeys: when two leads are the same business', () => {
  it('same website host, ignoring www, scheme and path', () => {
    expect(identityKeys(L('A', { website: 'https://www.smile.example/contact' }))).toEqual(identityKeys(L('B', { website: 'http://smile.example' })));
  });
  it('a social page or free-mail domain is not a business website', () => {
    expect(identityKeys(L('A', { website: 'https://facebook.com/a' })).filter(k => k.startsWith('site:'))).toEqual([]);
    expect(identityKeys(L('A', { website: 'https://gmail.com' })).filter(k => k.startsWith('site:'))).toEqual([]);
  });
  it('phone counts only when there is no website', () => {
    expect(identityKeys(L('A', { phone: '+61 7 3000 1234' }))).toEqual(['phone:730001234']);
    expect(identityKeys(L('A', { phone: '+61 7 3000 1234', website: 'https://a.example' })).some(k => k.startsWith('phone:'))).toBe(false);
  });
  it('the same name needs the same street address; a name alone never matches', () => {
    expect(identityKeys(L('Castle Dental', { address: '1 Oak St, Austin' }))).toEqual(identityKeys(L('castle dental', { address: '1 Oak St Austin' })));
    expect(identityKeys(L('Castle Dental'))).toEqual([]);
    expect(identityKeys(L('Castle Dental', { address: '1 Oak St' }))).not.toEqual(identityKeys(L('Castle Dental', { address: '9 Elm St' })));
  });
});

describe('saving a search never repeats a business another search already saved', () => {
  it('skips the same website, and says why', () => {
    saveLeadsReport('dentist|austin', [L('Smile Dental', { website: 'https://smile.example' }), L('Other', { website: 'https://other.example' })]);
    const r = saveLeadsReport('dentist|texas', [L('Smile Dental Austin', { website: 'https://www.smile.example/home' }), L('New One', { website: 'https://new.example' })]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].why).toMatch(/same website/);
    expect(r.leads.map(l => l.name)).toEqual(['New One']);
    expect(getAllLeads()).toHaveLength(3);
  });
  it('skips the same phone when there is no website, and the same name + address', () => {
    saveLeadsReport('a|1', [L('Phone Only', { phone: '+61 400 111 222' }), L('Castle Dental', { address: '1 Oak St, Austin' })]);
    const r = saveLeadsReport('a|2', [L('Phone Only Pty', { phone: '0400 111 222' }), L('Castle Dental', { address: '1 Oak St Austin' }), L('Castle Dental', { address: '9 Elm St, Austin' })]);
    expect(r.skipped.map(s => s.why.replace(/.*\(|\)/g, '')).sort()).toEqual(['same name and address', 'same phone']);
    expect(r.leads.map(l => l.address)).toEqual(['9 Elm St, Austin']);   // a different branch is kept
  });
  it('two new leads that are the same business: only the first is saved', () => {
    const r = saveLeadsReport('a|1', [L('X', { website: 'https://x.example' }), L('X again', { website: 'https://x.example' })]);
    expect(r.leads).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
  });
  it('searching the same place again replaces its own unpushed leads and is not counted as a repeat', () => {
    saveLeadsReport('a|1', [L('Smile', { website: 'https://smile.example' })]);
    const r = saveLeadsReport('a|1', [L('Smile', { website: 'https://smile.example' })]);
    expect(r.skipped).toEqual([]);
    expect(r.leads).toHaveLength(1);
  });
  it('a pushed lead from the same search is kept, not duplicated', () => {
    const first = saveLeadsReport('a|1', [L('Pushed Co', { website: 'https://p.example', address: '1 Main St' })]).leads[0];
    markPushed(first.id);
    const r = saveLeadsReport('a|1', [L('Pushed Co', { website: 'https://p.example', address: '1 Main St' })]);
    expect(r.leads).toHaveLength(1);
  });
});

describe('clean-up "Duplicates"', () => {
  const lead = (id: number, name: string, o: Record<string, unknown> = {}) => ({ id, name, signals: [], ...o }) as any;
  it('also finds the same name at the same address, keeping the best copy', () => {
    const r = selectWeak([lead(1, 'Castle Dental', { address: '1 Oak St' }), lead(2, 'Castle Dental', { address: '1 Oak St.' }), lead(3, 'Castle Dental', { address: '9 Elm St' })], ['duplicate']);
    expect(r.ids).toEqual([2]);
  });
});

import { describe, it, expect } from 'vitest';
import { FIELDS, toRecord, toCsv } from '../lib/export';
import type { Lead } from '../lib/db';

const research = (extra: any = {}): any => ({
  ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: 't', country: 'ng', facebook: 'https://www.facebook.com/glowmua',
  score: { total: 55, priority: 'C', confidence: 'Medium', factors: {} },
  outreach: { observation: 'o', opportunity: 'p', openingQuestion: 'Who sees a new message first?', service: 'S', discoveryQuestion: 'dq?' }, ...extra,
});
const solo = (extra: Partial<Lead> = {}): Lead => ({ id: 1, name: 'Glow Makeup Artist', phone: '+2348012345678', instagram: 'glowmua', signals: ['no_website'], research: research(), ...extra });

describe('export: ways to reach, DM draft and ABN', () => {
  it('adds the new columns at the END, so existing columns keep their place', () => {
    const tail = FIELDS.slice(-10);
    expect(tail).toEqual(['verified_at', 'best_channel', 'reach_channels', 'dm_draft', 'abn', 'abn_status', 'counter_pitch_status', 'counter_pitch_subject', 'counter_pitch_confidence', 'counter_pitch_missing']);
    expect(FIELDS.indexOf('source_urls')).toBe(FIELDS.indexOf('verified_at') - 1);
  });
  it('gives the best channel, every channel with its link, and the DM draft', () => {
    const r = toRecord(solo(), 'makeup artist');
    expect(r.best_channel).toBe('Instagram');
    expect(r.reach_channels).toBe('Instagram https://www.instagram.com/glowmua/ | Facebook https://www.facebook.com/glowmua | WhatsApp https://wa.me/2348012345678 | Phone tel:+2348012345678');
    expect(r.dm_draft).toBe('Hi, I came across Glow Makeup Artist on Instagram. Who sees a new message first?');
  });
  it('has no DM draft when email is the best way in, and nothing for a lead with no contact', () => {
    const r = toRecord(solo({ website: 'https://glow.example', email: 'hi@glow.example', instagram: undefined, phone: undefined, research: research({ facebook: undefined }) }), 'makeup artist');
    expect(r.best_channel).toBe('Email');
    expect(r.dm_draft).toBeNull();
    const none = toRecord(solo({ instagram: undefined, phone: undefined, research: research({ facebook: undefined }) }), 'makeup artist');
    expect(none.best_channel).toBeNull();
    expect(none.reach_channels).toBeNull();
  });
  it('records the ABN and its status, or nothing', () => {
    const abn = { abn: '51824753556', status: 'Active', entityName: 'DOE, Jane', entityType: 'Individual/Sole Trader', entityTypeCode: 'IND', gst: true, url: 'u' };
    const r = toRecord(solo({ research: research({ abn }) }), 'makeup artist');
    expect(r.abn).toBe('51 824 753 556');
    expect(r.abn_status).toBe('Active');
    expect(toRecord(solo(), 'x').abn).toBeNull();
    expect(toRecord(solo(), 'x').abn_status).toBeNull();
  });
});

describe('toCsv: spreadsheet formulas', () => {
  const csvRow = (l: Lead) => toCsv([toRecord(l, 'x')]).split('\n')[1];
  it('does not let a business name that starts with = + - @ run as a formula in Excel or Sheets', () => {
    for (const evil of ['=HYPERLINK("http://evil.example","x")', '@SUM(A1)', '-2+3', '+cmd|calc']) {
      const row = csvRow(solo({ name: evil }));
      expect(row.startsWith(`"'${evil.replace(/"/g, '""')}"`) || row.startsWith(`'${evil}`), evil).toBe(true);
    }
  });
  it('leaves phone numbers and normal text alone', () => {
    const row = csvRow(solo({ name: 'Glow, Makeup' }));
    expect(row.startsWith('"Glow, Makeup",')).toBe(true);
    expect(row).toContain('+2348012345678');
    expect(row).not.toContain("'+2348012345678");
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { PLAYBOOK, pickPlay, hasTechWords } from '../lib/playbook';
import { generateOutreach, templateOutreach } from '../lib/opener';

beforeEach(() => vi.restoreAllMocks());
const base = { name: 'Smile Dental', type: 'dentist', observed: ['Website contact form'], gaps: ['no_booking'], ghlStatus: 'potential' as const, offer: 'Booking system' };

describe('playbook data', () => {
  it('has the 10 services, each named exactly as in OFFER.example.md', () => {
    const offer = fs.readFileSync('OFFER.example.md', 'utf8');
    const plays = Object.values(PLAYBOOK);
    expect(plays).toHaveLength(10);
    for (const p of plays) expect(offer).toContain(p.service);
  });
  it('questions are real questions with no tech words (playbook rule)', () => {
    for (const p of Object.values(PLAYBOOK)) {
      expect(p.question.endsWith('?')).toBe(true);
      expect(p.hook.endsWith('?')).toBe(true);
      expect(hasTechWords(p.question)).toBe(false);
      expect(hasTechWords(p.hook)).toBe(false);
    }
  });
});

describe('hasTechWords', () => {
  it('flags CRM / automation / AI / pipeline, not normal words', () => {
    expect(hasTechWords('Do you use a CRM?')).toBe(true);
    expect(hasTechWords('Have you thought about automation?')).toBe(true);
    expect(hasTechWords('Would an AI help?')).toBe(true);
    expect(hasTechWords('How is your sales pipeline?')).toBe(true);
    expect(hasTechWords('Who replies to a Saturday message, and when?')).toBe(false);
    expect(hasTechWords('Do you get paid on time?')).toBe(false);
  });
});

describe('pickPlay', () => {
  it('maps observed gaps to the right service', () => {
    expect(pickPlay(['no_booking'], 'dentist').id).toBe('booking');
    expect(pickPlay(['no_chat'], 'dentist').id).toBe('qualification');
    expect(pickPlay(['no_analytics'], 'plumber').id).toBe('pipeline');
    expect(pickPlay(['no_instagram'], 'salon').id).toBe('reactivation');
    expect(pickPlay(['no_website'], 'plumber').id).toBe('lead_management');
  });
  it('uses the first gap in priority order', () => {
    expect(pickPlay(['no_instagram', 'no_booking'], 'salon').id).toBe('booking');
  });
  it('with no usable gap, routes by business type (playbook top 5)', () => {
    expect(pickPlay([], 'plumber').id).toBe('followups');
    expect(pickPlay([], 'moving company').id).toBe('followups');
    expect(pickPlay([], 'dentist').id).toBe('booking');
    expect(pickPlay([], 'gym').id).toBe('reactivation');
    expect(pickPlay([], 'real estate').id).toBe('lead_management');
  });
  it('unknown type and no gap falls back to follow-ups', () => expect(pickPlay([], 'zeppelin repair').id).toBe('followups'));
  it('web-only gaps (https, mobile) have no playbook play', () => {
    expect(pickPlay(['not_mobile'], 'plumber').id).toBe('followups');
  });
});

describe('templateOutreach uses the playbook', () => {
  it('booking gap -> playbook booking question and service', () => {
    const o = templateOutreach('Smile Dental', ['no_booking'], 'potential', 'dentist');
    expect(o.service).toBe(PLAYBOOK.booking.service);
    expect(o.openingQuestion).toBe(PLAYBOOK.booking.question);
    expect(o.discoveryQuestion).toBe(PLAYBOOK.booking.hook);
  });
  it('no gaps -> type-based play', () => {
    const o = templateOutreach('Roof Co', [], 'insufficient', 'roofer');
    expect(o.service).toBe(PLAYBOOK.followups.service);
    expect(o.openingQuestion).toBe(PLAYBOOK.followups.question);
  });
  it('type is optional (old callers keep working)', () => {
    expect(templateOutreach('X', ['no_website'], 'insufficient').service.toLowerCase()).toContain('web');
  });
  it('no template question leaks tech words', () => {
    for (const g of ['no_website', 'no_booking', 'no_chat', 'no_analytics', 'no_instagram', 'not_mobile', 'no_https']) {
      const o = templateOutreach('X', [g], 'potential', 'dentist');
      expect(hasTechWords(o.openingQuestion)).toBe(false);
      expect(hasTechWords(o.discoveryQuestion)).toBe(false);
    }
  });
  it('existing GHL user keeps optimisation angle', () => {
    expect(templateOutreach('X', ['no_booking'], 'likely', 'dentist').service.toLowerCase()).toMatch(/ghl/);
  });
});

describe('generateOutreach uses the playbook', () => {
  const llm = (o: object) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: JSON.stringify(o) }) })));
  const good = { observation: 'No online booking found.', opportunity: 'Booking', opening_question: 'How do patients book today?', service: 'Something else', discovery_question: 'How many go unanswered?' };

  it('prompt carries the playbook rules and the chosen play', async () => {
    llm(good);
    await generateOutreach(base);
    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.prompt).toContain(PLAYBOOK.booking.service);
    expect(body.prompt).toContain(PLAYBOOK.booking.hook);
    expect(body.prompt).toMatch(/owner-to-owner/i);
    expect(body.prompt).toMatch(/never use the words/i);
  });
  it('service comes from the playbook, not the model', async () => {
    llm(good);
    expect((await generateOutreach(base)).service).toBe(PLAYBOOK.booking.service);
  });
  it('swaps in the playbook question when the model leaks tech words', async () => {
    llm({ ...good, opening_question: 'Have you considered a CRM automation?' });
    const r = await generateOutreach(base);
    expect(r.usedFallback).toBe(false);
    expect(r.openingQuestion).toBe(PLAYBOOK.booking.question);
  });
  it('swaps in the playbook question when the model question is too long', async () => {
    llm({ ...good, opening_question: `${'word '.repeat(40)}today?` });
    expect((await generateOutreach(base)).openingQuestion).toBe(PLAYBOOK.booking.question);
  });
  it('GHL user keeps the optimisation service', async () => {
    llm(good);
    const r = await generateOutreach({ ...base, ghlStatus: 'likely' });
    expect(r.service.toLowerCase()).toMatch(/ghl/);
  });
});

describe('solopreneur plays and observations', () => {
  it('picks a sensible service for one-person businesses when no gap decides it', () => {
    for (const t of ['makeup artist', 'lash technician', 'hair stylist', 'tutor', 'personal trainer', 'dog groomer', 'doula']) expect(pickPlay([], t).id, t).toBe('booking');
    for (const t of ['graphic designer', 'bookkeeper', 'life coach', 'videographer']) expect(pickPlay([], t).id, t).toBe('lead_management');
    for (const t of ['wedding planner', 'handyman', 'house cleaner', 'seamstress']) expect(pickPlay([], t).id, t).toBe('followups');
  });
  it('says what was found when a business has no website but is on social media', () => {
    const o = templateOutreach('Glow Makeup Artist', ['no_website'], 'insufficient', 'makeup artist', 'Instagram');
    expect(o.observation).toBe("I found Glow Makeup Artist on Instagram but couldn't find a website.");
    expect(templateOutreach('Glow', ['no_website'], 'insufficient', 'makeup artist').observation).toBe("I couldn't find a website for Glow.");
    // a social page changes nothing for a business that has a website
    expect(templateOutreach('Glow', ['no_booking'], 'insufficient', 'x', 'Instagram').observation).not.toContain('Instagram');
  });
  it('tells the model about the social page, and falls back to the same wording when Ollama is down', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('down'); });
    vi.stubGlobal('fetch', fetchMock);
    const r = await generateOutreach({ name: 'Glow', type: 'makeup artist', observed: [], gaps: ['no_website'], ghlStatus: 'insufficient', offer: 'x', social: 'Instagram and Facebook' });
    expect(r.usedFallback).toBe(true);
    expect(r.observation).toBe("I found Glow on Instagram and Facebook but couldn't find a website.");
  });
});

describe('outreach language', () => {
  it('always asks the model for English, whatever country the business is in', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ response: '{}' }) }));
    vi.stubGlobal('fetch', f);
    await generateOutreach({ ...base, name: 'Zahnarztpraxis Müller', type: 'Zahnarzt' });
    const prompt = JSON.parse((f.mock.calls[0] as any)[1].body).prompt as string;
    expect(prompt).toMatch(/write (?:everything )?in english/i);
  });
});

describe('booking by enquiry form', () => {
  it('points at the booking service and describes what was seen, not an absence', () => {
    expect(pickPlay(['booking_by_form'], 'dentist').id).toBe('booking');
    const o = templateOutreach('Smile Dental', ['booking_by_form'], 'potential', 'dentist');
    expect(o.observation).toBe("Smile Dental's website takes enquiries through a form, but I couldn't find a way to book a time directly.");
  });
});

describe('rental businesses', () => {
  it('lead with the booking service, and are not treated as quote-led', async () => {
    const { isQuoteLed } = await import('../lib/playbook');
    for (const t of ['car rental', 'yacht rental', 'short term rental', 'vacation rental', 'boat charter', 'airbnb host']) { expect(pickPlay([], t).id, t).toBe('booking'); expect(isQuoteLed(t), t).toBe(false); }
  });
});

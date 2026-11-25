import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateOpener, generateOutreach, templateOpener } from '../lib/opener';

beforeEach(() => vi.restoreAllMocks());
const input = { name: 'Smile Dental', type: 'dentist', signals: ['no_booking'], offer: 'Appointment Booking System' };

describe('generateOpener', () => {
  it('returns trimmed ollama text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: '  Hi Smile Dental, no online booking.  ' }) })));
    expect(await generateOpener(input)).toEqual({ text: 'Hi Smile Dental, no online booking.', usedFallback: false });
  });
  it('falls back to template when ollama is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await generateOpener(input);
    expect(r.usedFallback).toBe(true);
    expect(r.text).toContain('Smile Dental');
  });
  it('falls back on empty response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: '  ' }) })));
    expect((await generateOpener(input)).usedFallback).toBe(true);
  });
});

describe('ollama request speed settings', () => {
  const sent = async (run: () => Promise<unknown>) => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ response: '{"opening_question":"Do you take bookings online?","discovery_question":"How do people book today?"}' }) }));
    vi.stubGlobal('fetch', f); await run();
    return JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
  };
  it('turns thinking off and keeps the model loaded (qwen3 thinks for a minute otherwise)', async () => {
    for (const body of [
      await sent(() => generateOpener(input)),
      await sent(() => generateOutreach({ name: 'Smile Dental', type: 'dentist', observed: [], gaps: ['no_booking'], ghlStatus: 'potential', offer: 'x' })),
    ]) { expect(body.think).toBe(false); expect(body.keep_alive).toBe('30m'); }
  });
});

describe('generateOutreach quality gate', () => {
  const lead = { name: 'Smile Dental', type: 'dentist', observed: [], gaps: ['no_booking'], ghlStatus: 'potential' as const, offer: 'x' };
  const model = (o: object) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: JSON.stringify(o) }) })));
  it('keeps good model questions', async () => {
    model({ opening_question: 'Do you currently offer online booking for new patients?', discovery_question: 'What steps do patients take to schedule an appointment?' });
    const r = await generateOutreach(lead);
    expect(r.openingQuestion).toBe('Do you currently offer online booking for new patients?');
    expect(r.discoveryQuestion).toBe('What steps do patients take to schedule an appointment?');
    expect(r.usedFallback).toBe(false);
  });
  it('replaces only the bad question: a fact in place of a question gets the playbook question, the good one stays', async () => {
    model({ opening_question: "I couldn't find an online booking tool on Smile Dental's website.", discovery_question: 'What steps do patients take to schedule an appointment?' });
    const r = await generateOutreach(lead);
    expect(r.openingQuestion).toBe('When someone wants to book after hours, what happens right now?');
    expect(r.discoveryQuestion).toBe('What steps do patients take to schedule an appointment?');
  });
  it('replaces an off-topic question and uses the playbook one', async () => {
    model({ opening_question: 'Are you currently looking for a new dentist?', discovery_question: 'What types of dental services are you most interested in?' });
    const r = await generateOutreach(lead);
    expect(r.openingQuestion).toBe('When someone wants to book after hours, what happens right now?');
    expect(r.discoveryQuestion).toBe('How many of your bookings still start with a phone call and end with a voicemail?');
    expect(r.usedFallback).toBe(true);
    expect(r.aiDown).toBe(false);   // Ollama answered: the banner "Ollama isn't running" must NOT show
  });
  it('says the AI is down only when Ollama could not be reached or gave no usable answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect((await generateOutreach(lead)).aiDown).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })));
    expect((await generateOutreach(lead)).aiDown).toBe(true);
    model({ opening_question: 'Let us talk.', discovery_question: 'Hmm.' });   // answered, but no question at all
    expect((await generateOutreach(lead)).aiDown).toBe(false);
  });
});

describe('templateOpener', () => {
  it('maps no_booking to booking system', () => {
    const t = templateOpener('Smile Dental', ['no_booking']);
    expect(t).toContain('Smile Dental');
    expect(t.toLowerCase()).toContain('booking');
  });
  it('maps no_website to web development', () => expect(templateOpener('X', ['no_website']).toLowerCase()).toContain('website'));
  it('no signals gives generic line', () => expect(templateOpener('X', [])).toContain('X'));
});

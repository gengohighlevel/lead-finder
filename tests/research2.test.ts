import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateOutreach, templateOutreach } from '../lib/opener';
import { dedupeLeads, opportunitiesFor } from '../lib/research';
import { toRecord, toCsv } from '../lib/export';
import { buildNote } from '../lib/ghl';
import type { Lead } from '../lib/db';

beforeEach(() => vi.restoreAllMocks());
const base = { name: 'Smile Dental', type: 'dentist', observed: ['Website contact form'], gaps: ['no_booking'], ghlStatus: 'potential' as const, offer: 'Booking system' };

describe('generateOutreach', () => {
  it('parses ollama JSON', async () => {
    const out = { observation: 'Your site has a contact form but no online booking.', opportunity: 'Online booking with reminders', opening_question: 'How do patients book today?', service: 'Appointment Booking System', discovery_question: 'How many inquiries go unanswered after hours?' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: JSON.stringify(out) }) })));
    const r = await generateOutreach(base);
    // the factual line is always the checked, scoped one; the model only supplies the questions
    expect(r).toMatchObject({ observation: "I couldn't find an online booking tool on Smile Dental's website.", openingQuestion: out.opening_question, discoveryQuestion: out.discovery_question, usedFallback: false });
  });
  it('falls back when JSON is missing fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: '{"observation":"x"}' }) })));
    expect((await generateOutreach(base)).usedFallback).toBe(true);
  });
  it('falls back when ollama down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const r = await generateOutreach(base);
    expect(r.usedFallback).toBe(true);
    expect(r.service.toLowerCase()).toContain('booking');
  });
});

describe('templateOutreach', () => {
  it('existing GHL user gets optimisation angle', () => expect(templateOutreach('X', [], 'likely').service.toLowerCase()).toMatch(/ghl|optimi/));
  it('no website -> web development', () => expect(templateOutreach('X', ['no_website'], 'insufficient').service.toLowerCase()).toContain('web'));
});

describe('opportunitiesFor', () => {
  it('maps gaps to opportunities, none invented', () => {
    expect(opportunitiesFor(['no_booking', 'no_chat'])).toEqual(expect.arrayContaining([expect.stringMatching(/booking/i), expect.stringMatching(/AI|chat/i)]));
    expect(opportunitiesFor([])).toEqual([]);
  });
});

describe('dedupeLeads', () => {
  it('dedupes by domain and by normalized name', () => {
    const r = dedupeLeads([
      { name: 'Smile Dental', website: 'https://www.smile.com/', signals: [] },
      { name: 'Smile Dental Clinic', website: 'http://smile.com/contact', signals: [] },
      { name: 'Joe’s Plumbing!', signals: [] },
      { name: 'joes plumbing', signals: [] },
      { name: 'Other', signals: [] },
    ]);
    expect(r.map(l => l.name)).toEqual(['Smile Dental', 'Joe’s Plumbing!', 'Other']);
  });
});

describe('export', () => {
  const lead: Lead = { id: 1, name: 'Smile, "Dental"', email: 'a@b.com', phone: '1', website: 'https://smile.com', instagram: 'smile', signals: ['no_booking'], opener: 'hi',
    research: { ghlStatus: 'potential', ghlEvidence: [], processes: ['contact_form'], facebook: 'https://facebook.com/smile', country: 'us', region: 'Oklahoma', city: 'Norman',
      score: { total: 82, priority: 'A', confidence: 'High', factors: { crmRelevance: 25, leadGenDependency: 20, customerValue: 15, workflowComplexity: 15, contactAccessibility: 6, actionableOpportunity: 4 } },
      sourceUrls: ['https://smile.com', 'https://www.openstreetmap.org/node/1'], verifiedAt: '2026-11-22T00:00:00Z',
      outreach: { observation: 'o', opportunity: 'p', openingQuestion: 'q?', service: 'Appointment Booking System', discoveryQuestion: 'd?' } } };
  it('maps to master-prompt schema, unknowns null', () => {
    const r = toRecord(lead, 'dentist');
    expect(r).toMatchObject({ company_name: 'Smile, "Dental"', business_type: 'dentist', country: 'us', city: 'Norman', instagram_url: 'https://instagram.com/smile', facebook_url: 'https://facebook.com/smile',
      decision_maker_name: null, linkedin_company_url: null, business_email: 'a@b.com', ghl_status: 'potential', qualification_score: 82, qualification_priority: 'A', evidence_confidence: 'High',
      recommended_service: 'Appointment Booking System', discovery_question: 'd?', verified_at: '2026-11-22T00:00:00Z' });
    expect(r.observed_business_processes).toEqual(['Website contact form']);
  });
  it('fills the decision-maker fields from the first person found, and never invents an email or LinkedIn', () => {
    const withPeople: Lead = { ...lead, research: { ...lead.research!, people: [{ name: 'Sarah Lee', title: 'Owner', source: 'https://smile.com/about', confidence: 'High' }] } };
    expect(toRecord(withPeople, 'dentist')).toMatchObject({ decision_maker_name: 'Sarah Lee', decision_maker_title: 'Owner', decision_maker_linkedin: null });
    expect(toRecord(lead, 'dentist')).toMatchObject({ decision_maker_name: null, decision_maker_title: null });
  });
  it('exports the email check next to the email', () => {
    const checked: Lead = { ...lead, research: { ...lead.research!, emailCheck: { status: 'ok', kind: 'role', reasons: [], checkedAt: 'x' } } };
    expect(toRecord(checked, 'dentist').email_check).toBe('ok · role');
    expect(toRecord(lead, 'dentist').email_check).toBeNull();
    expect(toCsv([toRecord(checked, 'dentist')]).split('\n')[0].split(',')).toContain('email_check');
  });
  it('exports the phone in international format when it can be placed', () => {
    const au: Lead = { ...lead, phone: '0412 345 678', research: { ...lead.research!, country: 'au' } };
    expect(toRecord(au, 'dentist').business_phone).toBe('+61412345678');
    expect(toRecord({ ...lead, phone: 'ask for Sam' }, 'dentist').business_phone).toBe('ask for Sam');
  });
  it('only an owner, founder, director or similar becomes the decision maker; everyone found is still listed', () => {
    const src = 'https://npiregistry.cms.hhs.gov/provider-view/1';
    const admin: Lead = { ...lead, research: { ...lead.research!, people: [{ name: 'Rachel Nittinger', title: 'Manager, Credentialing', source: src, confidence: 'High' }, { name: 'Dr. Jieun Jun', source: src, confidence: 'Medium' }] } };
    expect(toRecord(admin, 'dentist')).toMatchObject({ decision_maker_name: null, decision_maker_title: null, people_found: 'Rachel Nittinger (Manager, Credentialing) | Dr. Jieun Jun' });
    const mixed: Lead = { ...lead, research: { ...lead.research!, people: [{ name: 'Rachel Nittinger', title: 'Manager, Credentialing', source: src, confidence: 'High' }, { name: 'Dr. Dip Desai', title: 'Owner', source: src, confidence: 'High' }] } };
    expect(toRecord(mixed, 'dentist')).toMatchObject({ decision_maker_name: 'Dr. Dip Desai', decision_maker_title: 'Owner' });
    expect(toRecord(lead, 'dentist').people_found).toBeNull();
  });
  it('GHL note lists the people with their source and a check-before-use reminder', () => {
    const withPeople: Lead = { ...lead, research: { ...lead.research!, people: [{ name: 'Sarah Lee', title: 'Owner', source: 'https://smile.com/about', confidence: 'High' }, { name: 'Tom Brown', source: 'https://smile.com/about', confidence: 'Medium' }] } };
    const note = buildNote(withPeople);
    expect(note).toContain('People on their website: Sarah Lee (Owner); Tom Brown');
    expect(note).toContain('https://smile.com/about');
    expect(note).toMatch(/check before using/);
    expect(buildNote(lead)).not.toContain('People on their website');
  });
  it('csv escapes quotes and commas, arrays joined', () => {
    const csv = toCsv([toRecord(lead, 'dentist')]);
    const [header, row] = csv.split('\n');
    expect(header.split(',')[0]).toBe('company_name');
    expect(row.startsWith('"Smile, ""Dental"""')).toBe(true);
    expect(row).toContain('https://smile.com | https://www.openstreetmap.org/node/1');
  });
});

describe('generateOutreach: the model never states facts', () => {
  const llm = (o: object) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: JSON.stringify(o) }) })));
  it('an overclaiming observation from the model is ignored', async () => {
    llm({ observation: 'Smile Dental does not have an online booking system and has no website.', opening_question: 'How do patients book today?', discovery_question: 'How many calls go unanswered?' });
    const r = await generateOutreach(base);
    expect(r.usedFallback).toBe(false);
    expect(r.observation).toBe("I couldn't find an online booking tool on Smile Dental's website.");
    expect(r.observation).not.toMatch(/does not have|no website/i);
  });
  it('works when the model returns only the two questions, and does not ask it for an observation', async () => {
    llm({ opening_question: 'How do patients book today?', discovery_question: 'How many calls go unanswered?' });
    const r = await generateOutreach(base);
    expect(r).toMatchObject({ usedFallback: false, openingQuestion: 'How do patients book today?', discoveryQuestion: 'How many calls go unanswered?' });
    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.prompt).not.toMatch(/"observation":/);
    expect(body.prompt).toContain("I couldn't find an online booking tool on Smile Dental's website.");   // the fact it should build on
  });
});

describe('generateOutreach clean-up', () => {
  it('keeps one factual sentence and one question, strips speculation', async () => {
    const messy = { observation: "KC Dental's website does not have an online booking system, which could be a missed opportunity for efficient patient management. Another sentence.",
      opportunity: 'Booking', opening_question: 'I came across KC Dental while researching. We noticed no booking. Can you tell me a bit about your current appointment scheduling process?',
      service: 'Appointment Booking System', discovery_question: 'How many calls do you miss? Also other stuff.' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: JSON.stringify(messy) }) })));
    const r = await generateOutreach(base);
    expect(r.usedFallback).toBe(false);
    expect(r.observation).toBe("I couldn't find an online booking tool on Smile Dental's website.");   // never the model's wording
    expect(r.openingQuestion).toBe('Can you tell me a bit about your current appointment scheduling process?');
    expect(r.discoveryQuestion).toBe('How many calls do you miss?');
  });
  it('falls back when the question field has no question', async () => {
    const bad = { observation: 'Fact.', opportunity: 'x', opening_question: 'Let us talk.', service: 'S', discovery_question: 'Q?' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ response: JSON.stringify(bad) }) })));
    expect((await generateOutreach(base)).usedFallback).toBe(true);
  });
});

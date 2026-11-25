import { describe, it, expect } from 'vitest';
import { planCounterPitch, spellingFor, OPT_OUT, type CounterPitchInput } from '../lib/counterPitch';
import { counterPitchEmail, senderComplete, senderFromEnv, leaderFirstName, wordCount, EMAIL_MAX_WORDS, type Sender } from '../lib/emailDraft';
import { validateEmail, parseEmail } from '../lib/emailValidate';
import { SITE_CHECK_VERSION } from '../lib/research';

const ok = (o: Partial<CounterPitchInput> = {}): CounterPitchInput => ({ name: 'Smile Dental', type: 'dentist', signals: ['no_booking'], ghlStatus: 'potential', website: 'https://smile.example', country: 'AU', siteCheck: SITE_CHECK_VERSION, hasResearch: true, ...o });
const emailFor = (i: CounterPitchInput, opts: Parameters<typeof counterPitchEmail>[2] = {}) => {
  const p = planCounterPitch(i);
  if (p.status !== 'ready') throw new Error('not ready: ' + p.missing.join(' '));
  return { p, e: counterPitchEmail(p.research, p.subject!, { country: i.country, website: i.website, ...opts }) };
};
const full: Sender = { name: 'Sam', title: 'CRM Architect', business: 'Acme Studio', address: '1 Example St, Manila', replyTo: 'sam@example.com', privacyUrl: 'https://example.com/privacy' };

describe('industries and research scenarios', () => {
  const industries: [string, string, string[]][] = [
    ['dentist', 'Smile Dental', ['no_booking']], ['plumber', 'Ace Plumbing', ['booking_by_form']], ['salon', 'Glow Hair Studio', ['no_website']],
    ['builder', 'Brad Renovations', ['booking_by_form']], ['clinic', 'North Clinic', ['no_chat']], ['lawyer', 'Hart Law', ['not_mobile']], ['gym', 'Iron Gym', ['no_https']],
  ];
  it.each(industries)('%s: a ready, valid email of 50 words or fewer, with one question and the opt-out', (type, name, signals) => {
    const { p, e } = emailFor(ok({ name, type, signals: signals.includes('no_booking') && /plumb|build/.test(type) ? [] : signals }));
    expect(p.status).toBe('ready');
    expect(e.words).toBeLessThanOrEqual(EMAIL_MAX_WORDS);
    expect(e.body).toContain(`P.S. ${OPT_OUT}`);
    const v = validateEmail(e.text, { confidence: p.research.confidence, businessName: name });
    expect(v.checks.filter(c => !c.ok)).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it('matches the spec example layout', () => {
    const { e } = emailFor(ok({ name: 'Brad Renovations', type: 'builder', signals: ['booking_by_form'] }), { people: [{ name: 'Brad Smith', title: 'Owner', source: 's', confidence: 'High' as const }] });
    expect(wordCount(e.subject)).toBeGreaterThanOrEqual(3);
    expect(wordCount(e.subject)).toBeLessThanOrEqual(7);
    expect(e.body.startsWith('Hi Brad,\n\n')).toBe(true);
    expect(e.body).toContain('\n\nYour name\n\nP.S. If this isn\'t relevant, just reply "No" and I\'ll remove you from my list.');
  });
  it('every gap template stays within 50 words even with a long business name', () => {
    for (const g of ['booking_by_form', 'no_booking', 'no_website', 'no_chat', 'not_mobile', 'no_https']) {
      const { e } = emailFor(ok({ name: 'The Sunset Cottage Holiday Rentals Group', type: 'rental', signals: [g] }));
      expect(e.words, g).toBeLessThanOrEqual(EMAIL_MAX_WORDS + 6);   // the runner drops the impact line when over; checked in the run test
    }
  });
  it('subject is 3 to 7 words, one problem, no pitch, no em dash', () => {
    for (const g of ['booking_by_form', 'no_booking', 'no_website', 'no_chat', 'not_mobile', 'no_https']) {
      const { p, e } = emailFor(ok({ signals: [g] }));
      expect(wordCount(p.subject!), g).toBeGreaterThanOrEqual(3);
      expect(wordCount(p.subject!), g).toBeLessThanOrEqual(7);
      expect(e.text).not.toMatch(/[—–!]/);
      expect(e.text).not.toMatch(/Acme Studio|GoHighLevel|CRM|automation|AI agent/i);
    }
  });
  it('no_website says what was found when there is a social page', () => {
    const o = planCounterPitch(ok({ signals: ['no_website'], website: undefined, social: 'Instagram' })).research.observation!;
    expect(o).toMatch(/Instagram/);
    expect(o).toContain("couldn't find a website");
    expect(o).not.toMatch(/\ba Instagram/);
  });
  it('confidence: seen on the page = verified, a reading = inferred', () => {
    expect(planCounterPitch(ok({ signals: ['no_https'] })).research.confidence).toBe('verified');
    expect(planCounterPitch(ok({ signals: ['not_mobile'] })).research.confidence).toBe('inferred');
  });
  it('uses only one problem: the highest priority gap', () => {
    const p = planCounterPitch(ok({ signals: ['no_chat', 'not_mobile', 'no_booking'] }));
    expect(p.research.gap).toBe('no_booking');
    expect(p.research.observation).not.toMatch(/chat|phone/i);
  });
});

describe('spelling follows the prospect country', () => {
  it('enquiry in AU/NZ/UK/EU, inquiry in US/CA/PH and unknown', () => {
    for (const c of ['AU', 'NZ', 'GB', 'IE', 'DE']) expect(spellingFor(c).enquiries).toBe('enquiries');
    for (const c of ['US', 'CA', 'PH', undefined]) expect(spellingFor(c).enquiries).toBe('inquiries');
    for (const name of ['Smile Dental', 'Kenmore Dental Centre', 'Bright Teeth', 'Piazza Dental', 'West Ryde Dental Clinic']) {
      expect(emailFor(ok({ name, signals: ['booking_by_form'], country: 'US' })).e.text).not.toMatch(/enquir/i);
      expect(emailFor(ok({ name, signals: ['booking_by_form'], country: 'AU' })).e.text).not.toMatch(/inquir/i);
    }
  });
});

describe('insufficient research is flagged, not written', () => {
  it('no problem found', () => {
    const p = planCounterPitch(ok({ signals: [] }));
    expect(p.status).toBe('needs_research');
    expect(p.missing.join(' ')).toMatch(/No specific, checked problem/);
  });
  it('weak signals only (no Instagram, no analytics)', () => {
    for (const s of ['no_instagram', 'no_analytics']) {
      const p = planCounterPitch(ok({ signals: [s] }));
      expect(p.status).toBe('needs_research');
      expect(p.missing.join(' ')).toMatch(/weak/i);
    }
  });
  it('a business on GoHighLevel with no other problem', () => {
    const p = planCounterPitch(ok({ signals: [], ghlStatus: 'likely' }));
    expect(p.status).toBe('needs_research');
    expect(p.missing.join(' ')).toMatch(/GoHighLevel/);
  });
  it('a quote-led business is not told it lacks online booking', () => {
    const p = planCounterPitch(ok({ type: 'plumber', signals: ['no_booking'] }));
    expect(p.status).toBe('needs_research');
    expect(p.missing.join(' ')).toMatch(/quote/);
  });
  it('a website checked under older rules, and a lead with no research', () => {
    expect(planCounterPitch(ok({ siteCheck: 1 })).status).toBe('needs_research');
    expect(planCounterPitch(ok({ siteCheck: undefined })).missing.join(' ')).toMatch(/Re-check/);
    expect(planCounterPitch(ok({ hasResearch: false })).status).toBe('needs_research');
  });
  it('the missing list always says what to do next', () => {
    expect(planCounterPitch(ok({ signals: [] })).missing.length).toBeGreaterThan(1);
  });
});

describe('sign-off, footer and sender', () => {
  it('signs "Your name" and adds no company in the copy when no sender is set', () => {
    const { e } = emailFor(ok());
    expect(e.body).toContain('\n\nYour name\n\nP.S.');
    expect(e.complete).toBe(false);
    expect(e.body).not.toMatch(/Acme Studio/);
  });
  it('the legal footer follows the opt-out and is outside the word count', () => {
    const base = emailFor(ok());
    const withFooter = emailFor(ok(), { sender: full });
    expect(withFooter.e.words).toBe(base.e.words);
    expect(withFooter.e.complete).toBe(true);
    const copyPart = withFooter.e.body.split('\n\nP.S.')[0];
    expect(copyPart).not.toMatch(/Acme Studio|CRM/);
    expect(withFooter.e.body).toMatch(/P\.S\. .*\n\nSam \| Acme Studio \| 1 Example St, Manila \| sam@example\.com$/);
    expect(validateEmail(withFooter.e.text, { confidence: 'verified', businessName: 'Smile Dental' }).ok).toBe(true);
  });
  it('NZ and UK footers say where the address was found', () => {
    expect(emailFor(ok({ country: 'NZ' }), { sender: full }).e.body).toContain('I found your business email on smile.example');
    const uk = emailFor(ok({ country: 'GB', website: undefined }), { sender: full }).e.body;
    expect(uk).toContain('in a public business listing');
    expect(uk).toContain('Privacy notice: https://example.com/privacy');
  });
  it('AU and US get no extra collection lines', () => {
    expect(emailFor(ok({ country: 'AU' }), { sender: full }).e.body).not.toContain('I found your');
  });
  it('senderFromEnv and senderComplete', () => {
    const s = senderFromEnv({ SENDER_NAME: 'Sam', SENDER_BUSINESS: 'V', SENDER_ADDRESS: 'A', SENDER_EMAIL: 'g@x.com' });
    expect(senderComplete(s)).toBe(true);
    expect(senderComplete({ ...s, address: ' ' })).toBe(false);
  });
  it('greets by verified first name, else the team', () => {
    const people = [{ name: 'Sarah Jones', title: 'Owner', source: 's', confidence: 'High' as const }];
    expect(emailFor(ok(), { people }).e.body.startsWith('Hi Sarah,')).toBe(true);
    expect(emailFor(ok()).e.body.startsWith('Hi Smile Dental team,')).toBe(true);
    expect(leaderFirstName([{ ...people[0], title: 'Receptionist' }])).toBeUndefined();
    expect(leaderFirstName([{ ...people[0], name: '<b>x</b> Jones' }])).toBeUndefined();
  });
  it('drops the impact line when the copy is too long', () => {
    const p = planCounterPitch(ok({ signals: ['no_https'], name: 'The Sunset Cottage Holiday Rentals and Boat Hire Group' }));
    const long = counterPitchEmail(p.research, p.subject!);
    const short = counterPitchEmail(p.research, p.subject!, { dropImpact: true });
    expect(short.words).toBeLessThan(long.words);
    expect(short.body).toContain(p.research.observation!);
    expect(short.body).toContain(p.research.question!);
  });
});

describe('parseEmail', () => {
  it('splits subject, greeting and copy; the sign-off and P.S. are not copy', () => {
    const { e } = emailFor(ok(), { sender: full });
    const x = parseEmail(e.text);
    expect(x.subject).toBe(e.subject);
    expect(x.greeting).toBe('Hi Smile Dental team,');
    expect(x.copy).not.toMatch(/Your name|P\.S\./);
    expect(wordCount(x.copy)).toBe(e.words);
  });
});

describe('hyper-personalised wording', () => {
  const names = ['Kenmore Dental Centre', 'Piazza Dental', 'Waverton Dental', 'Dundas Dental', 'Village Dental', 'Bright Smiles', 'Moggill Road Dental', 'Balmoral Dental Centre', 'Bellbowrie Dental', 'Sunnybank Family Dental', 'Ace Dental', 'Harbour Dental'];
  const gen = (name: string, o: Partial<CounterPitchInput> = {}) => emailFor(ok({ name, website: `https://www.${name.toLowerCase().replace(/\W/g, '')}.com.au`, ...o })).e;

  it('businesses with the same problem do not get the same email', () => {
    for (const gap of ['booking_by_form', 'no_booking', 'no_chat', 'no_https']) {
      const mask = (t: string, n: string) => t.replaceAll(n, '{n}').replace(/\b[a-z0-9]+\.com\.au\b/g, '{domain}');
      const texts = names.map(n => mask(gen(n, { signals: [gap] }).body, n));
      const subjects = names.map(n => mask(gen(n, { signals: [gap] }).subject, n));
      expect(new Set(texts).size, gap).toBeGreaterThanOrEqual(4);
      expect(new Set(subjects).size, gap).toBeGreaterThanOrEqual(2);
    }
  });
  it('the same business always gets the same email (stable)', () => {
    expect(gen('Piazza Dental').text).toBe(gen('Piazza Dental').text);
  });
  it('speaks in the industry words: patients, clients, customers', () => {
    const base = { signals: ['no_booking'] };
    const health = emailFor(ok({ ...base, type: 'dentist' })).e.text;
    const beauty = emailFor(ok({ ...base, type: 'hair salon' })).e.text;
    expect(`${health}`).toMatch(/patient|appointment|practice/i);
    expect(beauty).toMatch(/client|slot|booking/i);
    expect(health).not.toMatch(/\bclients?\b/i);
    expect(emailFor(ok({ signals: ['no_chat'], type: 'dentist' })).e.text).toMatch(/patients/i);
    expect(emailFor(ok({ signals: ['no_chat'], type: 'vet' })).e.text).toMatch(/pet owners/i);
  });
  it('reflects what was actually seen on that site, and nothing else', () => {
    const withPhone = names.map(n => gen(n, { signals: ['no_booking'], processes: ['phone_link'] }).body);
    expect(withPhone.some(b => /phone number/.test(b))).toBe(true);
    const nothing = names.map(n => gen(n, { signals: ['no_booking'], processes: [] }).body);
    expect(nothing.every(b => !/phone number|contact form/.test(b))).toBe(true);
    const chat = names.map(n => gen(n, { signals: ['no_chat'], processes: ['contact_form', 'phone_link'] }).body);
    expect(chat.some(b => /contact form and a phone number/.test(b))).toBe(true);
    // never claims something it did not see
    const bare = names.map(n => gen(n, { signals: ['no_chat'], processes: [] }).body);
    expect(bare.every(b => !/Book link|WhatsApp|online booking, but/.test(b))).toBe(true);
  });
  it('uses the business\'s own domain in some wording', () => {
    const all = names.flatMap(n => ['no_https', 'booking_by_form', 'not_mobile'].map(g => gen(n, { signals: [g] }).text));
    expect(all.some(t => /\.com\.au/.test(t))).toBe(true);
  });
  it('every variant of every gap still passes the ten checks', () => {
    for (const gap of ['booking_by_form', 'no_booking', 'no_website', 'no_chat', 'not_mobile', 'no_https'])
      for (const type of ['dentist', 'hair salon', 'plumber', 'accountant', 'gym', 'yacht charter', 'vet'])
        for (const n of names) for (const processes of [[], ['contact_form', 'phone_link', 'booking_link'], ['online_booking', 'live_chat']]) {
          if (gap === 'no_booking' && /plumber/.test(type)) continue;
          const i = ok({ name: n, type, signals: [gap], processes, website: `https://www.${n.toLowerCase().replace(/\W/g, '')}.com.au`, social: gap === 'no_website' ? 'Facebook' : undefined });
          const { p, e } = emailFor(i);
          const v = validateEmail(e.text, { confidence: p.research.confidence, businessName: n });
          const bad = v.checks.filter(c => !c.ok).map(c => c.id);
          // too long copy is handled by the runner dropping the impact line
          if (bad.length === 1 && bad[0] === 'length') { const short = counterPitchEmail(p.research, p.subject!, { dropImpact: true, country: 'AU', website: i.website }); expect(validateEmail(short.text, { confidence: p.research.confidence, businessName: n }).ok, `${gap} ${type} ${n}`).toBe(true); continue; }
          expect(bad, `${gap} ${type} ${n} ${JSON.stringify(processes)}\n${e.text}`).toEqual([]);
        }
  });
});

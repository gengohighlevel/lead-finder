import { describe, it, expect } from 'vitest';
import { validateEmail } from '../lib/emailValidate';
import { OPT_OUT } from '../lib/counterPitch';

const mk = (o: { subject?: string; copy?: string; optOut?: string; greeting?: string } = {}) =>
  `Subject: ${o.subject ?? 'Enquiries waiting behind a form?'}\n\n${o.greeting ?? 'Hi Brad,'}\n\n${o.copy ?? "Brad Renovations' website takes enquiries through a form, but I couldn't find a way to book a time directly. People comparing a few businesses may not wait for a reply.\n\nDoes your team already have a process for following up with those enquiries?"}\n\nGen\n\n${o.optOut ?? `P.S. ${OPT_OUT}`}`;
const failed = (t: string, confidence: 'verified' | 'inferred' = 'verified') => validateEmail(t, { confidence, businessName: 'Brad Renovations' }).checks.filter(c => !c.ok).map(c => c.id);

describe('validateEmail: the ten checks', () => {
  it('passes a good email', () => { expect(failed(mk())).toEqual([]); });
  it('1 subject: must be 3 to 7 words and match the body', () => {
    expect(failed(mk({ subject: 'Hello?' }))).toContain('subject');
    expect(failed(mk({ subject: 'Your invoice payment overdue notice today please?' }))).toContain('subject');
    expect(failed(mk({ subject: 'Weather forecast for tomorrow evening?' }))).toContain('subject');   // not what the body is about
    expect(failed(mk({ subject: 'Free audit for your form?' }))).toContain('subject');
  });
  it('2 observation: an unverified problem must be hedged', () => {
    const stated = mk({ copy: "Brad Renovations' website is not set up for phones.\n\nIs a mobile fix something your team has planned?", subject: 'Your website on a phone?' });
    expect(failed(stated, 'inferred')).toContain('observation');
    expect(failed(mk({ copy: "Brad Renovations' website may not be set up for phones.\n\nIs a mobile fix something your team has planned?", subject: 'Your website on a phone?' }), 'inferred')).not.toContain('observation');
  });
  it('3 prospect focus: not about the sender', () => {
    expect(failed(mk({ copy: 'We are a busy team in town.\n\nDoes that sound familiar?' }))).toContain('prospect');
  });
  it('4 no pitch: services, calls, offers, purchases', () => {
    for (const copy of [
      'I help builders get more jobs with a CRM.\n\nDoes your team follow up on your form?',
      "Your form may be slow. Can we book a quick call this week?\n\nDoes your team follow up?",
      'Your form may be slow. We offer a free audit.\n\nDoes your team follow up on your form?',
      "Your form may be slow, and our web design can fix it.\n\nDoes your team follow up on your form?",
      'Your form may be slow. Would you buy automation?\n\nDoes your team follow up on your form?',
    ]) expect(failed(mk({ copy })), copy).toContain('no-pitch');
  });
  it('5 one problem', () => {
    expect(failed(mk({ copy: "Your form may be slow. I also noticed your site may be slow on phones. Your logo may be old. Your menu may be odd. Your page may be long.\n\nDoes your team follow up on your form?" }))).toContain('one-problem');
    expect(failed(mk({ copy: "Your form may be slow. Additionally your site may not suit phones.\n\nDoes your team follow up on your form?" }))).toContain('one-problem');
  });
  it('6 exactly one question, at the end', () => {
    expect(failed(mk({ copy: "Your form may be slow.\n\nDo you follow up? Who does it?" }))).toContain('one-question');
    expect(failed(mk({ copy: "Your form may be slow. Do you follow up on it." }))).toContain('one-question');
  });
  it('7 more than 50 words fails; 50 or fewer passes', () => {
    const filler = Array.from({ length: 48 }, () => 'word').join(' ');
    expect(failed(mk({ copy: `Your form may be slow ${filler}.\n\nDoes your team follow up on your form?` }))).toContain('length');
    expect(validateEmail(mk(), { confidence: 'verified' }).words).toBeLessThanOrEqual(50);
  });
  it('8 no invented numbers, losses or guarantees', () => {
    for (const copy of ['Your form may lose 30% of visitors.\n\nDoes your team follow up on your form?', "You're losing customers every week.\n\nDoes your team follow up on your form?", 'We guarantee more replies on your form.\n\nDoes your team follow up on your form?', 'Your form may cost you $5,000 a month.\n\nDoes your team follow up on your form?'])
      expect(failed(mk({ copy })), copy).toContain('claims');
  });
  it('9 opt-out is required', () => {
    expect(failed(mk({ optOut: 'P.S. Thanks for reading.' }))).toContain('opt-out');
    expect(failed(mk({ optOut: 'P.S. Reply "No" and I will remove you.' }))).not.toContain('opt-out');
  });
  it('10 natural: no dashes, emojis, exclamation marks, jargon or shouting', () => {
    for (const copy of ['Your form may be slow — really.\n\nDoes your team follow up on your form?', 'Your form may be slow 😀.\n\nDoes your team follow up on your form?', 'Your form may be slow!\n\nDoes your team follow up on your form?',
      'Your form may need a seamless, cutting-edge solution.\n\nDoes your team follow up on your form?', 'I hope this email finds you well. Your form may be slow.\n\nDoes your team follow up on your form?', 'Your form may be SLOW today.\n\nDoes your team follow up on your form?'])
      expect(failed(mk({ copy })), copy).toContain('natural');
  });
  it('the business name in capitals is not shouting', () => {
    expect(validateEmail(mk({ copy: "ACME Plumbing's website takes enquiries through a form, but I couldn't find a way to book a time directly.\n\nDoes your team follow up on your form?" }), { confidence: 'verified', businessName: 'ACME Plumbing' }).checks.find(c => c.id === 'natural')!.ok).toBe(true);
  });
  it('a dash or capitals inside the business name are not the writer\'s style', () => {
    const t = mk({ greeting: 'Hi Carrera\u2013Rubrico Dental team,', copy: "I couldn't find a website for Carrera\u2013Rubrico Dental.\n\nIs getting a website something you're already working on?", subject: 'Can customers find you online?' }).replace('Enquiries', '');
    expect(validateEmail(t.replace('P.S.', 'P.S.'), { confidence: 'inferred', businessName: 'Carrera\u2013Rubrico Dental' }).checks.find(c => c.id === 'natural')!.ok).toBe(true);
  });
  it('catches hand edits made in the textbox', () => {
    expect(validateEmail('just buy my stuff', { confidence: 'verified' }).ok).toBe(false);
  });
});

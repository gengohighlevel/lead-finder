import { describe, it, expect } from 'vitest';
import { classifyReply, followUpFor, noResponseFollowUp, stopsOutreach } from '../lib/followUp';
import { planCounterPitch } from '../lib/counterPitch';
import { SITE_CHECK_VERSION } from '../lib/research';
import { leadEntries } from '../lib/dnc';

const research = (gap = 'booking_by_form') => planCounterPitch({ name: 'Brad Renovations', type: 'dentist', signals: [gap], country: 'AU', website: 'https://brad.example', siteCheck: SITE_CHECK_VERSION, hasResearch: true }).research;
const ctx = (gap?: string) => ({ research: research(gap), firstName: 'Brad' });

describe('classifyReply', () => {
  it.each([
    ['No', 'opt_out'], ['no.', 'opt_out'], ['Stop', 'opt_out'], ['Please remove me from your list', 'opt_out'], ['unsubscribe', 'opt_out'], ['Take me off your list, this is spam', 'opt_out'],
    ['Not interested, thanks', 'negative'], ['No thanks', 'negative'], ['not relevant to us', 'negative'],
    ['We already have a system for that', 'existing_solution'], ['Our receptionist handles those', 'existing_solution'], ["It's all sorted", 'existing_solution'],
    ["No, we don't have a process", 'positive'], ['Good question, not yet', 'positive'], ['Yes, tell us more', 'more_info'], ['Interested, yes', 'positive'],
    ['What did you see exactly?', 'more_info'], ['Can you explain what you mean?', 'more_info'], ['Who are you?', 'more_info'],
    ['', 'unclear'], ['Out of office until Monday', 'unclear'], ['Please pass this to my manager', 'unclear'],
  ])('%j is %s', (reply, kind) => { expect(classifyReply(reply)).toBe(kind); });
  it('only an opt-out or a plain no stops outreach', () => {
    expect(['opt_out', 'negative'].every(k => stopsOutreach(k as any))).toBe(true);
    expect(['positive', 'more_info', 'existing_solution', 'unclear'].some(k => stopsOutreach(k as any))).toBe(false);
  });
});

describe('followUpFor', () => {
  it('opt-out and negative: suppress and send nothing', () => {
    for (const r of ['No', 'Not interested']) { const f = followUpFor(r, ctx()); expect(f.suppress).toBe(true); expect(f.draft).toBeNull(); }
  });
  it('an unclear reply changes nothing', () => {
    const f = followUpFor('Out of office until Monday', ctx());
    expect(f.suppress).toBe(false);
    expect(f.draft).toBeNull();
  });
  it('positive: asks one qualifying question and does not pitch', () => {
    const f = followUpFor("No, we don't have a process", ctx());
    expect(f.kind).toBe('positive');
    expect(f.draft).toMatch(/^Hi Brad,/);
    expect(f.draft!.match(/\?/g)).toHaveLength(1);
    expect(f.draft).not.toMatch(/CRM|Acme Studio|automation|book a call|demo/i);
  });
  it('existing solution: asks whether it works, and offers to leave it', () => {
    const f = followUpFor('We already have a system', ctx());
    expect(f.draft).toMatch(/working well/);
    expect(f.draft).toMatch(/leave it there/);
    expect(f.suppress).toBe(false);
  });
  it('more info: explains the observation before anything else', () => {
    const f = followUpFor('What did you see exactly?', ctx());
    expect(f.draft).toContain("couldn't find a way to book a time directly");
    expect(f.draft).toContain("I'm not selling anything");
    expect(f.draft).not.toMatch(/CRM|automation|Acme Studio/i);
  });
});

describe('no response', () => {
  it('a different angle, one problem, low pressure, with the opt-out, and not a repeat of email 1', () => {
    for (const gap of ['booking_by_form', 'no_booking', 'no_website', 'no_chat', 'not_mobile', 'no_https']) {
      const c = ctx(gap);
      const f = noResponseFollowUp(c);
      expect(f.draft, gap).toContain(`P.S. If this isn't relevant, just reply "No"`);
      expect(f.draft, gap).not.toContain(c.research.observation!);
      expect(f.draft, gap).not.toContain(c.research.question!);
      expect(f.draft, gap).not.toMatch(/[—–!]/);
    }
  });
  it('uses the country spelling', () => {
    expect(noResponseFollowUp(ctx()).draft).toContain('an enquiry');
  });
});

describe('leadEntries (opt-out suppression)', () => {
  it('email, website domain and phone all go on the list; a free mailbox domain and social sites do not', () => {
    const e = leadEntries({ email: 'brad@gmail.com', website: 'https://www.brad.example/x', phone: '+61 400 111 222' });
    expect(e).toEqual([{ kind: 'email', value: 'brad@gmail.com' }, { kind: 'domain', value: 'brad.example' }, { kind: 'phone', value: '61400111222' }]);
    expect(leadEntries({ website: 'https://facebook.com/brad' })).toEqual([]);
  });
});

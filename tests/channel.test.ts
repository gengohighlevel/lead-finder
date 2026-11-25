import { describe, it, expect } from 'vitest';
import { reachChannels, dmDraft } from '../lib/channel';
import { hasTechWords } from '../lib/playbook';
import { toE164 } from '../lib/phone';

const mobile = () => true;
const solo = { name: 'Glow Makeup Artist', instagram: 'glowmua', phone: '+2348012345678' };
const fb = 'https://www.facebook.com/glowmua';

describe('reachChannels', () => {
  it('puts social first for a business with no website (that is where a solo business answers)', () => {
    const c = reachChannels({ ...solo, email: 'glow@example.com' }, { facebook: fb }, undefined, mobile);
    expect(c.map(x => x.kind)).toEqual(['instagram', 'facebook', 'whatsapp', 'phone', 'email']);
  });
  it('puts email first when the business has a website', () => {
    const c = reachChannels({ ...solo, website: 'https://glow.example', email: 'hi@glow.example' }, { facebook: fb }, undefined, mobile);
    expect(c.map(x => x.kind)).toEqual(['email', 'instagram', 'facebook', 'whatsapp', 'phone']);
  });
  it('builds safe links', () => {
    const c = Object.fromEntries(reachChannels({ ...solo, email: 'glow@example.com' }, { facebook: fb }, undefined, mobile).map(x => [x.kind, x]));
    expect(c.instagram.url).toBe('https://www.instagram.com/glowmua/');
    expect(c.facebook.url).toBe(fb);
    expect(c.whatsapp.url).toBe('https://wa.me/2348012345678');
    expect(c.phone.url).toBe('tel:+2348012345678');
    expect(c.email.url).toBe('mailto:glow@example.com');
  });
  it('drops an email that cannot receive mail, a bad handle, a non-Facebook link and a phone that is not a real number', () => {
    const c = reachChannels({ name: 'x', email: 'dead@example.com', instagram: 'bad handle!', phone: '12' }, { facebook: 'https://evil.example/facebook.com/x', emailCheck: { status: 'bad' } });
    expect(c).toEqual([]);
  });
  it('offers WhatsApp only for a mobile number: a landline gets Phone but no WhatsApp, and with no way to tell there is no WhatsApp', () => {
    const land = reachChannels({ name: 'x', phone: '+61733334444' }, undefined, undefined, () => false);
    expect(land.map(c => c.kind)).toEqual(['phone']);
    expect(reachChannels({ name: 'x', phone: '+61412345678' }).map(c => c.kind)).toEqual(['phone']);
    expect(reachChannels({ name: 'x', phone: '+61412345678' }, undefined, undefined, mobile).map(c => c.kind)).toEqual(['whatsapp', 'phone']);
  });
  it('in the browser only trusts numbers already in international form', () => {
    expect(reachChannels({ name: 'x', phone: '+61 412 345 678' }).find(x => x.kind === 'phone')?.url).toBe('tel:+61412345678');
    expect(reachChannels({ name: 'x', phone: '0412 345 678' }, { country: 'au' }).some(x => x.kind === 'phone')).toBe(false);
  });
  it('reads a national phone number using the lead\'s country', () => {
    const c = reachChannels({ name: 'x', phone: '0412 345 678' }, { country: 'au' }, toE164);
    expect(c.find(x => x.kind === 'phone')?.url).toBe('tel:+61412345678');
  });
});

describe('dmDraft', () => {
  const q = 'When someone wants to book after hours, what happens right now?';
  it('is a short, problem-first message that names the platform and asks one question', () => {
    const d = dmDraft(solo.name, q, reachChannels(solo, { facebook: fb }))!;
    expect(d.platform).toBe('Instagram');
    expect(d.text).toBe(`Hi, I came across Glow Makeup Artist on Instagram. ${q}`);
    expect(d.text.split(/\s+/).length).toBeLessThanOrEqual(45);
    expect(hasTechWords(d.text)).toBe(false);
    expect(d.text).not.toMatch(/https?:|@/); // no links or handles in a cold DM
  });
  it('uses Facebook when that is the only social page, and WhatsApp wording that does not claim a page', () => {
    expect(dmDraft('Glow', q, reachChannels({ name: 'Glow' }, { facebook: fb }))!.text).toContain('on Facebook');
    const w = dmDraft('Glow', q, reachChannels({ name: 'Glow', phone: '+2348012345678' }, undefined, undefined, mobile))!;
    expect(w.platform).toBe('WhatsApp');
    expect(w.text).toBe(`Hi, I found Glow while looking at local businesses. ${q}`);
  });
  it('gives nothing when there is only email or a plain phone call, or no question', () => {
    expect(dmDraft('x', q, reachChannels({ name: 'x', website: 'https://x.example', email: 'a@x.example' }))).toBeUndefined();
    expect(dmDraft('x', '', reachChannels(solo))).toBeUndefined();
  });
});

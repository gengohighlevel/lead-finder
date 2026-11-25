import { describe, it, expect } from 'vitest';
import { extractSiteFacts } from '../lib/siteFacts';
import { planCounterPitch, type CounterPitchInput } from '../lib/counterPitch';
import { counterPitchEmail } from '../lib/emailDraft';
import { validateEmail } from '../lib/emailValidate';
import { SITE_CHECK_VERSION } from '../lib/research';

const page = (body: string, head = '') => `<html><head><title>Kenmore Dental</title>${head}</head><body>${body}</body></html>`;
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

describe('extractSiteFacts', () => {
  it('reads the suburb from the published address data', () => {
    expect(extractSiteFacts(page('', ld({ '@type': 'Dentist', address: { '@type': 'PostalAddress', addressLocality: 'Kenmore', addressRegion: 'QLD' } })), '', 'dentist').locality).toBe('Kenmore');
    expect(extractSiteFacts(page('<span itemprop="addressLocality">Bellbowrie</span>'), '', 'dentist').locality).toBe('Bellbowrie');
  });
  it('nested and list-form structured data work; bad JSON is ignored; junk is refused', () => {
    expect(extractSiteFacts(page('', ld([{ '@graph': [{ address: { addressLocality: 'Moggill' } }] }])), '', 'dentist').locality).toBe('Moggill');
    expect(extractSiteFacts(page('', '<script type="application/ld+json">{not json</script>'), '', 'dentist').locality).toBeUndefined();
    expect(extractSiteFacts(page('', ld({ address: { addressLocality: '<b>x</b>' } })), '', 'dentist').locality).toBeUndefined();
    expect(extractSiteFacts(page('', ld({ address: { addressLocality: 'A'.repeat(60) } })), '', 'dentist').locality).toBeUndefined();
  });
  it('names a service only when a menu, heading or title says it', () => {
    const f = extractSiteFacts(page('<nav><a href="/i">Dental Implants</a><a href="/v">Invisalign</a><a href="/w">Whitening</a></nav>'), '', 'dentist');
    expect(f.services).toEqual(['dental implants', 'Invisalign']);                                 // at most two, in the list's order
    expect(extractSiteFacts(page('<p>We do not offer implants here, sorry. Invisalign too.</p>'), '', 'dentist').services).toEqual([]);   // body text is not a menu
    expect(extractSiteFacts(page('<footer><a href="/x">implants</a></footer>'), '', 'dentist').services).toEqual([]);
  });
  it('uses the vocabulary of the business type, and nothing for an unknown type', () => {
    expect(extractSiteFacts(page('<h2>Ducted air conditioning</h2>'), '', 'air conditioning installer').services).toEqual(['ducted air conditioning']);
    expect(extractSiteFacts(page('<h2>Dental Implants</h2>'), '', 'florist').services).toEqual([]);
    expect(extractSiteFacts(page('<h2>Dental Implants</h2>'), '', 'hair salon').services).toEqual([]);
  });
  it('also reads the other pages that were fetched', () => {
    expect(extractSiteFacts(page(''), '<nav><a>Emergency dentist</a></nav>', 'dentist').services).toEqual(['emergency dental care']);
  });
  it('empty or broken pages give an empty result', () => {
    expect(extractSiteFacts('', '', 'dentist')).toEqual({ services: [] });
    expect(extractSiteFacts('<<<>', undefined as any, undefined as any)).toEqual({ services: [] });
  });
});

describe('the email uses what the site said, and only that', () => {
  it('possessive: no "Orthodontists\'s"', () => {
    for (const name of ['Specialist Orthodontists', 'Kenmore Dentists', 'Smile Dental']) for (const gap of ['booking_by_form', 'no_booking', 'no_chat', 'not_mobile', 'no_https']) {
      const p = planCounterPitch({ name, type: 'dentist', signals: [gap], country: 'AU', website: 'https://x.com.au', siteCheck: SITE_CHECK_VERSION, hasResearch: true, facts: { services: ['braces'] } });
      expect(p.research.observation, `${name} ${gap}`).not.toMatch(/s's /);
    }
  });
  const base = (o: Partial<CounterPitchInput> = {}): CounterPitchInput => ({ name: 'Kenmore Dental Centre', type: 'dentist', signals: ['booking_by_form'], country: 'AU', website: 'https://kenmoredental.com.au', siteCheck: SITE_CHECK_VERSION, hasResearch: true, ...o });
  const text = (i: CounterPitchInput) => { const p = planCounterPitch(i); return { p, e: counterPitchEmail(p.research, p.subject!, { country: 'AU', website: i.website }) }; };

  it('mentions the services and the suburb the site named', () => {
    const { p, e } = text(base({ facts: { locality: 'Kenmore', services: ['dental implants', 'Invisalign'] } }));
    expect(e.text).toMatch(/dental implants and Invisalign|Kenmore/);
    expect(e.text).not.toMatch(/Brisbane|Sydney/);
    expect(p.research.observation).toContain('dental implants and Invisalign');
  });
  it('without facts the wording never invents a suburb or a service', () => {
    for (const gap of ['booking_by_form', 'no_booking', 'no_chat']) {
      const { e } = text(base({ signals: [gap] }));
      expect(e.text).not.toMatch(/covers|looking into|Kenmore\b.*waiting|implants|Invisalign/);
    }
  });
  it('different practices with the same problem now differ in more than the name', () => {
    const a = text(base({ name: 'Alpha Dental', facts: { locality: 'Kenmore', services: ['dental implants'] } })).e.body.replaceAll('Alpha Dental', '{n}');
    const b = text(base({ name: 'Beta Dental', facts: { locality: 'Moggill', services: ['braces'] } })).e.body.replaceAll('Beta Dental', '{n}');
    expect(a).not.toBe(b);
  });
  it('every gap with facts still passes the ten checks, within 50 words', () => {
    for (const gap of ['booking_by_form', 'no_booking', 'no_chat'])
      for (const facts of [{ locality: 'Kenmore', services: ['dental implants and Invisalign'.split(' and ')[0]] }, { services: ['Invisalign', 'braces'] }, { locality: 'West Pennant Hills', services: [] }])
        for (const name of ['Kenmore Dental Centre', 'Dr Andrew MacMillan', 'Sunnybank Hills Family Dental Care']) {
          const i = base({ name, signals: [gap], facts });
          const { p, e } = text(i);
          let t = e.text;
          if (e.words > 50) t = counterPitchEmail(p.research, p.subject!, { country: 'AU', website: i.website, dropImpact: true }).text;
          const bad = validateEmail(t, { confidence: p.research.confidence, businessName: name }).checks.filter(c => !c.ok).map(c => c.id);
          expect(bad, `${gap} ${name} ${JSON.stringify(facts)}\n${t}`).toEqual([]);
        }
  });
});

import { describe, it, expect } from 'vitest';
import { registrable, nameMatchesDomain, classifyGhlHost, thirdPartyHosts } from '../lib/ghlAgency';

describe('registrable', () => {
  it('reduces a host to the domain a company owns, including two-part endings', () => {
    expect(registrable('link.practicebeacon.com')).toBe('practicebeacon.com');
    expect(registrable('www.balmoraldental.com.au')).toBe('balmoraldental.com.au');
    expect(registrable('go.acme.co.nz')).toBe('acme.co.nz');
    expect(registrable('a.b.c.example.co.uk')).toBe('example.co.uk');
    expect(registrable('localhost')).toBe('localhost');
  });
});

describe('nameMatchesDomain', () => {
  it('matches a business name to its own domain, ignoring "&", "Pty Ltd", punctuation and case', () => {
    expect(nameMatchesDomain('Glacier Plumbing & Hydronics', 'go.glacierplumbingandhydronics.com')).toBe(true);
    expect(nameMatchesDomain('Beauty By Sophie', 'link.beautybysophie.co.nz')).toBe(true);
    expect(nameMatchesDomain('Unicorn Moving & Storage - Austin Movers', 'link.unicornmoving.com')).toBe(true);
    expect(nameMatchesDomain("Scotty's The Movers Pty Ltd", 'book.scottysthemovers.com.au')).toBe(true);
    expect(nameMatchesDomain('Smith Law, LLC', 'portal.smithlawfirm.com')).toBe(true);
  });
  it('does not match an unrelated company', () => {
    expect(nameMatchesDomain('Imagine Orthodontic Studio', 'link.practicebeacon.com')).toBe(false);
    expect(nameMatchesDomain('Glacier Plumbing & Hydronics', 'go.locationsync.com')).toBe(false);
    expect(nameMatchesDomain('Bramos Tree Solution', 'link.systemic-digital.net')).toBe(false);
  });
  it('a word every business in the trade shares is not enough (two dentists are not each other)', () => {
    expect(nameMatchesDomain('Kenmore Dental Centre', 'link.carrollwooddental.com')).toBe(false);
    expect(nameMatchesDomain('Elite Moving Company', 'go.premiermovingcompany.com')).toBe(false);
  });
  it('needs real letters to compare: an empty or one-word-too-short name matches nothing', () => {
    expect(nameMatchesDomain('', 'link.acme.com')).toBe(false);
    expect(nameMatchesDomain('A', 'link.acme.com')).toBe(false);
  });
});

describe('classifyGhlHost', () => {
  const ctx = { siteHost: 'www.imagineorthostudio.com', businessName: 'Imagine Orthodontic Studio' };
  it('the business\'s own website domain is "own"', () => {
    expect(classifyGhlHost('link.imagineorthostudio.com', ctx)).toMatchObject({ owner: 'own', domain: 'imagineorthostudio.com' });
  });
  it('a domain that matches the business name but not its site is still "own" (a second domain)', () => {
    expect(classifyGhlHost('go.imagineorthodontic.com', ctx).owner).toBe('own');
  });
  it('a domain that is neither is a third-party host, with the domain named', () => {
    const r = classifyGhlHost('link.practicebeacon.com', ctx);
    expect(r).toMatchObject({ owner: 'third-party', domain: 'practicebeacon.com' });
    expect(r.reason).toMatch(/practicebeacon\.com/);
    expect(r.reason).toMatch(/not .*(site|name)/i);
  });
  it('GHL\'s own addresses are never an agency', () => {
    for (const h of ['api.leadconnectorhq.com', 'link.msgsndr.com', 'app.gohighlevel.com', 'brand.ludicrous.cloud']) expect(classifyGhlHost(h, ctx).owner).toBe('ghl');
  });
  it('works with no business name or site: only the domain it can compare', () => {
    expect(classifyGhlHost('link.acme.com', { siteHost: 'acme.com' }).owner).toBe('own');
    expect(classifyGhlHost('link.acme.com', {}).owner).toBe('third-party');
  });
});

describe('thirdPartyHosts', () => {
  it('lists each third-party domain once, own and GHL hosts left out', () => {
    const hosts = ['link.imagineorthostudio.com', 'link.practicebeacon.com', 'go.practicebeacon.com', 'api.leadconnectorhq.com'];
    expect(thirdPartyHosts(hosts, { siteHost: 'imagineorthostudio.com', businessName: 'Imagine Orthodontic Studio' })).toEqual([{ domain: 'practicebeacon.com', hosts: ['link.practicebeacon.com', 'go.practicebeacon.com'] }]);
  });
});

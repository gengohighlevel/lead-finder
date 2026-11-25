import { describe, it, expect } from 'vitest';
import { parseEntry, parseEntries, matchSuppression, type Suppression } from '../lib/dnc';

const S = (kind: Suppression['kind'], value: string, id = 1): Suppression => ({ id, kind, value, createdAt: 't' });

describe('parseEntry', () => {
  it('reads an email, a domain, a URL and a phone number from free text', () => {
    expect(parseEntry('Sarah@Smile.example ')).toEqual({ kind: 'email', value: 'sarah@smile.example' });
    expect(parseEntry('@smile.example')).toEqual({ kind: 'domain', value: 'smile.example' });
    expect(parseEntry('https://www.Smile.example/contact?x=1')).toEqual({ kind: 'domain', value: 'smile.example' });
    expect(parseEntry('www.smile.example')).toEqual({ kind: 'domain', value: 'smile.example' });
    expect(parseEntry('+61 412 345 678')).toEqual({ kind: 'phone', value: '61412345678' });
    expect(parseEntry('(512) 327-3631')).toEqual({ kind: 'phone', value: '5123273631' });
  });
  it('refuses a shared platform as a whole (a lead whose "website" is its Facebook page must not block facebook.com), but keeps a business\'s own subdomain', () => {
    for (const u of ['https://www.facebook.com/glowmua', 'instagram.com/glowmua', 'https://uk.linkedin.com/company/x', 'https://linktr.ee/x', 'https://g.page/x', 'https://www.yelp.com/biz/x']) expect(parseEntry(u), u).toBeUndefined();
    expect(parseEntry('superiormoves.godaddysites.com')).toEqual({ kind: 'domain', value: 'superiormoves.godaddysites.com' });
    expect(matchSuppression({ website: 'https://other.godaddysites.com' }, [S('domain', 'superiormoves.godaddysites.com')])).toBeUndefined();
  });
  it('refuses junk and whole free-mail providers (blocking gmail.com would block thousands of businesses)', () => {
    for (const bad of ['', '  ', 'hello', '12', 'a@b', '@', 'http://', 'no spaces allowed.com x']) expect(parseEntry(bad), bad).toBeUndefined();
    expect(parseEntry('@gmail.com')).toBeUndefined();
    expect(parseEntry('gmail.com')).toBeUndefined();
    expect(parseEntry('someone@gmail.com')).toEqual({ kind: 'email', value: 'someone@gmail.com' }); // one person is fine
  });
});

describe('parseEntries', () => {
  it('splits a pasted list by lines, commas and semicolons, and reports what it could not read', () => {
    const r = parseEntries('a@x.example\nb@y.example, z.example; +1 512 327 3631\nnonsense\n\n');
    expect(r.entries.map(e => `${e.kind}:${e.value}`)).toEqual(['email:a@x.example', 'email:b@y.example', 'domain:z.example', 'phone:15123273631']);
    expect(r.unreadable).toEqual(['nonsense']);
  });
  it('drops duplicates inside the list', () => {
    expect(parseEntries('a@x.example\nA@X.example').entries).toHaveLength(1);
  });
});

describe('matchSuppression', () => {
  const lead = { email: 'sarah@smile.example', website: 'https://www.smile.example/', phone: '(07) 3000 1234' };
  it('matches the exact email, case-insensitively', () => {
    expect(matchSuppression({ email: 'Sarah@SMILE.example' }, [S('email', 'sarah@smile.example')])?.via).toBe('email');
    expect(matchSuppression({ email: 'other@smile.example' }, [S('email', 'sarah@smile.example')])).toBeUndefined();
  });
  it('a domain matches the business by its website AND by any address on it, including subdomains', () => {
    expect(matchSuppression({ website: 'https://www.smile.example/' }, [S('domain', 'smile.example')])?.via).toBe('website');
    expect(matchSuppression({ website: 'https://book.smile.example' }, [S('domain', 'smile.example')])?.via).toBe('website');
    expect(matchSuppression({ email: 'a@mail.smile.example' }, [S('domain', 'smile.example')])?.via).toBe('email domain');
    expect(matchSuppression({ website: 'https://notsmile.example' }, [S('domain', 'smile.example')])).toBeUndefined();
    expect(matchSuppression({ website: 'https://smile.example.evil.com' }, [S('domain', 'smile.example')])).toBeUndefined();
  });
  it('a free-mail address is never matched by its provider\'s domain', () => {
    expect(matchSuppression({ email: 'a@gmail.com' }, [S('domain', 'gmail.com')])).toBeUndefined();
  });
  it('a phone matches however it is written', () => {
    for (const entry of ['61730001234', '730001234', '0730001234']) expect(matchSuppression(lead, [S('phone', entry)])?.via, entry).toBe('phone');
    expect(matchSuppression({ phone: '+61 7 3000 9999' }, [S('phone', '61730001234')])).toBeUndefined();
  });
  it('returns the entry and why it matched, and nothing for an empty list or a lead with nothing to match', () => {
    const m = matchSuppression(lead, [S('domain', 'smile.example', 7)])!;
    expect(m.suppression.id).toBe(7);
    expect(matchSuppression(lead, [])).toBeUndefined();
    expect(matchSuppression({}, [S('email', 'a@b.example')])).toBeUndefined();
  });
});

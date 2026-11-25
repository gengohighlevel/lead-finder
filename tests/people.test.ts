import { describe, it, expect } from 'vitest';
import { extractPeople, extractFromPages, findTeamLinks, isPlausibleName, isLeaderTitle } from '../lib/people';

const page = (body: string) => `<html><body>${body}</body></html>`;
const U = 'https://smile.example/about';
const names = (html: string, biz = 'Smile Dental') => extractPeople(html, U, biz).map(p => `${p.name}|${p.title ?? ''}`);

describe('isPlausibleName', () => {
  it('accepts real names, with honorifics, initials and particles', () => {
    for (const n of ['Sarah Lee', 'Dr. Sarah Lee', 'John A. Smith', "Mary O'Neil", 'Anne-Marie Dubois', 'Jan van der Berg', 'Zoë Müller']) expect(isPlausibleName(n), n).toBe(true);
  });
  it('rejects headings that start with a title but are sentences', () => {
    for (const n of ["Dr. Ip's Professional Affiliations", 'Dr. Ip Provides Stunning Results', 'Dr. Lee Treats Every Patient', 'Dr. Smith And Associates']) expect(isPlausibleName(n, 'Smile Dental'), n).toBe(false);
  });
  it('rejects acronyms, brand words and sentence fragments (found on real sites)', () => {
    for (const n of ['MetLife PPO', 'Delta Dental PPO', 'Dr. Frank. Coordination Clinical', 'John DDS Smith']) expect(isPlausibleName(n, 'Walden Dental'), n).toBe(false);
    for (const n of ['Mary McDonald', 'Kevin DeShawn', 'J. R. Smith', 'Dr. J. Lee']) expect(isPlausibleName(n, 'X'), n).toBe(true);
  });
  it('a person who IS the business (Dr David Gordon, DDS) is still a person', () => {
    expect(isPlausibleName('David Gordon', 'Dr David Gordon')).toBe(true);
    expect(isPlausibleName('Dr. David Gordon', 'David Gordon DDS')).toBe(true);
    expect(isPlausibleName('Bright Peak', 'Bright Peak Marketing')).toBe(false);
  });
  it('rejects page furniture, single words and business names', () => {
    for (const n of ['Contact Us', 'Our Team', 'Meet The Team', 'Book Now', 'Sarah', 'Smile Dental', 'Dental Clinic', 'Privacy Policy', 'Request A Quote', 'ABOUT US', '2024 Smith', 'Learn More About']) expect(isPlausibleName(n, 'Smile Dental'), n).toBe(false);
  });
});

describe('extractPeople: structured data', () => {
  it('reads schema.org Person and founder/employee from JSON-LD as high confidence', () => {
    const html = page(`<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Dentist', name: 'Smile Dental',
      founder: { '@type': 'Person', name: 'Dr. Sarah Lee', jobTitle: 'Principal Dentist' },
      employee: [{ '@type': 'Person', name: 'Tom Brown', jobTitle: 'Hygienist' }],
    })}</script>`);
    const p = extractPeople(html, U, 'Smile Dental');
    expect(p[0]).toMatchObject({ name: 'Dr. Sarah Lee', title: 'Principal Dentist', confidence: 'High', source: U });
    expect(p.map(x => x.name)).toContain('Tom Brown');
  });
  it('survives broken JSON-LD', () => {
    expect(names(page('<script type="application/ld+json">{ nope</script><h3>Sarah Lee</h3><p>Owner</p>'))).toContain('Sarah Lee|Owner');
  });
});

describe('extractPeople: team cards', () => {
  it('pairs a name heading with the title next to it', () => {
    const html = page(`<div class="team"><div class="member"><h3>Sarah Lee</h3><p>Owner &amp; Principal Dentist</p></div>
      <div class="member"><h3>Tom Brown</h3><span>Dental Hygienist</span></div></div>`);
    expect(names(html)).toEqual(['Sarah Lee|Owner & Principal Dentist', 'Tom Brown|Dental Hygienist']);
  });
  it('handles the title above the name', () => {
    expect(names(page('<div><p class="role">Founder</p><h4>Maria Garcia</h4></div>'))).toContain('Maria Garcia|Founder');
  });
  it('splits credentials off the name', () => {
    const p = extractPeople(page('<div><h3>Sarah Lee, DDS</h3><p>Principal Dentist</p></div>'), U, 'Smile Dental');
    expect(p[0]).toMatchObject({ name: 'Sarah Lee', title: 'Principal Dentist' });
  });
  it('does not take a heading like "Meet Our Austin Dentist" as a job title', () => {
    const p = extractPeople(page('<div><h3>Dr. Vincent Ip</h3><p>Meet Our Austin Dentist</p></div>'), U, 'Smile360');
    expect(p[0]).toMatchObject({ name: 'Dr. Vincent Ip' });
    expect(p[0].title).toBeUndefined();
  });
  it('drops a "title" that is just the name again', () => {
    const p = extractPeople(page('<div><h3>Dr. Paulo Mazini</h3><p>Dr. Paulo Mazini</p></div>'), U, 'Aloha Dental');
    expect(p[0].name).toBe('Dr. Paulo Mazini');
    expect(p[0].title).toBeUndefined();
  });
  it('finds the owner when the business is named after them', () => {
    expect(extractPeople(page('<div><h2>David Gordon, DDS</h2><p>Owner</p></div>'), U, 'Dr David Gordon')[0]).toMatchObject({ name: 'David Gordon', title: 'Owner' });
  });
  it('ignores headings that are not names', () => {
    expect(names(page('<h3>Our Services</h3><p>Owner operated since 1999</p><h3>Contact Us</h3><p>Manager on duty</p>'))).toEqual([]);
  });
});

describe('extractPeople: sentences', () => {
  it('finds "NAME is the owner"', () => {
    expect(names(page('<p>Dr. Sarah Lee is the owner and lead dentist at our practice.</p>')).join()).toMatch(/Dr\. Sarah Lee\|owner/i);
  });
  it('finds "founded by NAME"', () => {
    const p = extractPeople(page('<p>The company was founded by John Smith in 2005.</p>'), U, 'Acme Roofing');
    expect(p[0]).toMatchObject({ name: 'John Smith', title: 'Founder', confidence: 'Medium' });
  });
  it('finds "NAME, TITLE" and "TITLE: NAME"', () => {
    expect(names(page('<p>Call Anna Kowalski, Practice Manager, for help.</p>')).join()).toContain('Anna Kowalski|Practice Manager');
    expect(names(page('<p>Owner: Peter Jones</p>')).join()).toContain('Peter Jones|Owner');
  });
  it('does not invent people from ordinary text', () => {
    expect(names(page('<p>We offer Dental Implants and Teeth Whitening. Call Today for a Free Quote. Open Monday to Friday.</p>'))).toEqual([]);
  });
});

describe('extractPeople: ranking and limits', () => {
  it('lists owners and founders first, dedupes, caps at 6', () => {
    const cards = ['Tom Brown|Hygienist', 'Ann Lee|Receptionist', 'Bob Ray|Assistant', 'Cy Dee|Assistant', 'Di Fox|Assistant', 'Ed Gu|Assistant', 'Flo Hu|Assistant'].map(s => { const [n, t] = s.split('|'); return `<div><h3>${n}</h3><p>${t}</p></div>`; }).join('');
    const html = page(cards + '<div><h3>Sarah Lee</h3><p>Owner</p></div><p>Sarah Lee is the owner.</p>');
    const p = extractPeople(html, U, 'Smile Dental');
    expect(p[0].name).toBe('Sarah Lee');
    expect(p.filter(x => x.name === 'Sarah Lee')).toHaveLength(1);
    expect(p.length).toBeLessThanOrEqual(6);
  });
  it('keeps a short evidence snippet and never an email', () => {
    const p = extractPeople(page('<div><h3>Sarah Lee</h3><p>Owner</p><a href="mailto:sarah@smile.example">email</a></div>'), U, 'Smile Dental');
    expect(p[0].evidence).toBeTruthy();
    expect(JSON.stringify(p)).not.toContain('@');
  });
  it('returns [] for empty or non-html input', () => {
    expect(extractPeople('', U, 'X')).toEqual([]);
    expect(extractPeople('just some text', U, 'X')).toEqual([]);
  });
});

describe('extractFromPages', () => {
  it('merges the same person across pages, keeping the owner title and one entry', () => {
    const p = extractFromPages([
      { url: 'https://smile.example/', html: page('<div><h3>David Frank</h3><p>Dentist</p></div>') },
      { url: 'https://smile.example/about', html: page('<div><h3>Dr. David Frank</h3><p>Owner &amp; Dentist</p></div>') },
    ], 'Smile Dental');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ name: 'Dr. David Frank', title: 'Owner & Dentist' });
  });
  it('drops a job title that is just the person\'s name (seen in real structured data)', () => {
    const html = page(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Person', name: 'Dr. Paulo Mazini', jobTitle: 'Dr. Paulo Mazini' })}</script>`);
    expect(extractFromPages([{ url: U, html }], 'Aloha Dental')[0].title).toBeUndefined();
  });
  it('caps at 6 and is empty for no pages', () => {
    expect(extractFromPages([], 'X')).toEqual([]);
  });
});

describe('isLeaderTitle', () => {
  it('knows who runs the business', () => {
    for (const t of ['Owner', 'Co-Founder', 'President', 'CEO', 'COO', 'Managing Partner', 'Principal Dentist', 'Owner/Vice President', 'Practice Manager', 'Director']) expect(isLeaderTitle(t), t).toBe(true);
  });
  it('does not take staff and admin roles for decision makers', () => {
    for (const t of ['Manager, Credentialing', 'Hygienist', 'Dentist', 'Receptionist', 'Chief Information Officer', 'Credentialing Coordinator', undefined]) expect(isLeaderTitle(t as string | undefined), String(t)).toBe(false);
  });
});

describe('findTeamLinks', () => {
  const home = `<a href="/our-team">Meet the Team</a><a href="/about-us">About</a><a href="/services">Services</a><a href="/contact">Contact</a>
    <a href="https://other.example/team">Partner team</a><a href="/blog/team-lunch">Blog</a><a href="/staff.pdf">Staff</a><a href="/about-us#top">About again</a>`;
  it('picks same-site team/about pages, team first, no duplicates, max 2', () => {
    expect(findTeamLinks(home, 'https://www.smile.example/')).toEqual(['https://www.smile.example/our-team', 'https://www.smile.example/about-us']);
  });
  it('skips other sites, files and blog posts', () => {
    const l = findTeamLinks(home, 'https://smile.example/');
    expect(l.join()).not.toMatch(/other\.example|\.pdf|blog/);
  });
  it('returns [] when there is nothing to follow', () => expect(findTeamLinks('<a href="/services">Services</a>', 'https://smile.example')).toEqual([]));
});

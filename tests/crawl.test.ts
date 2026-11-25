import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async (h: string) => [{ address: '93.184.216.34', family: 4 }]) }));
import { crawlSite, crawlPeoplePages, extractFromHtml, get } from '../lib/crawl';

beforeEach(() => vi.restoreAllMocks());

const page = (body: string) => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => body }) as any;

describe('extractFromHtml', () => {
  it('finds mailto and text emails, filters junk', () => {
    const r = extractFromHtml(`<a href="mailto:Info@Shop.com?subject=x">m</a> call bob@shop.com
      <img src="logo@2x.png"> a@sentry.io you@example.com`);
    expect(r.emails).toEqual(['info@shop.com', 'bob@shop.com']);
  });
  it('extracts instagram handle, ignores posts/reels', () => {
    expect(extractFromHtml('<a href="https://www.instagram.com/p/abc">x</a><a href="https://instagram.com/shopname/">i</a>').instagram).toBe('shopname');
    expect(extractFromHtml('<a href="https://instagram.com/reel/xyz">x</a>').instagram).toBeUndefined();
  });
});

describe('crawlSite', () => {
  it('collects from home and /contact', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) =>
      u.endsWith('/contact') ? page('<a href="mailto:c@biz.com">c</a>') : page('<a href="https://instagram.com/biz">ig</a>')));
    const r = await crawlSite('https://biz.com');
    expect(r.emails).toEqual(['c@biz.com']);
    expect(r.instagram).toBe('biz');
    expect(r.html).toContain('instagram.com');
    expect(r.allHtml).toContain('mailto:c@biz.com');
    expect(r.fetched).toEqual(['https://biz.com', 'https://biz.com/contact']);
  });
  it('never throws on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await crawlSite('https://down.example')).toEqual({ emails: [], html: '', allHtml: '', fetched: [] });
  });
  it('ignores non-html', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: { get: () => 'application/pdf' }, text: async () => 'a@b.com' })));
    expect((await crawlSite('https://x.example')).emails).toEqual([]);
  });
});

describe('crawlSite SSRF', () => {
  it('does not fetch private hosts', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await crawlSite('http://127.0.0.1:3000')).toEqual({ emails: [], html: '', allHtml: '', fetched: [] });
    expect(f).not.toHaveBeenCalled();
  });
  it('blocks redirect to private ip', async () => {
    const f = vi.fn(async (_u: string) => ({ ok: false, status: 302, headers: { get: (h: string) => (h === 'location' ? 'http://169.254.169.254/' : null) }, text: async () => '' }));
    vi.stubGlobal('fetch', f);
    expect((await crawlSite('https://public.example')).emails).toEqual([]);
    expect(f.mock.calls.every(c => !String(c[0]).includes('169.254'))).toBe(true);
  });
});

describe('get: size cap', () => {
  it('stops reading a huge page at 1 MB instead of downloading all of it', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(100_000));
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (pulled++ < 40) c.enqueue(chunk); else c.close(); } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html' } })));
    const html = await get('https://big.example');
    expect(html!.length).toBeLessThanOrEqual(1_000_000);
    expect(html!.length).toBeGreaterThan(900_000);
    expect(pulled).toBeLessThan(20); // 4 MB offered, about 1 MB read
  });
  it('still reads a normal page, and a response without a stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>héllo</html>', { headers: { 'content-type': 'text/html' } })));
    expect(await get('https://ok.example')).toBe('<html>héllo</html>');
    vi.stubGlobal('fetch', vi.fn(async () => page('<p>plain</p>')));
    expect(await get('https://ok.example')).toBe('<p>plain</p>');
  });
});

describe('crawlPeoplePages: pages to read', () => {
  const html = (t: string) => new Response(`<html><body>${t}</body></html>`, { headers: { 'content-type': 'text/html' } });
  const notFound = () => new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });

  it('follows the team link on the home page and does not guess other pages', async () => {
    const f = vi.fn(async (u: string) => u.endsWith('/our-team') ? html('<h3>Sarah Lee</h3>') : u === 'https://biz.example/' || u === 'https://biz.example' ? html('<a href="/our-team">Our team</a>') : notFound());
    vi.stubGlobal('fetch', f);
    const pages = await crawlPeoplePages('https://biz.example');
    expect(pages.map(p => p.url)).toEqual(['https://biz.example', 'https://biz.example/our-team']);
    expect(f.mock.calls.map(c => c[0]).some(u => /about-us|\/about$|\/team$/.test(String(u)))).toBe(false);
  });
  it('guesses /about, /about-us and /team when the home page links to none of them (menus built by script)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u.endsWith('/about')) return html('<h2>Jo Park, Owner</h2>');
      if (u.endsWith('/about-us') || u.endsWith('/team')) return notFound();
      return html('<div id="app"></div>');
    }));
    const pages = await crawlPeoplePages('https://spa.example');
    expect(pages.map(p => p.url)).toEqual(['https://spa.example', 'https://spa.example/about']);
  });
  it('ignores a guessed page that is only the home page again (a script-built site answers every path with the same shell)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => html('<div id="app"></div>')));
    expect((await crawlPeoplePages('https://spa.example')).map(p => p.url)).toEqual(['https://spa.example']);
  });
  it('never throws, and returns nothing for a site that is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await crawlPeoplePages('https://down.example')).toEqual([]);
  });
});

describe('crawlSite: where the site really ends up', () => {
  const html = (b: string) => new Response(`<html><body>${b}</body></html>`, { headers: { 'content-type': 'text/html' } });
  it('reports the address after redirects, so an http:// listing that moves to https:// is known to be secure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (u === 'http://biz.example') return new Response('', { status: 301, headers: { location: 'https://biz.example/' } });
      if (u === 'http://biz.example/contact') return new Response('', { status: 301, headers: { location: 'https://biz.example/contact' } });
      return html('hello');
    }));
    const r = await crawlSite('http://biz.example');
    expect(r.finalUrl).toBe('https://biz.example/');
  });
  it('reports http:// when the site really stays there, and nothing when it cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => html('hello')));
    expect((await crawlSite('http://plain.example')).finalUrl).toBe('http://plain.example');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect((await crawlSite('http://down.example')).finalUrl).toBeUndefined();
  });
});

describe('crawlSite: the booking page', () => {
  const html = (b: string) => new Response(`<html><body>${b}</body></html>`, { headers: { 'content-type': 'text/html' } });
  it('also reads the site\'s own booking page when the home page links to one', async () => {
    const f = vi.fn(async (u: string) => u.endsWith('/book-an-appointment') ? html('<iframe src="https://calendly.com/x"></iframe>')
      : u.endsWith('/contact') ? html('contact') : html('<a href="/book-an-appointment">Book Appointment</a>'));
    vi.stubGlobal('fetch', f);
    const r = await crawlSite('https://biz.example');
    expect(r.fetched).toContain('https://biz.example/book-an-appointment');
    expect(r.allHtml).toContain('calendly.com');
  });
  it('does not read a booking link that goes to another site or back to /contact, and reads at most one booking page', async () => {
    const f = vi.fn(async (u: string) => html('<a href="https://other.example/book">Book now</a><a href="/contact">Book a visit</a><a href="/booking">Book</a><a href="/appointments">Book online</a>'));
    vi.stubGlobal('fetch', f);
    const r = await crawlSite('https://biz.example');
    expect(r.fetched).toEqual(['https://biz.example', 'https://biz.example/contact', 'https://biz.example/appointments']); // the link labelled "Book online" wins
  });
});

describe('findBookingPage', () => {
  it('prefers a real Book button, skips terms and policy pages, and only skips pages already read', async () => {
    const { findBookingPage } = await import('../lib/crawl');
    const home = '<a href="/booking-terms/">Booking Terms and Conditions</a><a href="/wedding-bookings/">pricing & bookings</a>';
    expect(findBookingPage(home, 'https://hb.example/')).toBe('https://hb.example/wedding-bookings/');
    expect(findBookingPage('<a href="/contact-us/#book">Book An Appointment</a>', 'https://cs.example/', ['https://cs.example/contact'])).toBe('https://cs.example/contact-us/');
    expect(findBookingPage('<a href="/contact">Book a visit</a>', 'https://cs.example/', ['https://cs.example/contact'])).toBeUndefined();
    expect(findBookingPage('<a href="/services">Services</a><a href="/book-now">Book now</a>', 'https://x.example/')).toBe('https://x.example/book-now');
  });
});

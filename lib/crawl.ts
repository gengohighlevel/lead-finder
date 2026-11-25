import * as cheerio from 'cheerio';
import { assertPublicUrl } from './safeUrl';
import { extractFacebook } from './evidence';
import { findTeamLinks } from './people';
import { BOOK_TEXT } from './siteAnalysis';

const JUNK = /(\.(png|jpe?g|gif|svg|webp|css|js)$|sentry|wixpress|example\.|domain\.com|@2x|@3x|yourname|email@)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const MAX_BYTES = 1_000_000;

export function extractFromHtml(html: string): { emails: string[]; instagram?: string } {
  const found: string[] = [];
  const $ = cheerio.load(html);
  $('a[href^="mailto:"]').each((_, el) => {
    const v = ($(el).attr('href') ?? '').slice(7).split('?')[0].trim();
    if (v) found.push(v);
  });
  for (const m of html.match(EMAIL_RE) ?? []) found.push(m);
  const emails = [...new Set(found.map(e => e.toLowerCase()).filter(e => !JUNK.test(e)))];

  let instagram: string | undefined;
  for (const m of html.matchAll(/instagram\.com\/([A-Za-z0-9._]+)/gi)) {
    const h = m[1];
    if (['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'sharer'].includes(h.toLowerCase())) continue;
    instagram = h; break;
  }
  return { emails, instagram };
}

/** The page text, at most MAX_BYTES. A huge page is cancelled after the cap instead of being downloaded whole. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body?.getReader) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.byteLength;
    }
  } finally { reader.cancel().catch(() => {}); }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}

/** The page text and the address it was finally served from (after redirects). */
export async function fetchPage(url: string): Promise<{ html: string; url: string } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 7000); // slowest healthy site in a timing run took 5.8s
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      await assertPublicUrl(current); // re-checked on every redirect hop
      const res = await fetch(current, { signal: ctl.signal, headers: { 'User-Agent': 'lead-finder/1.0' }, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return null;
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) return null;
      if (!(res.headers.get('content-type') ?? '').includes('html')) return null;
      return { html: await readCapped(res), url: current };
    }
    return null;
  } catch { return null; } finally { clearTimeout(t); }
}

export async function get(url: string): Promise<string | null> { return (await fetchPage(url))?.html ?? null; }

export type CrawlResult = { emails: string[]; instagram?: string; facebook?: string; html: string; allHtml: string; fetched: string[]; /** Where the home page was finally served from, after redirects (http:// or https://). */ finalUrl?: string };
const EMPTY: CrawlResult = { emails: [], html: '', allHtml: '', fetched: [] };

/** The site's own booking page, if the home page links to one (so "no booking calendar" is never claimed without reading it). */
export function findBookingPage(html: string, base: string, skip: string[] = []): string | undefined {
  let b: URL;
  try { b = new URL(base); } catch { return undefined; }
  const host = (h: string) => h.replace(/^www\./, '').toLowerCase();
  const norm = (u: string) => u.replace(/\/+$/, '');
  const skipped = new Set(skip.map(norm));
  const $ = cheerio.load(html || '');
  const byText: string[] = [], byPath: string[] = [];
  for (const a of $('a[href]').toArray()) {
    try {
      const u = new URL($(a).attr('href')!, b);
      u.hash = '';
      if (!/^https?:$/.test(u.protocol) || host(u.hostname) !== host(b.hostname)) continue;
      const path = u.pathname.replace(/\/+$/, '');
      if (!path || skipped.has(norm(u.toString())) || /(terms|policy|privacy|conditions|cancellation|faq|blog)/i.test(path)) continue;
      if (BOOK_TEXT.test($(a).text().replace(/\s+/g, ' ').trim())) byText.push(u.toString());
      else if (/(book|appointment|schedul|reserv)/i.test(path)) byPath.push(u.toString());
    } catch { /* bad href */ }
  }
  return byText[0] ?? byPath[0]; // a real "Book" button first, then a page whose address says booking
}

export async function crawlSite(url: string): Promise<CrawlResult> {
  try {
    const base = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const contact = new URL('/contact', base).toString();
    const [homeP, contP] = await Promise.all([fetchPage(base), fetchPage(contact)]);
    const home = homeP?.html ?? null, cont = contP?.html ?? null;
    const bookingUrl = home ? findBookingPage(home, homeP!.url, [base, contact, homeP!.url]) : undefined;
    const booking = bookingUrl ? (await fetchPage(bookingUrl))?.html ?? null : null;
    const pages = ([[base, home], [contact, cont], ...(bookingUrl ? [[bookingUrl, booking]] : [])] as [string, string | null][]).filter(([, h]) => h);
    if (!pages.length) return { ...EMPTY };
    const emails = new Set<string>();
    let instagram: string | undefined, facebook: string | undefined;
    for (const [, h] of pages) {
      const r = extractFromHtml(h!);
      r.emails.forEach(e => emails.add(e));
      instagram ??= r.instagram;
      facebook ??= extractFacebook(h!);
    }
    return {
      emails: [...emails], ...(instagram ? { instagram } : {}), ...(facebook ? { facebook } : {}),
      html: home ?? '', allHtml: pages.map(([, h]) => h).join('\n'), fetched: pages.map(([u]) => u),
      finalUrl: (homeP ?? contP)!.url,
    };
  } catch { return { ...EMPTY }; }
}

// Used only when the home page links to no team or about page (menus built by script do not show up in the page source).
const GUESSED_PAGES = ['/about', '/about-us', '/team'];

/** The home page plus up to two team or about pages: what the people finder reads. */
export async function crawlPeoplePages(url: string): Promise<{ url: string; html: string }[]> {
  try {
    const base = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const home = await get(base);
    if (!home) return [];
    let links = findTeamLinks(home, base);
    if (!links.length) links = GUESSED_PAGES.map(p => new URL(p, base).toString());
    const more = await Promise.all(links.map(async l => ({ url: l, html: (await get(l)) ?? '' })));
    // a script-built site answers every path with the same empty shell: that is not a second page
    return [{ url: base, html: home }, ...more.filter(p => p.html && p.html !== home)];
  } catch { return []; }
}

import * as cheerio from 'cheerio';

export type GhlStatus = 'likely' | 'potential' | 'insufficient';

/**
 * Signs that a business uses GoHighLevel (LeadConnector), read from the pages we fetched. A sign suggests use; it never
 * confirms a subscription, and a business can use GHL with nothing visible. Only things the page actually loads or embeds
 * count (scripts, frames, form actions, hosted widgets): words in the text, a comment or a link to gohighlevel.com do not.
 * Learned from four real GHL sites: form embeds (api.leadconnectorhq.com/widget/form/<id>), link.msgsndr.com scripts, call
 * tracking (backend.leadconnectorhq.com/appengine/loc/…) and a white-label host (link.<other brand>/widget/form/<id>).
 */
const GHL_HOSTS = ['leadconnectorhq.com', 'msgsndr.com'];
const GHL_BRAND_HOSTS = ['gohighlevel.com', 'highlevel.com'];
const FILESAFE = 'filesafe.space';
// A hosted GHL widget on ANY domain (white-label brands serve these under their own name). The id is long, which rules out ordinary pages.
const WIDGET_PATH = /\/widget\/(?:form|forms|booking|bookings|survey|calendar|quiz|reputation)\/[A-Za-z0-9_-]{15,}/i;

const hostIn = (host: string, d: string) => host === d || host.endsWith(`.${d}`);
const parse = (v: string): URL | undefined => { try { return new URL(v.trim().startsWith('//') ? `https:${v.trim()}` : v.trim(), 'https://placeholder.invalid/'); } catch { return undefined; } };

export type GhlFacts = { status: GhlStatus; evidence: string[]; /** Third-party hosts serving GHL widgets: worth a DNS look (see ghlDns.ts) */ dnsHosts: string[] };

export function detectGhl(html: string | null): GhlFacts {
  if (!html) return { status: 'insufficient', evidence: [], dnsHosts: [] };
  const $ = cheerio.load(html);
  const found: { el: string; url: URL }[] = [];
  // Every address in every attribute of every tag: cookie plugins move a script's address into data-*-src, a form can sit in an
  // srcdoc, and GHL's image storage turns up in meta tags and inline styles. Only whole addresses count, not words.
  const URL_IN_VALUE = /(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s"'<>()\\]*)?/gi;
  const add = (el: string, value: string) => {
    for (const m of value.matchAll(URL_IN_VALUE)) { const url = parse(m[0]); if (url && url.hostname !== 'placeholder.invalid') found.push({ el, url }); }
  };
  $('*').each((_, e) => {
    const tag = (e as { tagName?: string }).tagName ?? '';
    for (const [name, value] of Object.entries((e as { attribs?: Record<string, string> }).attribs ?? {})) {
      if (!value || /^(mailto|tel|javascript):/i.test(value.trim())) continue;
      // a plain link (an <a href>) is a link; anything else the page points at is something it loads
      add(tag === 'a' && name === 'href' ? 'a' : name === 'srcdoc' ? 'srcdoc' : tag, value);
    }
  });
  const inline = $('script:not([src])').toArray().map(s => $(s).html() ?? '').join('\n');

  const strong = new Set<string>(), weak = new Set<string>(), dns = new Set<string>();
  for (const { el, url } of found) {
    const host = url.hostname.toLowerCase(), path = url.pathname;
    const embed = el !== 'a';                        // a script, frame, image or form action, not just a link
    if (hostIn(host, 'leadconnectorhq.com')) strong.add('leadconnectorhq.com script/widget found (GHL)');
    else if (hostIn(host, 'msgsndr.com')) strong.add('msgsndr.com link/form found (GHL)');
    else if (GHL_BRAND_HOSTS.some(d => hostIn(host, d))) (embed ? strong.add('gohighlevel.com tool embedded (GHL)') : weak.add('links to gohighlevel.com (no GHL tool embedded)'));
    else if (hostIn(host, FILESAFE)) strong.add('assets on filesafe.space (GHL media CDN)');
    if (WIDGET_PATH.test(path)) { strong.add(`GHL-style hosted form/booking widget (${host})`); if (!GHL_HOSTS.some(d => hostIn(host, d))) dns.add(host); }
    if (/\/js\/form_embed\.js$/i.test(path)) { strong.add('GHL form embed script'); if (!GHL_HOSTS.some(d => hostIn(host, d))) dns.add(host); }
    if (/\/js\/external-tracking\.js$/i.test(path)) { strong.add('GHL tracking script'); if (!GHL_HOSTS.some(d => hostIn(host, d))) dns.add(host); }
    if (/\/appengine\/loc\//i.test(path)) strong.add('GHL call tracking (appengine/loc)');
  }
  // things a script names in its own code (call tracking, widget loaders)
  for (const m of inline.matchAll(/(?:https?:)?\/\/((?:[a-z0-9-]+\.)*(leadconnectorhq|msgsndr)\.com)(\/[^\s"'`)]*)?/gi)) {
    if (/\/appengine\/loc\//i.test(m[3] ?? '')) strong.add('GHL call tracking (appengine/loc)');
    else strong.add(m[2].toLowerCase() === 'msgsndr' ? 'msgsndr.com link/form found (GHL)' : 'leadconnectorhq.com script/widget found (GHL)');
  }
  const evidence = [...strong, ...weak];
  return { status: strong.size ? 'likely' : 'potential', evidence, dnsHosts: [...dns] };
}

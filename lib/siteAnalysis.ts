import * as cheerio from 'cheerio';
import type { Process } from './evidence';

/**
 * What can honestly be said about a business website from the pages we read (the home page and /contact).
 * Three kinds of answer, never mixed:
 *  - processes: things directly SEEN on a page (a booking tool, a contact form, a chat widget...). Each is backed by the page's own code or visible text.
 *  - gaps: things NOT found, claimed only when the page is an ordinary one where the thing would show up in its source.
 *  - unchecked: things we could not judge (script-built pages, website builders with built-in features, parked domains).
 * A page's source is not what a visitor sees: many sites build their pages, chat and booking by script. So "not found" is only
 * claimed where it is a fair claim, and always means "not found on the home or contact page".
 */
export type SiteFacts = { processes: Process[]; gaps: string[]; unchecked?: { signals: string[]; reason: string } };

const BOOKING_HOSTS = ['calendly.com', 'acuityscheduling.com', 'squarespacescheduling.com', 'square.site', 'squareup.com', 'booksy.com', 'setmore.com', 'mindbodyonline.com',
  'vagaro.com', 'fresha.com', 'janeapp.com', 'zocdoc.com', 'nexhealth.com', 'simplybook.me', 'simplybook.it', 'schedulicity.com', 'gettimely.com', 'oncehub.com', 'cal.com',
  'tidycal.com', 'youcanbook.me', '10to8.com', 'bookwhen.com', 'timetap.com', 'phorest.com', 'salonized.com', 'planity.com', 'noona.is', 'noona.app', 'cliniko.com', 'nookal.com',
  'hotdoc.com.au', 'healthengine.com.au', 'modento.io', 'praktika.net.au', 'corepractice.is', 'zenoti.com', 'opentable.com', 'resy.com', 'exploretock.com', 'tockhq.com',
  'sevenrooms.com', 'resdiary.com', 'rezdy.com', 'fareharbor.com', 'bookeo.com', 'appointy.com', 'koalendar.com', 'vcita.com', 'booker.com', 'styleseat.com', 'glossgenius.com',
  'appointlet.com', 'reservio.com', 'meetings.hubspot.com', 'booksteam.com', 'treatwell.com', 'treatwell.co.uk', 'centaurportal.com', 'hoys.io', 'dentally.co',
  // holiday-rental direct-booking engines
  'lodgify.com', 'hostaway.com', 'ownerrez.com', 'guesty.com', 'smoobu.com', 'beds24.com', 'bookingsync.com', 'rentalsunited.com', 'uplisting.io', 'hospitable.com'];
// A 'Book' link to one of these is not a booking system (a page, a map, a chat).
const NOT_BOOKING_HOSTS = ['facebook.com', 'fb.com', 'instagram.com', 'google.com', 'goo.gl', 'g.page', 'maps.apple.com', 'bing.com', 'youtube.com', 'twitter.com', 'x.com',
  'linkedin.com', 'tiktok.com', 'wa.me', 'whatsapp.com', 'm.me', 'messenger.com', 'yelp.com', 'tripadvisor.com', 'pinterest.com'];
const BOOKING_PATH = /(appointment|booking|schedul|reserv)/i;
const CHAT_HOSTS = ['tawk.to', 'intercom.io', 'intercomcdn.com', 'drift.com', 'driftt.com', 'crisp.chat', 'tidio.co', 'tidiochat.com', 'livechatinc.com', 'olark.com', 'zdassets.com',
  'zopim.com', 'freshchat.com', 'smartsupp.com', 'jivosite.com', 'chatra.com', 'purechat.com', 'userlike.com', 'manychat.com', 'usemessages.com', 'gorgias.chat', 'chatbase.co',
  'landbot.io', 'botpress.cloud', 'voiceflow.com', 'kommunicate.io', 'beacon-v2.helpscout.net', 'connect.podium.com', 'birdeye.com', 'chatwoot.com', 'widget.trengo.eu'];
const MESSAGING_HOSTS = ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'wa.link', 'm.me'];
const ANALYTICS_HOSTS = ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com', 'googleadservices.com', 'doubleclick.net', 'connect.facebook.net', 'plausible.io',
  'matomo.cloud', 'hotjar.com', 'clarity.ms', 'segment.com', 'segment.io', 'hs-scripts.com', 'hs-analytics.net', 'mixpanel.com', 'posthog.com', 'analytics.tiktok.com',
  'sc-static.net', 'ads-twitter.com', 'snap.licdn.com', 'px.ads.linkedin.com', 'fullstory.com', 'mouseflow.com', 'crazyegg.com'];

export const BOOK_TEXT = /\b(book (now|online|today|here|your|an?|appointment)|schedule (an? )?(appointment|consultation|visit)|make an appointment|request an appointment|online booking)\b/i;
const QUOTE_TEXT = /(get a (free )?quote|request a quote|free estimate|get an estimate|request (an )?estimate|free quote)/i;
const ANALYTICS_INLINE = /(\bgtag\(|\bfbq\(|\b_gaq\b|\bwindow\.dataLayer\b|\bdataLayer\s*=|\bga\(\s*['"]create)/;
const BUILDER = /(wixstatic\.com|parastorage\.com|\bwix\.com|squarespace\.com|sqspcdn\.com|weebly\.com|wsimg\.com|secureserver\.net|multiscreensite\.com|dudaone\.com|webflow\.(?:com|io)|jimdo(?:site)?\.com|strikingly\.com|site123\.|carrd\.co|myshopify\.com|cdn\.shopify\.com)/i;
const PARKED = /(this domain (is|may be) for sale|domain (is )?for sale|buy this domain|domain parking|parked (free|domain)|hugedomains|sedoparking|parkingcrew|LANDER_SYSTEM|afternic\.com|dan\.com\/buy)/i;
const IG_SKIP = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'sharer', 'sharer.php']);

const hostIn = (host: string, list: string[]) => list.some(d => host === d || host.endsWith(`.${d}`));
const parse = (v: string): URL | undefined => { try { return new URL(v.trim(), 'https://placeholder.invalid/'); } catch { return undefined; } };

/** Every address the page points at (scripts, frames, links, form actions). */
function addresses($: cheerio.CheerioAPI): { el: string; url: URL; raw: string; widget: boolean }[] {
  const out: { el: string; url: URL; raw: string; widget: boolean }[] = [];
  $('[src],[href],[data-src],[action]').each((_, e) => {
    const $e = $(e), tag = (e as { tagName?: string }).tagName ?? '';
    for (const a of ['src', 'href', 'data-src', 'action']) {
      const raw = $e.attr(a);
      if (!raw || /^(javascript|data):/i.test(raw)) continue;
      const url = parse(raw);
      if (url) out.push({ el: tag, url, raw, widget: $e.attr('data-widget-id') !== undefined });
    }
  });
  return out;
}

function visibleText($: cheerio.CheerioAPI): string {
  const c = $.root().clone();
  c.find('script,style,noscript,template').remove();
  return c.find('body').text().replace(/\s+/g, ' ').trim();
}

function hasContactForm($: cheerio.CheerioAPI): boolean {
  return $('form').toArray().some(f => {
    const $f = $(f);
    if (/search/i.test($f.attr('role') ?? '') || $f.find('input[type=search]').length || $f.find('input[type=password]').length) return false;
    const message = $f.find('textarea').length > 0;
    const contactInput = $f.find('input[type=email],input[type=tel]').length > 0;
    const otherText = $f.find('input').filter((_, i) => !/^(hidden|submit|button|checkbox|radio|email|tel|search|password|image|reset|file)$/i.test($(i).attr('type') ?? 'text')).length > 0;
    return message || (contactInput && otherText);
  });
}

type Input = { website?: string; finalUrl?: string; home: string; allHtml: string };

export function analyseSite(i: Input): SiteFacts {
  const main = i.home || i.allHtml;
  if (!main) return { processes: [], gaps: [] };                      // unreachable: nothing is claimed

  const $all = cheerio.load(i.allHtml || main);
  const $main = cheerio.load(main);
  const mainText = visibleText($main);

  if (PARKED.test(main)) {
    return { processes: [], gaps: [], unchecked: { signals: ['no_booking', 'no_chat', 'no_analytics', 'no_instagram', 'not_mobile'], reason: 'The domain looks parked or for sale, not a live business site, so nothing is claimed about it.' } };
  }

  const addrs = addresses($all);
  const hosts = addrs.map(a => ({ ...a, host: a.url.hostname.toLowerCase() }));
  const allText = visibleText($all);

  // ---- seen ----
  const processes: Process[] = [];
  if (hasContactForm($all)) processes.push('contact_form');
  if (QUOTE_TEXT.test(allText)) processes.push('quote_request');
  const site = ((i.finalUrl ?? i.website ?? '').match(/^(?:https?:\/\/)?([^/?#]+)/i)?.[1] ?? '').toLowerCase().replace(/^www\./, '');
  const thirdParty = (a: { raw: string; host: string }) => /^(https?:)?\/\//i.test(a.raw) && a.host.replace(/^www\./, '') !== site;
  const bookingTool = hosts.some(a => hostIn(a.host, BOOKING_HOSTS) || /\/widget\/booking\b/i.test(a.url.pathname)
      // an embedded scheduler from any provider
      || ((a.el === 'script' || a.el === 'iframe') && thirdParty(a) && BOOKING_PATH.test(a.host + a.url.pathname)))
    // a 'Book' button that leads to another website (or a booking subdomain) is a booking system, whatever its brand
    || $all('a[href]').toArray().some(e => {
      const raw = $all(e).attr('href') ?? '';
      const url = parse(raw);
      if (!url || !BOOK_TEXT.test($all(e).text().replace(/\s+/g, ' ').trim())) return false;
      const host = url.hostname.toLowerCase();
      return thirdParty({ raw, host }) && !hostIn(host, NOT_BOOKING_HOSTS);
    });
  if (bookingTool) processes.push('online_booking');
  const bookingLink = $all('a,button').toArray().some(e => BOOK_TEXT.test($all(e).text().replace(/\s+/g, ' ').trim()));
  if (bookingLink && !bookingTool) processes.push('booking_link');
  const chat = hosts.some(a => (a.el === 'script' || a.el === 'iframe') && (hostIn(a.host, CHAT_HOSTS)
    || (hostIn(a.host, ['leadconnectorhq.com']) && (a.widget || /chat/i.test(a.raw)))));
  if (chat) processes.push('live_chat');
  if (hosts.some(a => a.el === 'a' && hostIn(a.host, MESSAGING_HOSTS))) processes.push('messaging_link');
  if ($all('a[href^="tel:" i]').length) processes.push('phone_link');
  if ($all('a[href^="mailto:" i]').length) processes.push('email_link');

  // ---- could we tell? ----
  const shell = mainText.length < 250;
  const builder = BUILDER.test(main);
  const gtm = /googletagmanager\.com\/gtm\.js/i.test(main);
  const consentHeld = $main('script[type="text/plain"]').length > 0;
  const reasons: string[] = [];
  if (shell) reasons.push('This page is built by script and shows almost no text in its source, so its source does not show what a visitor sees.');
  if (builder) reasons.push('Built on a website-builder (Wix, GoDaddy, Squarespace and similar): its booking, chat, Instagram and statistics features run by script or inside the platform.');
  const blind = {
    no_booking: shell || builder,
    no_chat: shell || builder || gtm || consentHeld,
    no_analytics: true, // trackers are often added by other scripts, so the page source can never prove one is absent
    no_instagram: shell || builder,
    not_mobile: shell,
  };
  if (gtm) reasons.push('Google Tag Manager can add chat tools that the page source does not show.');
  if (consentHeld) reasons.push('Some scripts wait for the visitor to accept cookies.');

  // ---- not found ----
  const absent: Record<string, boolean> = {
    no_booking: !bookingTool,
    no_chat: !chat,
    no_analytics: !(hosts.some(a => hostIn(a.host, ANALYTICS_HOSTS) || (a.el === 'script' && /analytics/i.test(a.url.pathname)))
      || $all('script:not([src])').toArray().some(s => ANALYTICS_INLINE.test($all(s).html() ?? ''))),
    no_instagram: !addrs.some(a => { const m = a.url.hostname.match(/(?:^|\.)instagram\.com$/i) ? a.url.pathname.split('/').filter(Boolean)[0] : undefined; return !!m && !IG_SKIP.has(m.toLowerCase()); }),
    not_mobile: !$main('meta[name="viewport" i]').length,
  };
  const gaps: string[] = [];
  const unchecked: string[] = [];
  if (absent.no_analytics) reasons.push('Analytics and ad pixels are often added by other scripts, so their absence cannot be proven from the page source.');
  const finalUrl = i.finalUrl ?? i.website;
  if (finalUrl && /^http:\/\//i.test(finalUrl) && i.finalUrl) gaps.push('no_https'); // only when the site really ended on http://
  for (const k of ['no_booking', 'no_chat', 'no_analytics', 'no_instagram', 'not_mobile'] as const) {
    if (!absent[k]) continue;
    (blind[k] ? unchecked : gaps).push(k);
  }
  // a site that takes enquiries by form (or a 'Book' link to one) does take bookings, just not on a calendar: say that, not "no booking"
  const bi = gaps.indexOf('no_booking');
  if (bi >= 0 && (processes.includes('contact_form') || processes.includes('booking_link'))) gaps[bi] = 'booking_by_form';
  return { processes, gaps, ...(unchecked.length ? { unchecked: { signals: unchecked, reason: [...new Set(reasons)].join(' ') } } : {}) };
}

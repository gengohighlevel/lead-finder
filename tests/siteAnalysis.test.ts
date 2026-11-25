import { describe, it, expect } from 'vitest';
import { analyseSite, type SiteFacts } from '../lib/siteAnalysis';

const TEXT = 'We are a friendly local business offering great service to our community. '.repeat(12); // enough real text: not a script-built shell
const page = (head: string, body = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width">${head}</head><body><p>${TEXT}</p>${body}</body></html>`;
const run = (home: string, o: Partial<{ website: string; finalUrl: string; contact: string }> = {}): SiteFacts =>
  analyseSite({ website: o.website ?? 'https://biz.example', finalUrl: o.finalUrl ?? 'https://biz.example/', home, allHtml: home + (o.contact ?? '') });

describe('https: judged by where the site actually ends up', () => {
  it('flags a site that really stays on http://', () => {
    expect(run(page(''), { website: 'http://biz.example', finalUrl: 'http://biz.example/' }).gaps).toContain('no_https');
  });
  it('does NOT flag a site whose saved address was http:// but which redirects to https://', () => {
    expect(run(page(''), { website: 'http://biz.example', finalUrl: 'https://biz.example/' }).gaps).not.toContain('no_https');
  });
  it('makes no https claim when the site could not be reached', () => {
    const f = analyseSite({ website: 'http://down.example', home: '', allHtml: '' });
    expect(f.gaps).toEqual([]);
    expect(f.processes).toEqual([]);
  });
});

describe('online booking', () => {
  it('sees a real booking tool, including ones the old list missed (Timely, Modento, Fresha)', () => {
    for (const src of ['https://static.gettimely.com/tui/17.6.6/tui.js', 'https://book.modento.io/drjohncherry', 'https://www.fresha.com/book-now/marie/all-offer']) {
      const f = run(page(`<script src="${src}"></script>`));
      expect(f.processes, src).toContain('online_booking');
      expect(f.gaps, src).not.toContain('no_booking');
    }
  });
  it('sees a booking tool on the contact page too, and never says both yes and no (one set of pages for every claim)', () => {
    const f = run(page(''), { contact: page('<iframe src="https://calendly.com/biz/30min"></iframe>') });
    expect(f.processes).toContain('online_booking');
    expect(f.gaps).not.toContain('no_booking');
  });
  it('a "Book now" button that only leads to a contact page is not called online booking', () => {
    const f = run(page('', '<a href="/contact">Book Now</a>'));
    expect(f.processes).not.toContain('online_booking');
    expect(f.processes).toContain('booking_link');
    expect(f.gaps).toContain('booking_by_form'); // booking is by enquiry, not 'none at all'
    expect(f.gaps).not.toContain('no_booking');
  });
  it('a site with a contact form but no booking tool takes bookings by enquiry: it is never called "no booking"', () => {
    const f = run(page('', '<form><input name="name"><input type="email"><textarea></textarea></form>'));
    expect(f.gaps).toContain('booking_by_form');
    expect(f.gaps).not.toContain('no_booking');
  });
  it('"no online booking" is only claimed when there is no tool, no form and no Book link at all', () => {
    expect(run(page('', '<p>Call us on 07 0000 0000</p>')).gaps).toContain('no_booking');
  });
  it('"Call our practice to make an appointment" is not a booking of any kind', () => {
    const f = run(page('', '<h3>Book an appointment</h3><p>Call our practice to make an appointment</p>'));
    expect(f.processes).not.toContain('online_booking');
  });
  it('a words-only mention in a script or comment does not count', () => {
    const f = run(page('<script>var label = "book online";</script><!-- book now -->'));
    expect(f.processes).not.toContain('booking_link');
    expect(f.processes).not.toContain('online_booking');
  });
  it('a member "Bookings" login link is not a booking tool', () => {
    const f = run(page('', '<a href="/m/bookings">Bookings</a>'));
    expect(f.processes).not.toContain('online_booking');
  });
});

describe('booking systems the list does not name', () => {
  it('a Book button that goes to another website is an online booking system (Centaur Portal, Praktika...)', () => {
    for (const href of ['https://www.centaurportal.com/d4w/org-2936/extended_search?location=1', 'https://appointments.praktika.net.au/online-booking/step1', 'https://some-new-booking-app.example/biz']) {
      const f = run(page('', `<a href="${href}">Book Appointment</a>`));
      expect(f.processes, href).toContain('online_booking');
      expect(f.gaps.filter(g => /booking/.test(g)), href).toEqual([]);
    }
  });
  it('a booking subdomain of the business counts too (booking.dental99.com.au)', () => {
    const f = analyseSite({ website: 'https://dental99.com.au', finalUrl: 'https://dental99.com.au/', home: page('', '<a href="https://booking.dental99.com.au/book">Book now</a>'), allHtml: '' });
    expect(f.processes).toContain('online_booking');
  });
  it('an embedded scheduler from any provider counts', () => {
    expect(run(page('<script src="https://imagine-ortho.hoys.io/appointment-scheduler-embed.js"></script>')).processes).toContain('online_booking');
  });
  it('a Book link to Facebook, Instagram, Google Maps or the same site is not a booking system', () => {
    for (const href of ['https://www.facebook.com/biz', 'https://www.instagram.com/biz', 'https://maps.google.com/?q=biz', 'https://biz.example/contact', '/book-an-appointment']) {
      expect(run(page('', `<a href="${href}">Book now</a>`)).processes, href).not.toContain('online_booking');
    }
  });
});

describe('rental booking engines', () => {
  it('direct-booking software used by holiday-rental and boat/car rental sites counts as an online booking tool', () => {
    for (const src of ['https://app.lodgify.com/book.js', 'https://widget.hostaway.com/x.js', 'https://app.ownerrez.com/widget.js', 'https://widgets.smoobu.com/a.js', 'https://app.guesty.com/book', 'https://app.hospitable.com/w.js']) {
      expect(run(page(`<script src="${src}"></script>`)).processes, src).toContain('online_booking');
    }
  });
});

describe('contact form', () => {
  it('counts a form with a message box, or email plus another field', () => {
    expect(run(page('', '<form><input name="n"><input type="email"><textarea></textarea></form>')).processes).toContain('contact_form');
    expect(run(page('', '<form><input type="text" name="name"><input type="email"></form>')).processes).toContain('contact_form');
  });
  it('does not count a newsletter box, a search box or a login', () => {
    expect(run(page('', '<form><input type="email" placeholder="Your email"><button>Subscribe</button></form>')).processes).not.toContain('contact_form');
    expect(run(page('', '<form role="search"><input type="search"><textarea></textarea></form>')).processes).not.toContain('contact_form');
    expect(run(page('', '<form><input type="email"><input type="password"></form>')).processes).not.toContain('contact_form');
  });
  it('is not fooled by a newsletter form followed by an unrelated textarea outside any form', () => {
    const f = run(page('', '<form><input type="email"></form><div><textarea></textarea></div><form><input name="q"></form>'));
    expect(f.processes).not.toContain('contact_form');
  });
});

describe('live chat and messaging', () => {
  it('sees a chat widget script', () => {
    const f = run(page('<script src="https://embed.tawk.to/abc/def"></script>'));
    expect(f.processes).toContain('live_chat');
    expect(f.gaps).not.toContain('no_chat');
  });
  it('a WhatsApp or Messenger link is shown as a message link, not as a chat widget', () => {
    const f = run(page('', '<a href="https://wa.me/61412345678">WhatsApp us</a>'));
    expect(f.processes).toContain('messaging_link');
    expect(f.processes).not.toContain('live_chat');
  });
  it('claims "no chat" only when it can tell: a plain site with none', () => {
    expect(run(page('')).gaps).toContain('no_chat');
  });
  it('does not claim "no chat" when Google Tag Manager could be loading one', () => {
    const f = run(page('<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC"></script>'));
    expect(f.gaps).not.toContain('no_chat');
    expect(f.unchecked?.signals).toContain('no_chat');
  });
});

describe('analytics', () => {
  it('sees Google Analytics, Tag Manager, a Facebook pixel, Clarity and a site\'s own analytics script', () => {
    for (const h of ['<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>', '<script src="https://scripts.clarity.ms/0.8/clarity.js"></script>',
      '<script src="/analytics.js"></script>', '<script>fbq("init","1")</script>', '<script>window.dataLayer = window.dataLayer || [];</script>']) {
      expect(run(page(h)).gaps, h).not.toContain('no_analytics');
    }
  });
  it('NEVER claims "no analytics": trackers are often added by other scripts, so the source cannot prove they are absent (audit: 4 of 9 such claims were wrong)', () => {
    const f = run(page(''));
    expect(f.gaps).not.toContain('no_analytics');
    expect(f.unchecked?.signals).toContain('no_analytics');
    expect(f.unchecked?.reason).toMatch(/other scripts/i);
  });
  it('says nothing about analytics when a tracker is seen', () => {
    const f = run(page('<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>'));
    expect(f.gaps).not.toContain('no_analytics');
    expect(f.unchecked?.signals ?? []).not.toContain('no_analytics');
  });
  it('does not claim none on a site builder that has its own built-in statistics (GoDaddy, Wix, Squarespace)', () => {
    for (const h of ['<img src="https://img1.wsimg.com/a.png">', '<script src="https://static.parastorage.com/x.js"></script>', '<script src="//assets.squarespace.com/universal/a.js"></script>']) {
      const f = run(page(h));
      expect(f.gaps, h).not.toContain('no_analytics');
      expect(f.unchecked?.signals, h).toContain('no_analytics');
    }
  });
  it('does not claim none when scripts are held back until the visitor accepts cookies', () => {
    const f = run(page('<script type="text/plain" data-cookieconsent="statistics" src="//js.hs-scripts.com/1.js"></script>'));
    expect(f.gaps).not.toContain('no_analytics');
  });
});

describe('Instagram and mobile', () => {
  it('sees an Instagram link, ignoring post and reel links', () => {
    expect(run(page('', '<a href="https://www.instagram.com/beautybysophienz">ig</a>')).gaps).not.toContain('no_instagram');
    expect(run(page('', '<a href="https://www.instagram.com/p/abc">post</a>')).gaps).toContain('no_instagram');
  });
  it('claims no mobile support only for a real page with no viewport tag', () => {
    const noViewport = `<html><head></head><body><p>${TEXT}</p></body></html>`;
    expect(run(noViewport).gaps).toContain('not_mobile');
    expect(run(page('')).gaps).not.toContain('not_mobile');
  });
});

describe('pages that cannot be judged from their source', () => {
  const shell = '<html><head></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
  it('a script-built page with almost no text: no absence claims at all, and it says why', () => {
    const f = run(shell);
    for (const g of ['no_booking', 'no_chat', 'no_analytics', 'no_instagram', 'not_mobile']) expect(f.gaps, g).not.toContain(g);
    expect(f.unchecked?.signals).toEqual(expect.arrayContaining(['no_booking', 'no_chat', 'no_analytics', 'no_instagram', 'not_mobile']));
    expect(f.unchecked?.reason).toMatch(/script/i);
  });
  it('a parked or for-sale domain: nothing is claimed about the business', () => {
    const f = run(page('', '<h1>This domain is for sale</h1>'));
    expect(f.gaps.filter(g => g !== 'no_https')).toEqual([]);
    expect(f.processes).toEqual([]);
    expect(f.unchecked?.reason).toMatch(/parked|for sale/i);
  });
  it('a site builder: booking, chat and Instagram are not claimed absent (their widgets are built by script)', () => {
    const f = run(page('<script src="https://static.parastorage.com/x.js"></script>'));
    for (const g of ['no_booking', 'no_chat', 'no_instagram']) expect(f.gaps, g).not.toContain(g);
  });
  it('still reports what it DID see on such a page', () => {
    const f = run(page('<script src="https://static.parastorage.com/x.js"></script>', '<a href="tel:+61700000000">Call</a><a href="mailto:a@b.co">Mail</a>'));
    expect(f.processes).toEqual(expect.arrayContaining(['phone_link', 'email_link']));
  });
});

describe('other things it sees', () => {
  it('a quote offer in visible text, but not inside a script', () => {
    expect(run(page('', '<p>Call us for a free quote today</p>')).processes).toContain('quote_request');
    expect(run(page('<script>var s = "free quote";</script>')).processes).not.toContain('quote_request');
  });
  it('click-to-call and email links', () => {
    const f = run(page('', '<a href="tel:+1555">c</a><a href="mailto:a@b.co">m</a>'));
    expect(f.processes).toEqual(expect.arrayContaining(['phone_link', 'email_link']));
  });
  it('a lead with no website has one claim: none found', () => {
    expect(analyseSite({ home: '', allHtml: '' }).gaps).toEqual([]);
  });
});

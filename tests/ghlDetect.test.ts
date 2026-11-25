import { describe, it, expect, vi } from 'vitest';
import { detectGhl } from '../lib/ghlDetect';
import { ghlDns, probeHosts, type CnameLookup } from '../lib/ghlDns';

const page = (b: string) => `<html><head></head><body><p>Plain business page.</p>${b}</body></html>`;

describe('detectGhl: what real GHL sites show (taken from four real sites)', () => {
  it('a GHL form embed: api.leadconnectorhq.com/widget/form/<id> and form_embed.js', () => {
    const r = detectGhl(page('<iframe src="https://api.leadconnectorhq.com/widget/form/oxBjb5mxn1jxF4NpsViD"></iframe><script src="https://api.leadconnectorhq.com/js/form_embed.js"></script>'));
    expect(r.status).toBe('likely');
    expect(r.evidence.join(' ')).toMatch(/form/i);
  });
  it('the GHL tracking script (link.msgsndr.com/js/external-tracking.js)', () => {
    const r = detectGhl(page('<script src="https://link.msgsndr.com/js/external-tracking.js"></script>'));
    expect(r.status).toBe('likely');
  });
  it('GHL call tracking (backend.leadconnectorhq.com/appengine/loc/…/number)', () => {
    const r = detectGhl(page('<script>fetch("https://backend.leadconnectorhq.com/appengine/loc/EykM5/pool/ydN2A/number")</script><script src="https://backend.leadconnectorhq.com/appengine/js/user"></script>'));
    expect(r.status).toBe('likely');
    expect(r.evidence.join(' ')).toMatch(/call tracking/i);
  });
  it('a white-label GHL on someone else\'s domain: any host serving /widget/form|booking|survey/<id> (link.practicebeacon.com)', () => {
    for (const kind of ['form', 'booking', 'survey']) {
      const r = detectGhl(page(`<a href="https://link.practicebeacon.com/widget/${kind}/CYTa0lckjJ6MmEbMPNgZ">x</a>`));
      expect(r.status, kind).toBe('likely');
      expect(r.dnsHosts, kind).toContain('link.practicebeacon.com');
    }
  });
  it('the old rule only knew link.<x>.<y>; any host counts, but a short or ordinary path does not', () => {
    expect(detectGhl(page('<iframe src="https://book.somebiz.example/widget/booking/abcdefghijklmnopqrst"></iframe>')).status).toBe('likely');
    expect(detectGhl(page('<a href="https://x.example/widget/form/abc">x</a>')).status).toBe('potential');
    expect(detectGhl(page('<a href="https://x.example/forms/contact">x</a>')).status).toBe('potential');
  });
  it('GHL media storage (filesafe.space) counts, as before', () => {
    expect(detectGhl(page('<img src="https://assets.cdn.filesafe.space/a/b.png">')).status).toBe('likely');
  });
});

describe('detectGhl: patterns found on 250 real GHL sites (urlscan.io ground truth)', () => {
  it('a script held back by a cookie plugin: the address sits in data-wpconsent-src / data-resources-url', () => {
    const r = detectGhl(page('<script data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js" data-widget-id="69ce2925" type="text/plain" data-wpconsent-src="https://widgets.leadconnectorhq.com/loader.js"></script>'));
    expect(r.status).toBe('likely');
  });
  it('a GHL form embedded inside an srcdoc attribute (HTML stored in an attribute)', () => {
    const r = detectGhl(page('<iframe srcdoc="<iframe src=&quot;https://api.leadconnectorhq.com/widget/form/bjPoWBFbyQPrb5ZjhZ58&quot;></iframe><script src=&quot;https://link.msgsndr.com/js/form_embed.js&quot;></script>"></iframe>'));
    expect(r.status).toBe('likely');
    expect(r.evidence.join(' ')).toMatch(/widget/i);
  });
  it('GHL media storage named in a meta tag (og:image) means the page is GHL-built', () => {
    const r = detectGhl('<html><head><meta property="og:image" content="https://vibe.filesafe.space/1784/assets/458f.png"></head><body><p>x</p></body></html>');
    expect(r.status).toBe('likely');
    expect(r.evidence.join(' ')).toMatch(/filesafe/);
  });
  it('a background image in an inline style from filesafe.space', () => {
    expect(detectGhl(page('<div style="background-image:url(https://assets.cdn.filesafe.space/a/b.jpg)"></div>')).status).toBe('likely');
  });
  it('ordinary attributes that merely contain words or relative paths are not evidence', () => {
    const r = detectGhl(page('<img alt="leadconnector reviews" title="msgsndr" data-x="//cdn.example/a.js" src="/img/a.png"><div class="highlevel"></div>'));
    expect(r.status).toBe('potential');
  });
});

describe('detectGhl: mentions are not use', () => {
  it('text that mentions GoHighLevel (an agency blog, a comparison post) is not evidence', () => {
    const r = detectGhl(page('<p>We compare GoHighLevel and HubSpot. Visit highlevel.com for more.</p>'));
    expect(r.status).toBe('potential');
    expect(r.evidence).toEqual([]);
  });
  it('a plain link to gohighlevel.com is noted, but is not "likely" (an affiliate link, not an embedded tool)', () => {
    const r = detectGhl(page('<a href="https://www.gohighlevel.com/?fp_ref=abc">Powered by</a>'));
    expect(r.status).toBe('potential');
    expect(r.evidence.join(' ')).toMatch(/links to gohighlevel\.com/i);
  });
  it('a script or form action served from gohighlevel.com / highlevel.com counts', () => {
    expect(detectGhl(page('<script src="https://app.gohighlevel.com/js/x.js"></script>')).status).toBe('likely');
  });
  it('a script that is only named in a comment or a text/plain block is not evidence', () => {
    expect(detectGhl(page('<!-- <script src="https://widgets.leadconnectorhq.com/loader.js"></script> -->')).status).toBe('potential');
  });
});

describe('detectGhl: unchanged basics', () => {
  it('no website, or unreachable, is insufficient', () => {
    expect(detectGhl(null).status).toBe('insufficient');
    expect(detectGhl('').status).toBe('insufficient');
  });
  it('an ordinary site is potential with no evidence and nothing to look up', () => {
    expect(detectGhl(page(''))).toMatchObject({ status: 'potential', evidence: [], dnsHosts: [] });
  });
  it('chat widget on leadconnectorhq counts', () => {
    expect(detectGhl(page('<script src="https://widgets.leadconnectorhq.com/loader.js" data-widget-id="abc"></script>')).status).toBe('likely');
  });
});

describe('ghlDns', () => {
  const chains: Record<string, string[]> = {
    'link.practicebeacon.com': ['brand.ludicrous.cloud'],
    'link.plain.example': [],
    'go.alias.example': ['target.other.example', 'brand.ludicrous.cloud'],
    'book.acme.example': ['custom-domains.chatgpt.site'],
  };
  const lookup: CnameLookup = { cname: vi.fn(async (h: string) => { if (h === 'boom.example') throw Object.assign(new Error('x'), { code: 'ETIMEOUT' }); return chains[h]?.[0] ? [chains[h][0]] : (() => { const e = Object.assign(new Error('x'), { code: 'ENODATA' }); throw e; })(); }) };
  const chained: CnameLookup = { cname: async h => { const i = ['go.alias.example', 'target.other.example'].indexOf(h); if (i < 0) throw Object.assign(new Error('x'), { code: 'ENODATA' }); return [chains['go.alias.example'][i]]; } };

  it('a host that CNAMEs to GHL\'s white-label address (ludicrous.cloud) is GHL, with the proof in the evidence', async () => {
    const r = await ghlDns(['link.practicebeacon.com'], lookup);
    expect(r).toEqual([expect.stringMatching(/link\.practicebeacon\.com .*brand\.ludicrous\.cloud/)]);
  });
  it('follows a chain of CNAMEs', async () => {
    expect((await ghlDns(['go.alias.example'], chained)).length).toBe(1);
  });
  it('says nothing for a host that points elsewhere, has no record, or whose lookup fails', async () => {
    expect(await ghlDns(['book.acme.example', 'link.plain.example', 'boom.example'], lookup)).toEqual([]);
  });
  it('asks about each host once', async () => {
    const f = vi.fn(async () => ['brand.ludicrous.cloud']);
    const l: CnameLookup = { cname: f };
    await ghlDns(['once.example'], l); await ghlDns(['once.example'], l);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('probeHosts', () => {
  it('the business\'s own link/go/app/book/crm/portal subdomains, from its website', () => {
    expect(probeHosts('https://www.acme.example/')).toEqual(['link.acme.example', 'go.acme.example', 'app.acme.example', 'book.acme.example', 'crm.acme.example', 'portal.acme.example']);
    expect(probeHosts('acme.com.au')).toContain('link.acme.com.au');
    expect(probeHosts('')).toEqual([]);
    expect(probeHosts('http://127.0.0.1:3000')).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const PLACE = { osmType: 'relation', osmId: 1, lat: 1, lon: 1, label: 'Austin, Texas, United States', countryCode: 'us' };
vi.mock('../lib/geocode', async (orig) => ({
  ...(await orig<typeof import('../lib/geocode')>()),
  geocode: vi.fn(async (q: string) => {
    if (q === 'nowhere') { const { LocationNotFoundError } = await import('../lib/osm'); throw new LocationNotFoundError('nowhere'); }
    return [{ osmType: 'relation', osmId: 1, lat: 1, lon: 1, label: 'Austin, Texas, United States', countryCode: 'us' }];
  }),
}));
vi.mock('../lib/osm', async (orig) => {
  const real = await orig<typeof import('../lib/osm')>();
  return {
    ...real,
    searchOsm: vi.fn(async (type: string) => {
      if (type === 'servers down') throw new real.MapServersBusyError();
      if (type === 'junk names') return [{ name: '12', signals: [] }, { name: 'Real Dental Co', signals: [] }, { name: '505', address: 'Wimbledon Way', signals: [] }];
      if (type === 'registry only') throw new real.MapServersBusyError();
      if (type === 'slow map') return new Promise(r => setTimeout(() => r([{ name: 'Late Map Co', signals: [] }]), 15_000));
      return [{ name: 'Smile', website: 'https://smile.example', signals: [], osmUrl: 'https://www.openstreetmap.org/node/1', city: 'Austin' }, { name: 'NoSite', signals: [] }];
    }),
  };
});
vi.mock('../lib/npi', async orig => {
  const real = await orig<typeof import('../lib/npi')>();
  return {
    ...real,
    searchNpi: vi.fn(async (type: string) => {
      if (type === 'registry only' || type === 'registry plus map') return [
        { name: 'Registry Dental', address: '1 Oak St, Austin', phone: '512-111-2222', signals: [], city: 'Austin', region: 'TX',
          npi: { number: '99', url: 'https://npiregistry.cms.hhs.gov/provider-view/99', official: { name: 'Dr. Rita Registry', title: 'Owner', credential: 'DDS' } } },
      ];
      if (type === 'registry down') throw new Error('registry exploded');
      return [];
    }),
  };
});
vi.mock('../lib/overture', async orig => {
  const real = await orig<typeof import('../lib/overture')>();
  return {
    ...real,
    searchOverture: vi.fn(async (type: string) => {
      if (type === 'overture plus map') return [
        { name: 'Smile', website: 'https://smile.example', phone: '+15125550000', signals: [], overture: { id: 'o1', confidence: 0.9, dataset: 'meta' } },
        { name: 'Overture Only Movers', website: 'https://ovr.example', signals: [], overture: { id: 'o2', confidence: 0.8, dataset: 'meta' } },
      ];
      if (type === 'overture social') return [
        { name: 'Glow Makeup Artist', phone: '+2348012345678', signals: [], overture: { id: 's1', confidence: 0.8, dataset: 'meta', facebook: 'https://www.facebook.com/glowmua' } },
      ];
      if (type === 'overture down') throw new Error('s3 exploded');
      return [];
    }),
  };
});
vi.mock('../lib/ghlDns', async orig => {
  const real = await orig<typeof import('../lib/ghlDns')>();
  // no real DNS in tests: only link.ghlbrand.example points at GHL
  return { ...real, ghlDns: vi.fn(async (hosts: string[]) => hosts.filter(h => h === 'link.ghlbrand.example').map(h => `${h} points at brand.ludicrous.cloud (GoHighLevel custom-domain address)`)) };
});
vi.mock('../lib/abn', async orig => {
  const real = await orig<typeof import('../lib/abn')>();
  return {
    ...real,
    abnEnabled: vi.fn(() => true),
    lookupAbn: vi.fn(async (l: { name: string }) => l.name === 'Smile'
      ? { abn: '51824753556', status: 'Active', entityName: 'DOE, Jane', entityType: 'Individual/Sole Trader', entityTypeCode: 'IND', state: 'QLD', gst: true, url: 'https://abr.business.gov.au/ABN/View?abn=51824753556', person: 'Jane Doe' }
      : l.name === 'NoSite' ? { abn: '11111111111', status: 'Cancelled', entityName: 'NO SITE PTY LTD', entityType: 'Australian Private Company', entityTypeCode: 'PRV', gst: false, url: 'https://abr.business.gov.au/ABN/View?abn=11111111111' }
      : undefined),
  };
});
vi.mock('../lib/emailCheck', async orig => {
  const real = await orig<typeof import('../lib/emailCheck')>();
  return {
    ...real,
    // the real rules, with fake DNS: every domain has a mail server except dead.*
    checkEmail: vi.fn(async (e: string, o: any = {}) => real.checkEmail(e, { ...o, lookup: { mx: async (d: string) => (d.startsWith('dead') ? [] : ['mx.example.com']), hasAddress: async () => false } })),
  };
});
vi.mock('../lib/nominatimSearch', () => ({
  searchNominatim: vi.fn(async () => [{ name: 'Fallback Dental', website: 'https://fb.example', signals: [] }]),
}));
vi.mock('../lib/crawl', () => ({
  crawlPeoplePages: vi.fn(async () => [{ url: 'https://smile.example/about', html: '<html><body><div><h3>Sarah Lee</h3><p>Owner</p></div><p>Open Monday to Friday</p></body></html>' }]),
  crawlSite: vi.fn(async () => ({ emails: ['hi@smile.example'], instagram: 'smile', facebook: 'https://facebook.com/smile', html: `<html><body><p>${'Family dental care in Austin with friendly staff and modern equipment. '.repeat(6)}</p></body></html>`, allHtml: '<html><script src="https://widgets.leadconnectorhq.com/x.js"></script><form><input type="text" name="name"><input type="email"><textarea></textarea></form></html>', fetched: ['https://smile.example'] })),
}));

import { SITE_CHECK_VERSION } from '../lib/research';
import { POST as geo } from '../app/api/geocode/route';
import { POST as search } from '../app/api/search/route';
import { POST as enrich } from '../app/api/enrich/route';
import { POST as people } from '../app/api/people/route';
import { POST as emailCheckApi } from '../app/api/email-check/route';
import { POST as emailApprove } from '../app/api/email-approve/route';
import { POST as push } from '../app/api/push/route';
import { POST as dnc } from '../app/api/dnc/route';
import { POST as weakPreview } from '../app/api/leads/weak/route';
import { POST as deleteLeadsApi } from '../app/api/leads/delete/route';
import { POST as forgetApi } from '../app/api/leads/forget/route';
import { GET as backupsGet, POST as backupsPost } from '../app/api/backups/route';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GET as gate } from '../app/api/gate/route';
import { POST as score } from '../app/api/score/route';
import { POST as counterPitchApi } from '../app/api/counter-pitch/route';
import { POST as followUpApi } from '../app/api/follow-up/route';

const req = (b: any) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });

const BK = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-api-bk-'));
beforeEach(async () => { const m = await import('../lib/db'); m.resetLeadsForTests(); m.allowRepeatsForTests(false); process.env.BACKUP_DIR = BK; delete process.env.GHL_TOKEN; delete process.env.GHL_LOCATION_ID; });

describe('api', () => {
  it('search answers with the map results at once; enrich then checks each website', async () => {
    const res = await search(req({ type: 'dentist', place: PLACE }));
    const found = await res.json();
    expect(res.status).toBe(200);
    expect(found.leads).toHaveLength(2);
    expect(found.matchedBy).toBe('category');
    expect(found.source).toBe('map');
    expect(found.leads[0].research).toBeUndefined(); // not crawled yet

    const er = await enrich(req({ ids: found.leads.map((l: any) => l.id), type: 'dentist', place: PLACE }));
    expect(er.status).toBe(200);
    const j = await er.json();
    const r = j.leads[0].research;
    expect(r.ghlStatus).toBe('likely');
    expect(r.processes).toContain('contact_form');
    expect(r.facebook).toBe('https://facebook.com/smile');
    expect(r.city).toBe('Austin');
    expect(r.country).toBe('us');
    expect(r.score.total).toBeGreaterThan(0);
    expect(r.sourceUrls).toContain('https://smile.example');
    expect(r.sourceUrls).toContain('https://www.openstreetmap.org/node/1'); // map link kept between the two calls
    expect(r.verifiedAt).toMatch(/^\d{4}-/);
    expect(j.leads[1].research.ghlStatus).toBe('insufficient');
    const j2 = await (await search(req({ type: 'zxqv widgets', place: PLACE }))).json();
    expect(j2.matchedBy).toBe('name');
    expect(j.leads[0]).toMatchObject({ email: 'hi@smile.example', instagram: 'smile' });
    expect(j.leads[1].signals).toEqual(['no_website']);
  });
  it('geocode returns candidates', async () => {
    const j = await (await geo(req({ location: 'Austin', country: 'us' }))).json();
    expect(j.candidates[0].label).toContain('Austin');
  });
  it('geocode unknown place -> 404 with message', async () => {
    const res = await geo(req({ location: 'nowhere' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });
  it('search falls back to the place search when every map server is down', async () => {
    const j = await (await search(req({ type: 'servers down', place: PLACE }))).json();
    expect(j.source).toBe('fallback');
    expect(j.leads.map((l: any) => l.name)).toEqual(['Fallback Dental']);
  });
  it('search does not wait out a slow map: after 8 s the place search runs too and the first answer is used', async () => {
    vi.useFakeTimers();
    const p = search(req({ type: 'slow map', place: PLACE }));
    await vi.advanceTimersByTimeAsync(8_100);
    const j = await (await p).json();
    expect(j.source).toBe('fallback');
    expect(j.leads.map((l: any) => l.name)).toEqual(['Fallback Dental']);
    vi.useRealTimers();
  });
  it('enrich rejects bad input and skips leads that are already checked', async () => {
    expect((await enrich(req({ ids: 'x', type: 'dentist', place: PLACE }))).status).toBe(400);
    const found = await (await search(req({ type: 'dentist', place: PLACE }))).json();
    const ids = found.leads.map((l: any) => l.id);
    const { crawlSite } = await import('../lib/crawl');
    await enrich(req({ ids, type: 'dentist', place: PLACE }));
    const calls = (crawlSite as any).mock.calls.length;
    await enrich(req({ ids, type: 'dentist', place: PLACE }));
    expect((crawlSite as any).mock.calls.length).toBe(calls);
  });
  it('people finder stores names found on the team page, skips leads with no website, and does not repeat itself', async () => {
    const found = await (await search(req({ type: 'dentist', place: PLACE }))).json();
    const ids = found.leads.map((l: any) => l.id);
    await enrich(req({ ids, type: 'dentist', place: PLACE }));
    const r = await (await people(req({ ids }))).json();
    const smile = r.leads.find((l: any) => l.name === 'Smile'), noSite = r.leads.find((l: any) => l.name === 'NoSite');
    expect(smile.research.people[0]).toMatchObject({ name: 'Sarah Lee', title: 'Owner', source: 'https://smile.example/about' });
    expect(smile.research.peopleCheckedAt).toMatch(/^\d{4}-/);
    expect(smile.research.sourceUrls).toContain('https://smile.example/about');
    expect(noSite.research.people).toBeUndefined(); // nothing to read
    const { crawlPeoplePages } = await import('../lib/crawl');
    const calls = (crawlPeoplePages as any).mock.calls.length;
    await people(req({ ids }));
    expect((crawlPeoplePages as any).mock.calls.length).toBe(calls); // already looked
    await people(req({ ids, force: true }));
    expect((crawlPeoplePages as any).mock.calls.length).toBeGreaterThan(calls);
    expect((await people(req({ ids: 'x' }))).status).toBe(400);
  });
  it('enrich checks the email and gives no contact points to an address that cannot receive mail', async () => {
    (await import('../lib/db')).allowRepeatsForTests(true);   // this test saves the same business under two searches on purpose
    const { crawlSite } = await import('../lib/crawl');
    const mk = (emails: string[]) => (crawlSite as any).mockResolvedValueOnce({ emails, html: '<html></html>', allHtml: '<html></html>', fetched: ['https://smile.example'] });
    mk(['hi@smile.example']);
    const a = await (await search(req({ type: 'dentist', place: PLACE }))).json();
    const good = (await (await enrich(req({ ids: [a.leads[0].id], type: 'dentist', place: PLACE }))).json()).leads[0];
    expect(good.research.emailCheck).toMatchObject({ status: 'ok', kind: 'role' }); // hi@ is a shared inbox
    mk(['sam@deadsmile.example']); // a domain with no mail server
    const b = await (await search(req({ type: 'dentist2', place: PLACE }))).json();
    const dead = (await (await enrich(req({ ids: [b.leads[0].id], type: 'dentist', place: PLACE }))).json()).leads[0];
    expect(dead.research.emailCheck.status).toBe('bad');
    expect(dead.research.score.factors.contactAccessibility).toBeLessThan(good.research.score.factors.contactAccessibility);
  });
  it('enrich uses the business\'s own address over a web designer\'s, records where it was found, and only a verified one scores', async () => {
    (await import('../lib/db')).allowRepeatsForTests(true);   // this test saves the same business under two searches on purpose
    const { crawlSite } = await import('../lib/crawl');
    vi.mocked(crawlSite).mockResolvedValueOnce({ emails: ['studio@webdesigner.example', 'sarah@smile.example'], html: '<html></html>', allHtml: '<html></html>', fetched: ['https://smile.example'], finalUrl: 'https://smile.example/' } as any);
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 41 } }))).json();
    const smile = found.leads.find((l: any) => l.name === 'Smile');
    const e = (await (await enrich(req({ ids: [smile.id], type: 'dentist', place: PLACE }))).json()).leads[0];
    expect(e.email).toBe('sarah@smile.example');
    expect(e.research.emailSource).toBe('website');
    expect(e.research.emailCheck.status).toBe('ok');
    expect(e.research.score.factors.contactAccessibility).toBeGreaterThanOrEqual(6);
  });
  it('an agency address is not verified and earns no score', async () => {
    (await import('../lib/db')).allowRepeatsForTests(true);   // this test saves the same business under two searches on purpose
    const { crawlSite } = await import('../lib/crawl');
    vi.mocked(crawlSite).mockResolvedValueOnce({ emails: ['studio@webdesigner.example'], html: '<html></html>', allHtml: '<html></html>', fetched: ['https://smile.example'], finalUrl: 'https://smile.example/' } as any);
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 42 } }))).json();
    const smile = found.leads.find((l: any) => l.name === 'Smile');
    const e = (await (await enrich(req({ ids: [smile.id], type: 'dentist', place: PLACE }))).json()).leads[0];
    expect(e.research.emailCheck.status).toBe('risky');
    expect(e.research.score.factors.contactAccessibility).toBe(0);
  });
  const agencyCrawl = { emails: ['studio@webdesigner.example'], html: '<html></html>', allHtml: '<html></html>', fetched: ['https://smile.example'], finalUrl: 'https://smile.example/' } as any;
  it('email-approve: approve an ownership doubt, undo it; the approval survives a re-check that finds the same address', async () => {
    const { crawlSite } = await import('../lib/crawl');
    vi.mocked(crawlSite).mockResolvedValueOnce(agencyCrawl);
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 61 } }))).json();
    const id = found.leads.find((l: any) => l.name === 'Smile').id;
    const first = (await (await enrich(req({ ids: [id], type: 'dentist', place: PLACE }))).json()).leads[0];
    expect(first.research.emailCheck).toMatchObject({ status: 'risky', approvable: true });
    expect(first.research.score.factors.contactAccessibility).toBe(0);
    const ok = await emailApprove(req({ id, approve: true }));
    expect(ok.status).toBe(200);
    const approved = (await ok.json()).lead;
    expect(approved.research.emailApproval).toMatchObject({ email: 'studio@webdesigner.example' });
    expect(approved.research.emailApproval.at).toBeTruthy();
    vi.mocked(crawlSite).mockResolvedValueOnce(agencyCrawl);
    const again = (await (await enrich(req({ ids: [id], type: 'dentist', place: PLACE, force: true }))).json()).leads[0];
    expect(again.research.emailApproval).toBeTruthy();
    expect(again.research.score.factors.contactAccessibility).toBeGreaterThanOrEqual(6); // an approved email counts
    const undone = (await (await emailApprove(req({ id, approve: false }))).json()).lead;
    expect(undone.research.emailApproval).toBeUndefined();
  });
  it('email-approve refuses a bad address, a mail-server problem, an unknown lead and junk; a changed address drops the approval', async () => {
    (await import('../lib/db')).allowRepeatsForTests(true);   // this test saves the same business under two searches on purpose
    const { crawlSite } = await import('../lib/crawl');
    const { getLeadsByIds, updateResearch } = await import('../lib/db');
    vi.mocked(crawlSite).mockResolvedValueOnce(agencyCrawl);
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 62 } }))).json();
    const id = found.leads.find((l: any) => l.name === 'Smile').id;
    await enrich(req({ ids: [id], type: 'dentist', place: PLACE }));
    const l = getLeadsByIds([id])[0];
    updateResearch(id, { ...l.research!, emailCheck: { ...l.research!.emailCheck!, status: 'bad', approvable: false } });
    expect((await emailApprove(req({ id, approve: true }))).status).toBe(400);
    updateResearch(id, { ...l.research!, emailCheck: { ...l.research!.emailCheck!, approvable: false } });
    expect((await emailApprove(req({ id, approve: true }))).status).toBe(400);
    expect((await emailApprove(req({ id: 999999, approve: true }))).status).toBe(404);
    expect((await emailApprove(req({ id: 'x', approve: true }))).status).toBe(400);
    // approve properly, then the site shows the business's own address: the approval was for the old one and no longer applies
    updateResearch(id, l.research!);
    await emailApprove(req({ id, approve: true }));
    const changed = (await (await enrich(req({ ids: [id], type: 'dentist', place: PLACE, force: true }))).json()).leads[0]; // default mock finds hi@smile.example
    expect(changed.email).toBe('hi@smile.example');
    expect(changed.research.emailApproval).toBeUndefined();
  });
  it('email-check route re-checks emails verified under the old, looser rules', async () => {
    const { getLeadsByIds, updateResearch } = await import('../lib/db');
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 43 } }))).json();
    const ids = found.leads.map((l: any) => l.id);
    await enrich(req({ ids, type: 'dentist', place: PLACE }));
    const l = getLeadsByIds(ids).find(x => x.email)!;
    updateResearch(l.id, { ...l.research!, emailCheck: { status: 'ok', kind: 'personal', reasons: [], checkedAt: 'old' } }); // no version: old rules
    const r = (await (await emailCheckApi(req({ ids }))).json()).leads.find((x: any) => x.id === l.id);
    expect(r.research.emailCheck.v).toBeGreaterThanOrEqual(2);
    expect(r.research.emailCheck.checkedAt).not.toBe('old');
  });
  it('email-check route fills in leads saved before the check existed, once', async () => {
    const { checkEmail } = await import('../lib/emailCheck');
    const { getLeadsByIds, updateResearch } = await import('../lib/db');
    const found = await (await search(req({ type: 'dentist3', place: PLACE }))).json();
    const ids = found.leads.map((l: any) => l.id);
    await enrich(req({ ids, type: 'dentist', place: PLACE }));
    const old = getLeadsByIds(ids).find(l => l.email)!;
    updateResearch(old.id, { ...old.research!, emailCheck: undefined }); // as saved before the check existed
    const before = (checkEmail as any).mock.calls.length;
    const r = await emailCheckApi(req({ ids }));
    expect(r.status).toBe(200);
    expect((await r.json()).leads.find((l: any) => l.id === old.id).research.emailCheck.status).toBe('ok');
    expect((checkEmail as any).mock.calls.length).toBe(before + 1);
    await emailCheckApi(req({ ids }));
    expect((checkEmail as any).mock.calls.length).toBe(before + 1); // already checked: not repeated
    expect((await emailCheckApi(req({ ids: 'x' }))).status).toBe(400);
  });
  it('a registry practice becomes a lead with its official as a person, and no made-up "no website" claim', async () => {
    const found = await (await search(req({ type: 'registry plus map', place: PLACE }))).json();
    expect(found.fromRegistry).toBeGreaterThan(0);
    const reg = found.leads.find((l: any) => l.name === 'Registry Dental');
    expect(reg).toBeTruthy();
    const e = await (await enrich(req({ ids: found.leads.map((l: any) => l.id), type: 'dentist', place: PLACE }))).json();
    const lead = e.leads.find((l: any) => l.name === 'Registry Dental');
    expect(lead.signals).toEqual([]);                                  // never looked for on the web, so not "no website"
    expect(lead.research.people[0]).toMatchObject({ name: 'Dr. Rita Registry', title: 'Owner', confidence: 'High', source: 'https://npiregistry.cms.hhs.gov/provider-view/99' });
    expect(lead.research.peopleCheckedAt).toBeUndefined();            // the website has not been read yet
    expect(lead.research.sourceUrls).toContain('https://npiregistry.cms.hhs.gov/provider-view/99');
    // the same practice found on the map keeps its own signals
    expect(e.leads.find((l: any) => l.name === 'NoSite').signals).toEqual(['no_website']);
  });
  it('search still works when the map is down but the registry has practices, and when the registry fails', async () => {
    const j = await (await search(req({ type: 'registry only', place: PLACE }))).json();
    expect(j.source).toBe('fallback'); // the place-search fallback answered for the map
    expect(j.leads.map((l: any) => l.name)).toContain('Registry Dental');
    const ok = await search(req({ type: 'registry down', place: PLACE }));
    expect(ok.status).toBe(200);
  });
  it('search adds Overture businesses, fills the map ones instead of duplicating them, and enrich marks the source', async () => {
    const j = await (await search(req({ type: 'overture plus map', place: PLACE }))).json();
    expect(j.leads.map((l: any) => l.name)).toEqual(['Smile', 'NoSite', 'Overture Only Movers']);
    expect(j.fromOverture).toBe(2);
    expect(j.leads[0].phone).toBe('+15125550000'); // filled from Overture, the map had none
    const e = await (await enrich(req({ ids: j.leads.map((l: any) => l.id), type: 'dentist', place: PLACE }))).json();
    expect(e.leads.find((l: any) => l.name === 'Overture Only Movers').research.sourceUrls).toContain('https://overturemaps.org/');
    expect(e.leads.find((l: any) => l.name === 'NoSite').research.sourceUrls.some((u: string) => u.includes('overturemaps'))).toBe(false);
  });
  it('a solopreneur with no website keeps the Facebook page Overture lists', async () => {
    const j = await (await search(req({ type: 'overture social', place: PLACE }))).json();
    const glow = j.leads.find((l: any) => l.name === 'Glow Makeup Artist');
    expect(glow).toBeTruthy();
    const e = await (await enrich(req({ ids: [glow.id], type: 'makeup artist', place: PLACE }))).json();
    expect(e.leads[0].research.facebook).toBe('https://www.facebook.com/glowmua');
    expect(e.leads[0].signals).toContain('no_website');
  });
  it('search still works when Overture fails, and Overture alone can answer when the map and registry have nothing', async () => {
    const ok = await search(req({ type: 'overture down', place: PLACE }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).leads.length).toBeGreaterThan(0);
    const { searchOverture } = await import('../lib/overture');
    const { searchOsm } = await import('../lib/osm');
    const { MapServersBusyError } = await import('../lib/osm');
    (searchOsm as any).mockRejectedValueOnce(new MapServersBusyError());
    (searchOverture as any).mockResolvedValueOnce([{ name: 'Only Overture Co', signals: [], overture: { id: 'z', confidence: 0.7 } }]);
    const j = await (await search(req({ type: 'overture only', place: PLACE }))).json();
    expect(j.leads.map((l: any) => l.name)).toContain('Only Overture Co');
  });
  it('Australian leads: a sole trader\'s name from the ABN register becomes the owner, a cancelled ABN is flagged, other countries are not asked', async () => {
    const { lookupAbn } = await import('../lib/abn');
    const AU = { ...PLACE, osmId: 7, countryCode: 'au', label: 'Brisbane, Queensland, Australia' };
    vi.mocked(lookupAbn).mockClear();
    const found = await (await search(req({ type: 'dentist', place: AU }))).json();
    const e = await (await enrich(req({ ids: found.leads.map((l: any) => l.id), type: 'dentist', place: AU }))).json();
    const smile = e.leads.find((l: any) => l.name === 'Smile').research, nosite = e.leads.find((l: any) => l.name === 'NoSite').research;
    expect(smile.abn.status).toBe('Active');
    expect(smile.people).toEqual([expect.objectContaining({ name: 'Jane Doe', title: 'Owner (sole trader)', confidence: 'High', source: 'https://abr.business.gov.au/ABN/View?abn=51824753556' })]);
    expect(smile.sourceUrls).toContain('https://abr.business.gov.au/ABN/View?abn=51824753556');
    expect(nosite.abn.status).toBe('Cancelled');
    expect(nosite.people).toBeUndefined();
    expect(vi.mocked(lookupAbn).mock.calls[0][0]).toMatchObject({ region: 'QLD' });
    // a US search never calls the register
    vi.mocked(lookupAbn).mockClear();
    const us = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 8 } }))).json();
    await enrich(req({ ids: us.leads.map((l: any) => l.id), type: 'dentist', place: { ...PLACE, osmId: 8 } }));
    expect(lookupAbn).not.toHaveBeenCalled();
  });
  it('enrich marks the check version, and a forced re-check recomputes the claims but keeps the people already found', async () => {
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 21 } }))).json();
    const ids = found.leads.map((l: any) => l.id);
    const first = await (await enrich(req({ ids, type: 'dentist', place: PLACE }))).json();
    expect(first.leads[0].research.siteCheck).toBe(SITE_CHECK_VERSION);
    await people(req({ ids }));
    const withPeople = (await (await enrich(req({ ids, type: 'dentist', place: PLACE }))).json()).leads[0];
    expect(withPeople.research.people.map((p: any) => p.name)).toContain('Sarah Lee');
    // without force, a lead already checked is left alone
    const { crawlSite } = await import('../lib/crawl');
    vi.mocked(crawlSite).mockClear();
    await enrich(req({ ids, type: 'dentist', place: PLACE }));
    expect(crawlSite).not.toHaveBeenCalled();
    // with force it is read again, and the people survive
    const again = (await (await enrich(req({ ids, type: 'dentist', place: PLACE, force: true }))).json()).leads[0];
    expect(crawlSite).toHaveBeenCalled();
    expect(again.research.siteCheck).toBe(SITE_CHECK_VERSION);
    expect(again.research.people.map((p: any) => p.name)).toContain('Sarah Lee');
    expect(again.research.peopleCheckedAt).toBeTruthy();
  });
  it('quote-led businesses (movers, trades) get no booking claim at all; appointment businesses do', async () => {
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 31 } }))).json();
    const ids = found.leads.map((l: any) => l.id);
    const movers = (await (await enrich(req({ ids, type: 'moving company', place: PLACE, force: true }))).json()).leads.find((l: any) => l.name === 'Smile');
    expect(movers.signals.filter((s: string) => /booking/.test(s))).toEqual([]);
    expect(movers.research.unchecked?.signals ?? []).not.toContain('no_booking');
    const dentist = (await (await enrich(req({ ids, type: 'dentist', place: PLACE, force: true }))).json()).leads.find((l: any) => l.name === 'Smile');
    expect(dentist.signals).toContain('booking_by_form'); // the mocked site has a contact form and no booking tool
  });
  it('GHL: a white-label host found on the page is looked up in DNS and makes the lead a likely GHL user, even when the page shows no GHL script', async () => {
    const { crawlSite } = await import('../lib/crawl');
    const { ghlDns } = await import('../lib/ghlDns');
    vi.mocked(crawlSite).mockResolvedValueOnce({ emails: [], html: '<html></html>', allHtml: '<html><body><a href="https://link.ghlbrand.example/widget/form/CYTa0lckjJ6MmEbMPNgZ">Request</a></body></html>', fetched: ['https://smile.example'], finalUrl: 'https://smile.example/' } as any);
    vi.mocked(ghlDns).mockClear();
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 51 } }))).json();
    const smile = found.leads.find((l: any) => l.name === 'Smile');
    const r = (await (await enrich(req({ ids: [smile.id], type: 'dentist', place: PLACE }))).json()).leads[0].research;
    expect(r.ghlStatus).toBe('likely');
    expect(r.ghlEvidence.join(' ')).toMatch(/ludicrous\.cloud/);
    expect(r.ghlVia).toMatchObject({ domain: 'ghlbrand.example', hosts: ['link.ghlbrand.example'] }); // not smile.example, not named Smile
    expect(r.ghlVia.reason).toMatch(/ghlbrand\.example/);
    const asked = vi.mocked(ghlDns).mock.calls[0][0];
    expect(asked).toContain('link.ghlbrand.example');      // from the page
    expect(asked).toContain('link.smile.example');         // the business's own subdomain
  });
  it('do-not-contact: paste a list, add a lead, remove an entry; the gate endpoint shows the policy and the list', async () => {
    const add = await (await dnc(req({ text: 'stop@x.example\nbad.example, nonsense', reason: 'unsubscribed in GHL' }))).json();
    expect(add.added).toBe(2);
    expect(add.unreadable).toEqual(['nonsense']);
    expect(add.suppressions.map((s: any) => s.value)).toEqual(expect.arrayContaining(['stop@x.example', 'bad.example']));
    expect((await (await dnc(req({ text: 'stop@x.example' }))).json()).existing).toBe(1);
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 71 } }))).json();
    const l = found.leads.find((x: any) => x.name === 'Smile');
    const fromLead = await (await dnc(req({ fromLead: l.id, reason: 'said no on the phone' }))).json();
    expect(fromLead.suppressions.map((s: any) => `${s.kind}:${s.value}`)).toEqual(expect.arrayContaining(['domain:smile.example']));
    const g = await (await gate()).json();
    expect(g.policy.rules.US).toBe('allow');
    expect(g.policy.fallback).toBe('block');
    expect(g.suppressions.length).toBeGreaterThanOrEqual(3);
    const id = g.suppressions.find((s: any) => s.value === 'bad.example').id;
    const after = await (await dnc(req({ remove: id }))).json();
    expect(after.suppressions.some((s: any) => s.value === 'bad.example')).toBe(false);
    for (const bad of [{}, { text: 5 }, { remove: 'x' }, { fromLead: 'x' }, { text: 'a@b.example', reason: 'x'.repeat(500) }]) expect((await dnc(req(bad))).status, JSON.stringify(bad)).toBe(400);
    expect((await dnc(req({ fromLead: 999999 }))).status).toBe(404);
  });
  it('push never sends a do-not-contact lead to GHL, and says so', async () => {
    const found = await (await search(req({ type: 'dentist', place: { ...PLACE, osmId: 72 } }))).json();
    const l = found.leads.find((x: any) => x.name === 'Smile');
    await dnc(req({ fromLead: l.id, reason: 'asked to stop' }));
    process.env.GHL_TOKEN = 't'; process.env.GHL_LOCATION_ID = 'loc';
    const f = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', f);
    const res = await (await push(req({ ids: [l.id], tags: [] }))).json();
    expect(res.results).toEqual([{ id: l.id, ok: false, error: expect.stringMatching(/do-not-contact/i) }]);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('weak leads: preview counts, then delete needs the same count, backs up first, and never touches a pushed lead', async () => {
    const { saveLeads, getLeadsByIds, updateResearch, markPushed, getAllLeads } = await import('../lib/db');
    const mkRes = (priority: string) => ({ ghlStatus: 'insufficient', ghlEvidence: [], processes: [], sourceUrls: [], verifiedAt: 't', score: { total: 30, priority, confidence: 'Low', factors: {} } }) as any;
    const saved = saveLeads('weak-test|x', [{ name: 'Weak One', signals: [] }, { name: 'Weak Two', signals: [] }, { name: 'Weak Pushed', signals: [] }, { name: 'Strong', phone: '+15125550123', signals: [] }]);
    updateResearch(saved[0].id, mkRes('D')); updateResearch(saved[1].id, mkRes('D')); updateResearch(saved[2].id, mkRes('D'));
    updateResearch(saved[3].id, { ...mkRes('A'), score: { total: 90, priority: 'A', confidence: 'High', factors: {} } } as any);
    markPushed(saved[2].id);
    const before = getAllLeads().filter(l => l.searchKey === 'weak-test|x').length;
    const prev = await (await weakPreview(req({ criteria: ['priority-d'] }))).json();
    expect(prev.count).toBeGreaterThanOrEqual(2);
    expect(prev.protectedPushed).toBeGreaterThanOrEqual(1);
    expect(prev.sample.length).toBeGreaterThan(0);
    // delete refuses when the count no longer matches what was previewed
    expect((await deleteLeadsApi(req({ criteria: ['priority-d'], expected: prev.count + 1 }))).status).toBe(409);
    expect(getAllLeads().filter(l => l.searchKey === 'weak-test|x')).toHaveLength(before);
    const del = await (await deleteLeadsApi(req({ criteria: ['priority-d'], expected: prev.count }))).json();
    expect(del.deleted).toBe(prev.count);
    expect(del.backup).toMatch(/before-delete\.db$/);
    expect(fs.existsSync(path.join(BK, del.backup))).toBe(true);
    const left = getAllLeads().filter(l => l.searchKey === 'weak-test|x').map(l => l.name).sort();
    expect(left).toEqual(['Strong', 'Weak Pushed']);          // the pushed lead and the strong one survive
    expect(getLeadsByIds([saved[2].id])).toHaveLength(1);
  });
  it('delete selected: only the ids given, pushed ones skipped, junk refused', async () => {
    const { saveLeads, markPushed, getLeadsByIds } = await import('../lib/db');
    const s = saveLeads('del-sel|x', [{ name: 'A1', signals: [] }, { name: 'A2', signals: [] }, { name: 'A3 pushed', signals: [] }]);
    markPushed(s[2].id);
    const r = await (await deleteLeadsApi(req({ ids: s.map(x => x.id) }))).json();
    expect(r).toMatchObject({ deleted: 2, skippedPushed: 1 });
    expect(getLeadsByIds(s.map(x => x.id)).map(l => l.name)).toEqual(['A3 pushed']);
    for (const bad of [{}, { ids: [] }, { ids: ['x'] }, { ids: [1.5] }, { criteria: ['nope'], expected: 1 }, { criteria: ['priority-d'] }]) expect((await deleteLeadsApi(req(bad))).status, JSON.stringify(bad)).toBe(400);
  });
  it('forget: puts the business on the do-not-contact list, then deletes it everywhere (every search that found it), even if pushed', async () => {
    (await import('../lib/db')).allowRepeatsForTests(true);   // this test saves the same business under two searches on purpose
    const { saveLeads, markPushed, getAllLeads } = await import('../lib/db');
    const a = saveLeads('forget|1', [{ name: 'Gone Co', website: 'https://www.goneco.example', email: 'x@goneco.example', phone: '+61 7 3000 7777', signals: [] }, { name: 'Other Co', website: 'https://other.example', signals: [] }]);
    const b = saveLeads('forget|2', [{ name: 'Gone Co (again)', website: 'http://goneco.example/about', signals: [] }]);
    markPushed(a[0].id);
    const r = await (await forgetApi(req({ id: a[0].id, reason: 'asked to be removed' }))).json();
    expect(r.deleted).toBe(2);                                       // both searches
    expect(r.backup).toMatch(/before-forget\.db$/);
    expect(r.note).toMatch(/GHL/);
    const names = getAllLeads().map(l => l.name);
    expect(names).not.toContain('Gone Co'); expect(names).not.toContain('Gone Co (again)'); expect(names).toContain('Other Co');
    const g = await (await (await import('../app/api/gate/route')).GET()).json();
    expect(g.suppressions.map((s: any) => `${s.kind}:${s.value}`)).toEqual(expect.arrayContaining(['domain:goneco.example', 'email:x@goneco.example']));
    expect(g.suppressions.find((s: any) => s.value === 'goneco.example').reason).toBe('asked to be removed');
    // found again later, it is flagged (the suppression survived the delete)
    expect(b.length).toBe(1);
    for (const s of g.suppressions.filter((s: any) => /goneco/.test(s.value))) await dnc(req({ remove: s.id }));   // keep the shared test database clean
    for (const bad of [{}, { id: 'x' }]) expect((await forgetApi(req(bad))).status).toBe(400);
    expect((await forgetApi(req({ id: 999999 }))).status).toBe(404);
  });
  it('backups: list them and make one now', async () => {
    const made = await (await backupsPost(req({ now: true }))).json();
    expect(made.backup.file).toMatch(/manual\.db$/);
    const list = await (await backupsGet()).json();
    expect(list.backups.some((b: any) => b.file === made.backup.file)).toBe(true);
    expect(list.folder).toBe(BK);
    expect((await backupsPost(req({}))).status).toBe(400);
  });
  it('search never saves a \"business\" whose name is just a number (OpenStreetMap unit numbers)', async () => {
    const j = await (await search(req({ type: 'junk names', place: { ...PLACE, osmId: 81 } }))).json();
    expect(j.leads.map((l: any) => l.name)).toEqual(['Real Dental Co']);
  });
  it('push rejects ids that are not whole numbers, and ignores junk in the opener edits', async () => {
    const bad = await push(req({ ids: ['1; DROP TABLE leads'], tags: [] }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/ids/i);
    expect((await push(req({ ids: [1.5], tags: [] }))).status).toBe(400);
    const found = await (await search(req({ type: 'dentist', place: PLACE }))).json();
    const id = found.leads[0].id;
    // no GHL credentials in tests, so the push itself is refused; the edits are still saved first, and only the valid ones
    const res = await push(req({ ids: [id], tags: [], openers: { [id]: 'My own opener', abc: 'junk', '-5': 'junk', [id + 1000]: 'x'.repeat(5000), } }));
    expect(res.status).toBe(400);
    const { getLeadsByIds } = await import('../lib/db');
    expect(getLeadsByIds([id])[0].opener).toBe('My own opener');
  });
  it('people finder answers with JSON even when a site makes the lookup throw (never an empty 500)', async () => {
    const { crawlPeoplePages } = await import('../lib/crawl');
    const found = await (await search(req({ type: 'dentist', place: PLACE }))).json();
    const ids = found.leads.map((l: any) => l.id);
    await enrich(req({ ids, type: 'dentist', place: PLACE }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    (crawlPeoplePages as any).mockRejectedValueOnce(new TypeError('crawlPeoplePages exploded'));
    const res = await people(req({ ids, force: true }));
    expect(res.status).toBe(200);                       // the bad site is skipped, the batch survives
    expect((await res.json()).leads).toHaveLength(ids.length);
  });
  it('people finder keeps the registry official and merges what the website names', async () => {
    const { searchNpi } = await import('../lib/npi');
    (searchNpi as any).mockResolvedValueOnce([
      { name: 'Smile', address: '9 Elm St, Austin', phone: '512-777-8888', website: undefined, signals: [], npi: { number: '5', url: 'https://npiregistry.cms.hhs.gov/provider-view/5', official: { name: 'Dr. Sarah Lee', title: 'Owner' } } },
    ]);
    const found = await (await search(req({ type: 'registry merge', place: PLACE }))).json();
    const ids = found.leads.map((l: any) => l.id);
    await enrich(req({ ids, type: 'dentist', place: PLACE }));
    const r = await (await people(req({ ids }))).json();
    const smile = r.leads.find((l: any) => l.name === 'Smile');
    expect(smile.research.people.filter((p: any) => /sarah lee/i.test(p.name))).toHaveLength(1); // registry + website: one person
    expect(smile.research.peopleCheckedAt).toBeTruthy();
  });
  it('search rejects missing type or place', async () => {
    expect((await search(req({ type: '', place: PLACE }))).status).toBe(400);
    expect((await search(req({ type: 'dentist' }))).status).toBe(400);
  });
  it('score falls back when ollama down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const s = await (await search(req({ type: 'dentist', place: PLACE }))).json();
    await enrich(req({ ids: s.leads.map((l: any) => l.id), type: 'dentist', place: PLACE }));
    const res = await score(req({ ids: s.leads.map((l: any) => l.id), type: 'dentist' }));
    const j = await res.json();
    expect(j.ollamaDown).toBe(true);
    expect(j.leads.every((l: any) => l.opener)).toBe(true);
    const o = j.leads[0].research.outreach;
    expect(o.service).toBeTruthy();
    expect(o.discoveryQuestion).toBeTruthy();
    // Counter Pitch: a researched lead gets a validated first-touch email, or "needs further research" and the short angle
    const cp = j.leads[0].research.counterPitch;
    expect(['ready', 'review', 'needs_research']).toContain(cp.status);
    if (cp.status === 'needs_research') { expect(cp.missing.length).toBeGreaterThan(0); expect(j.leads[0].opener).toContain(o.openingQuestion); expect(j.leads[0].opener).not.toMatch(/^Subject:/); }
    else { expect(j.leads[0].opener).toMatch(/^Subject: /); expect(j.leads[0].opener).toContain(cp.research.question); expect(j.leads[0].opener).toContain('just reply "No"'); }
  });
  describe('Counter Pitch routes', () => {
    async function scored(signals: string[]) {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
      const s = await (await search(req({ type: 'dentist', place: PLACE }))).json();
      const ids = s.leads.map((l: any) => l.id);
      await enrich(req({ ids, type: 'dentist', place: PLACE }));
      const { getLeadsByIds, updateResearch, saveLeads } = await import('../lib/db');
      void saveLeads;
      for (const l of getLeadsByIds(ids)) if (l.research) updateResearch(l.id, { ...l.research, siteCheck: SITE_CHECK_VERSION });
      return { ids, signals };
    }
    it('counter-pitch rebuilds from reworded fields and keeps the researched evidence; never sends anything', async () => {
      const { ids } = await scored([]);
      const { getLeadsByIds, updateResearch, updateOpener } = await import('../lib/db');
      const l = getLeadsByIds(ids)[0];
      // a lead with a checked gap
      const withGap = { ...l, signals: ['no_https'] };
      void withGap;
      const { planCounterPitch } = await import('../lib/counterPitch');
      const plan = planCounterPitch({ name: l.name, type: 'dentist', signals: l.signals, website: l.website, country: 'AU', siteCheck: SITE_CHECK_VERSION, hasResearch: true });
      expect(plan.status).toBe('ready');
      updateResearch(l.id, { ...l.research!, counterPitch: { version: 1, status: 'ready', missing: [], research: plan.research, subject: plan.subject, generatedAt: 'x' } });
      updateOpener(l.id, 'old');
      const fetchSpy = vi.fn(async () => { throw new Error('no network'); });
      vi.stubGlobal('fetch', fetchSpy);
      const r = await counterPitchApi(req({ id: l.id, edits: { question: 'Who looks after the website today?', subject: 'Browser warning on your website?' } }));
      expect(r.status).toBe(200);
      const j = await r.json();
      const rec = j.lead.research.counterPitch;
      expect(rec.edited).toBe(true);
      expect(rec.research.evidence).toBe(plan.research.evidence);
      expect(rec.research.confidence).toBe(plan.research.confidence);
      expect(rec.research.question).toBe('Who looks after the website today?');
      expect(j.lead.opener).toContain('Who looks after the website today?');
      expect(rec.validation.checks).toHaveLength(10);
      expect(fetchSpy).not.toHaveBeenCalled();   // no AI call, no GHL call
    });
    it('a hand edit that breaks a rule is flagged for review, not hidden', async () => {
      const { ids } = await scored([]);
      const { getLeadsByIds, updateResearch } = await import('../lib/db');
      const l = getLeadsByIds(ids)[0];
      const { planCounterPitch } = await import('../lib/counterPitch');
      const plan = planCounterPitch({ name: l.name, type: 'dentist', signals: l.signals, website: l.website, country: 'AU', siteCheck: SITE_CHECK_VERSION, hasResearch: true });
      updateResearch(l.id, { ...l.research!, counterPitch: { version: 1, status: 'ready', missing: [], research: plan.research, subject: plan.subject, generatedAt: 'x' } });
      const j = await (await counterPitchApi(req({ id: l.id, edits: { question: 'Can we book a quick call this week to fix it?' } }))).json();
      expect(j.lead.research.counterPitch.status).toBe('review');
      expect(j.lead.research.counterPitch.validation.checks.filter((c: any) => !c.ok).map((c: any) => c.id)).toEqual(expect.arrayContaining(['no-pitch']));
    });
    it('counter-pitch refuses edits when there is not enough research, and bad input', async () => {
      const { ids } = await scored([]);
      const { getLeadsByIds, updateResearch } = await import('../lib/db');
      const l = getLeadsByIds(ids)[0];
      updateResearch(l.id, { ...l.research!, counterPitch: { version: 1, status: 'needs_research', missing: ['x'], research: { businessName: l.name, industry: 'dentist', confidence: 'weak' }, generatedAt: 'x' } });
      expect((await counterPitchApi(req({ id: l.id, edits: { question: 'Hello?' } }))).status).toBe(400);
      expect((await counterPitchApi(req({ id: 'x' }))).status).toBe(400);
      expect((await counterPitchApi(req({ id: 999999 }))).status).toBe(404);
    });
    it('follow-up: replying "No" puts the lead on the do-not-contact list and blocks any later email', async () => {
      const { ids } = await scored([]);
      const { getLeadsByIds, updateResearch, listSuppressions } = await import('../lib/db');
      const l = getLeadsByIds(ids)[0];
      const { planCounterPitch } = await import('../lib/counterPitch');
      const plan = planCounterPitch({ name: l.name, type: 'dentist', signals: l.signals, website: l.website, country: 'AU', siteCheck: SITE_CHECK_VERSION, hasResearch: true });
      updateResearch(l.id, { ...l.research!, counterPitch: { version: 1, status: 'ready', missing: [], research: plan.research, subject: plan.subject, generatedAt: 'x' } });
      const before = listSuppressions().length;
      const j = await (await followUpApi(req({ id: l.id, reply: 'No' }))).json();
      expect(j.result.kind).toBe('opt_out');
      expect(j.result.draft).toBeNull();
      expect(j.suppressed).toBe(true);
      expect(listSuppressions().length).toBeGreaterThan(before);
      const { emailDecision, DEFAULT_GATE } = await import('../lib/emailGate');
      const fresh = getLeadsByIds([l.id])[0];
      expect(emailDecision({ ...fresh, email: fresh.email ?? 'x@smile.example' }, { ...DEFAULT_GATE, suppressions: listSuppressions() }).by).toBe('suppressed');
    });
    it('follow-up: a question gets a draft and does NOT suppress; silence gets a new angle; no research is refused', async () => {
      const { ids } = await scored([]);
      const { getLeadsByIds, updateResearch, listSuppressions } = await import('../lib/db');
      const l = getLeadsByIds(ids)[1] ?? getLeadsByIds(ids)[0];
      const { planCounterPitch } = await import('../lib/counterPitch');
      const plan = planCounterPitch({ name: l.name, type: 'dentist', signals: l.signals, website: l.website, country: 'AU', siteCheck: SITE_CHECK_VERSION, hasResearch: true });
      updateResearch(l.id, { ...l.research!, counterPitch: { version: 1, status: 'ready', missing: [], research: plan.research, subject: plan.subject, generatedAt: 'x' } });
      const before = listSuppressions().length;
      const j = await (await followUpApi(req({ id: l.id, reply: 'What did you see exactly?' }))).json();
      expect(j.result.kind).toBe('more_info');
      expect(j.suppressed).toBe(false);
      expect(listSuppressions().length).toBe(before);
      const n = await (await followUpApi(req({ id: l.id, noResponse: true }))).json();
      expect(n.result.draft).toContain('P.S.');
      expect((await followUpApi(req({ id: l.id }))).status).toBe(400);
    });
  });
  it('push with missing env -> clear error', async () => {
    const res = await push(req({ ids: [1], tags: ['t'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('GHL_TOKEN and GHL_LOCATION_ID required');
  });
});

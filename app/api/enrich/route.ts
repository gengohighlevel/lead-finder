import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { crawlSite } from '@/lib/crawl';
import { analyseSite } from '@/lib/siteAnalysis';
import { getLeadsByIds, getOrigin, updateEnrichment } from '@/lib/db';
import { mapLimit } from '@/lib/pipeline';
import { detectGhl } from '@/lib/ghlDetect';
import { ghlDns, probeHosts } from '@/lib/ghlDns';
import { thirdPartyHosts, classifyGhlHost } from '@/lib/ghlAgency';
import { scoreLead } from '@/lib/score';
import { checkEmail, canSend, pickEmail } from '@/lib/emailCheck';
import { SITE_CHECK_VERSION } from '@/lib/research';
import { canBeReached } from '@/lib/reach';
import { isQuoteLed } from '@/lib/playbook';
import { abnEnabled, lookupAbn, auState } from '@/lib/abn';
import { mergePeople, type Person } from '@/lib/people';
import { extractSiteFacts } from '@/lib/siteFacts';

/** Websites read at once. Each is a different site, so this is polite; 16 was 3.3x faster than 5 in a timing run. */
const CRAWL_AT_ONCE = 16;

/** Step 2 of a search: read each lead's website, then score it. Leads already checked are skipped. */
export const POST = safeRoute(async (req: Request) => {
  const { ids, type, place, force } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.every(Number.isInteger) || typeof type !== 'string' || !type.trim()) {
    return NextResponse.json({ error: 'ids and business type required' }, { status: 400 });
  }
  // place label like "Norman, Cleveland County, Oklahoma, United States"
  const parts = String(place?.label ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const placeCity = parts[0], placeRegion = parts.length >= 3 ? parts[parts.length - 2] : undefined;

  await mapLimit(getLeadsByIds(ids).filter(l => force || !l.research), CRAWL_AT_ONCE, async l => {
    const origin = getOrigin(l.id);
    let { email, instagram } = l;
    const o = origin.npi?.official;
    const official: Person | undefined = o && origin.npi ? { name: o.name, title: o.title, source: origin.npi.url, confidence: 'High', evidence: `Authorized official on the US NPI registry${o.credential ? ` (${o.credential})` : ''}` } : undefined;
    // Australia only, and only with a key: confirms the business is active and, for a sole trader, names the person
    const abnP = abnEnabled() && String(place?.countryCode ?? '').toLowerCase() === 'au'
      ? lookupAbn({ name: l.name, region: auState(origin.region) ?? auState(place?.label) }) : Promise.resolve(undefined);
    const [crawl, abn] = await Promise.all([l.website ? crawlSite(l.website) : Promise.resolve(null), abnP]);
    const abnPerson: Person | undefined = abn?.person
      ? { name: abn.person, title: 'Owner (sole trader)', source: abn.url, confidence: 'High', evidence: `Registered as an individual (sole trader) on the Australian Business Register, ABN ${abn.abn}` } : undefined;
    if (crawl) {
      // the business's own address beats one found in a footer credit (the web designer) or a free mailbox
      email = pickEmail([...(email ? [email] : []), ...crawl.emails], crawl.finalUrl ?? l.website) ?? email;
      instagram ||= crawl.instagram;
    }
    const emailSource: 'website' | 'listing' | undefined = email ? (crawl?.emails.includes(email.toLowerCase()) ? 'website' : 'listing') : undefined;
    const facebook = crawl?.facebook ?? origin.overture?.facebook;
    const siteReachable = !!crawl?.fetched.length;
    // A practice found only in the registry has not been looked for on the web, so "no website" would be a guess
    const facts = l.website ? analyseSite({ website: l.website, finalUrl: crawl?.finalUrl, home: crawl?.html ?? '', allHtml: crawl?.allHtml ?? '' }) : undefined;
    // quote-led businesses (movers, trades) sell through enquiries: a missing booking calendar is not a gap for them
    const quoteLed = isQuoteLed(type);
    const signals = !l.website ? (origin.npiOnly ? [] : ['no_website']) : facts!.gaps.filter(g => !(quoteLed && (g === 'no_booking' || g === 'booking_by_form')));
    const gaps = instagram ? signals.filter(s => s !== 'no_instagram') : signals;
    const processes = facts?.processes ?? [];
    // an Instagram page we already know about settles that question, so it is neither a gap nor unchecked
    const uncheckedSignals = (facts?.unchecked?.signals ?? []).filter(s => !(s === 'no_instagram' && instagram) && !(quoteLed && s === 'no_booking'));
    const unchecked = uncheckedSignals.length ? { signals: uncheckedSignals, reason: facts!.unchecked!.reason } : undefined;
    // GHL: signs on the pages, then DNS for the hosts those pages load GHL widgets from and the business's own link./go./book. subdomains
    const onPage = detectGhl(l.website ? crawl?.allHtml ?? '' : null);
    const dnsEvidence = l.website ? await ghlDns([...onPage.dnsHosts, ...probeHosts(crawl?.finalUrl ?? l.website)]) : [];
    const ghl = { status: onPage.status === 'likely' || dnsEvidence.length ? 'likely' as const : onPage.status, evidence: [...onPage.evidence, ...dnsEvidence] };
    // whose domain are the GHL pages served from? Neither the business's site nor its name = a third party (agency, GHL-based software, parent brand)
    const via = ghl.status === 'likely'
      ? thirdPartyHosts([...onPage.dnsHosts, ...dnsEvidence.map(e => e.split(' ')[0])], { siteHost: crawl?.finalUrl ?? l.website, businessName: l.name })[0] : undefined;
    const ghlVia = via ? { ...via, reason: classifyGhlHost(via.hosts[0], { siteHost: crawl?.finalUrl ?? l.website, businessName: l.name }).reason } : undefined;
    // an approval you made by hand stays, but only for that exact address
    const emailApproval = l.research?.emailApproval && email && l.research.emailApproval.email.toLowerCase() === email.toLowerCase() ? l.research.emailApproval : undefined;
    const emailCheck = email ? await checkEmail(email, { website: crawl?.finalUrl ?? l.website, foundOnSite: emailSource === 'website' }) : undefined;
    // an address that cannot receive mail is not a way to reach them, so it earns no contact points
    const score = scoreLead({ type, hasWebsite: !!l.website, siteReachable, email, emailVerified: canSend(emailCheck, emailApproval, email), phone: l.phone, processes, signals: gaps, hasSocial: !!(instagram || facebook), reachable: canBeReached({ email, phone: l.phone, instagram }, { facebook, processes, emailCheck }) });
    updateEnrichment(l.id, {
      email, instagram, signals: gaps,
      research: {
        ghlStatus: ghl.status, ghlEvidence: ghl.evidence, processes, facebook,
        country: place?.countryCode, region: origin.region ?? placeRegion, city: origin.city ?? placeCity,
        score, emailCheck, ...(emailApproval ? { emailApproval } : {}), ...(emailSource ? { emailSource } : {}), verifiedAt: new Date().toISOString(),
        sourceUrls: [...(crawl?.fetched ?? []), ...(origin.osmUrl ? [origin.osmUrl] : []), ...(origin.npi ? [origin.npi.url] : []), ...(origin.overture ? ['https://overturemaps.org/'] : []), ...(abn ? [abn.url] : [])],
        ...(abn ? { abn } : {}),
        ...(ghlVia ? { ghlVia } : {}),
        ...(unchecked ? { unchecked } : {}),
        siteCheck: SITE_CHECK_VERSION,
        ...(crawl?.html ? { siteFacts: extractSiteFacts(crawl.html, crawl.allHtml ?? '', type) } : {}),
        // a re-check keeps the people already found
        ...(l.research?.people?.length || official || abnPerson ? { people: mergePeople([...(l.research?.people ?? []), official, abnPerson].filter((p): p is Person => !!p), l.name) } : {}),
        ...(l.research?.peopleCheckedAt ? { peopleCheckedAt: l.research.peopleCheckedAt } : {}),
      },
    });
  });
  return NextResponse.json({ leads: getLeadsByIds(ids) });
});

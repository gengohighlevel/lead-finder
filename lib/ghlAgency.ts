/**
 * Whose domain is a GHL page served from? A business that set up GHL itself uses GHL's own address or its own domain
 * (link.theirsite.com). A white-label agency serves its clients' forms and booking pages from the AGENCY's domain
 * (link.practicebeacon.com on a dentist's site). So: compare the host with the business's website and with its name.
 * A host that matches neither is a third-party host: an agency, a software company built on GHL, or a parent brand.
 * That is a reading of the evidence, not a fact, so it is worded as such.
 */
export type HostOwner = 'own' | 'third-party' | 'ghl';

const GHL_HOST = /(?:^|\.)(?:leadconnectorhq\.com|msgsndr\.com|gohighlevel\.com|highlevel\.com|filesafe\.space|ludicrous\.cloud)$/i;
const TWO_PART_END = /^(?:com|co|org|net|gov|edu|ac)\.[a-z]{2}$/i;

/** link.practicebeacon.com -> practicebeacon.com; go.acme.co.nz -> acme.co.nz */
export function registrable(host: string): string {
  const p = host.trim().toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (p.length <= 2) return p.join('.');
  return p.slice(-(TWO_PART_END.test(p.slice(-2).join('.')) ? 3 : 2)).join('.');
}

const LEGAL = new Set('pty ltd limited llc inc incorporated corp corporation co company llp plc gmbh the and of by a an'.split(' '));
// Words every business in a trade shares: two dentists are not each other because both say "dental".
const GENERIC = new Set(`dental dentist dentistry orthodontic orthodontics clinic centre center studio services service group plumbing plumber hvac roofing roofer moving movers removals
  removalist storage law legal attorney attorneys lawyer firm associates solutions care health medical family best pro professional home homes construction cleaning repair salon spa
  beauty fitness gym auto car realty real estate insurance marketing agency digital design makeup artist hair tree landscaping electric electrical heating cooling air pest control
  mortgage financial accounting tax builders contractors company local city state north south east west`.split(/\s+/));

const letters = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Does this domain look like it belongs to a business of this name? */
export function nameMatchesDomain(businessName: string, host: string): boolean {
  const label = letters(registrable(host).split('.')[0]);
  const words = (businessName ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter(w => w && !LEGAL.has(w));
  const joined = words.join('');
  if (label.length < 4 || joined.length < 4) return false;
  if (joined.length >= 5 && (label.includes(joined) || (label.length >= 5 && joined.includes(label)))) return true;
  const distinctive = words.filter(w => w.length >= 4 && !GENERIC.has(w));
  if (!distinctive.length) return false;
  return distinctive.filter(w => label.includes(w)).length / distinctive.length >= 0.5;
}

export type HostClass = { owner: HostOwner; domain: string; reason: string };

export function classifyGhlHost(host: string, ctx: { siteHost?: string; businessName?: string }): HostClass {
  const h = host.trim().toLowerCase();
  const domain = registrable(h);
  if (GHL_HOST.test(h)) return { owner: 'ghl', domain, reason: "GoHighLevel's own address" };
  if (ctx.siteHost && registrable(ctx.siteHost.replace(/^https?:\/\//, '').replace(/[/?#:].*$/, '')) === domain) return { owner: 'own', domain, reason: "the same domain as the business's website" };
  if (ctx.businessName && nameMatchesDomain(ctx.businessName, h)) return { owner: 'own', domain, reason: "a domain that matches the business's name" };
  return {
    owner: 'third-party', domain,
    reason: `GHL pages are served from ${domain}, which is not this business's website${ctx.businessName ? ' and does not match its name' : ''}: likely an agency, a software company built on GHL, or a parent brand`,
  };
}

/** The third-party domains among these hosts, each once, with the hosts seen on it. */
export function thirdPartyHosts(hosts: string[], ctx: { siteHost?: string; businessName?: string }): { domain: string; hosts: string[] }[] {
  const by = new Map<string, string[]>();
  for (const h of new Set(hosts.map(x => x.toLowerCase()))) {
    const c = classifyGhlHost(h, ctx);
    if (c.owner === 'third-party') by.set(c.domain, [...(by.get(c.domain) ?? []), h]);
  }
  return [...by].map(([domain, hs]) => ({ domain, hosts: hs }));
}

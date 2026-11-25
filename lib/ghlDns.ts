import { Resolver } from 'node:dns/promises';

/**
 * DNS signs of GoHighLevel. GHL's white-label and custom-domain hosts are CNAMEs to its own addresses; seen on a real site:
 * link.practicebeacon.com -> brand.ludicrous.cloud, serving /widget/form/<id>. So a host that a page loads GHL widgets from,
 * or the business's own link./go./book. subdomain, that points at one of these is a GHL custom domain. Free and quiet (DNS only).
 * (A normal website that merely embeds GHL widgets looks ordinary in DNS: this finds the other kind.)
 */
export type CnameLookup = { cname(host: string): Promise<string[]> };

const GHL_TARGET = /(?:^|\.)(?:ludicrous\.cloud|leadconnectorhq\.com|msgsndr\.com|gohighlevel\.com|highlevel\.com)\.?$/i;
const MAX_HOPS = 5;
const PREFIXES = ['link', 'go', 'app', 'book', 'crm', 'portal'];

export function dnsCname(): CnameLookup {
  const r = new Resolver({ timeout: 3000, tries: 1 });
  return { cname: h => r.resolveCname(h) };
}
let shared: CnameLookup | undefined;
const defaultLookup = () => (shared ??= dnsCname());

const cache = new WeakMap<CnameLookup, Map<string, Promise<string | undefined>>>();

/** The first address in this host's CNAME chain that is GHL's, if any. A missing record or a failed lookup means "no sign". */
function ghlTarget(host: string, l: CnameLookup): Promise<string | undefined> {
  let per = cache.get(l);
  if (!per) cache.set(l, (per = new Map()));
  let p = per.get(host);
  if (!p) {
    p = (async () => {
      let h = host;
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        let next: string | undefined;
        try { next = (await l.cname(h))[0]; } catch { return undefined; }
        if (!next) return undefined;
        if (GHL_TARGET.test(next)) return next.replace(/\.$/, '');
        h = next;
      }
      return undefined;
    })();
    per.set(host, p);
  }
  return p;
}

/** Evidence lines for each host that points at GHL. */
export async function ghlDns(hosts: string[], lookup: CnameLookup = defaultLookup()): Promise<string[]> {
  const out: string[] = [];
  await Promise.all([...new Set(hosts.map(h => h.toLowerCase()))].map(async h => {
    const t = await ghlTarget(h, lookup);
    if (t) out.push(`${h} points at ${t} (GoHighLevel custom-domain address)`);
  }));
  return out.sort();
}

/** The business's own subdomains where a GHL custom domain usually lives. */
export function probeHosts(website?: string): string[] {
  const host = (website ?? '').trim().toLowerCase().match(/^(?:[a-z]+:\/\/)?([^/?#:]+)/)?.[1]?.replace(/^www\./, '');
  if (!host || !host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return [];
  return PREFIXES.map(p => `${p}.${host}`);
}

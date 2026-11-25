import * as cheerio from 'cheerio';

/**
 * People finder: names and job titles a business publishes about itself on its own website.
 * Rule based and free. It reads only what is written on the page, never guesses an email, and never looks anywhere else.
 */
export type Person = { name: string; title?: string; source: string; confidence: 'High' | 'Medium'; evidence?: string };

const LEADER = String.raw`(?:co-?)?owner|(?:co-?)?founder|proprietor|principal(?:\s+(?:dentist|doctor|lawyer|attorney|architect|broker|partner|consultant))?|managing\s+(?:director|partner)|(?:executive\s+|creative\s+|medical\s+|clinical\s+)?director|ceo|chief\s+executive(?:\s+officer)?|president|coo|cfo|chief\s+(?:operating|financial)\s+officer|(?:senior\s+|managing\s+|equity\s+)?partner|general\s+manager|practice\s+manager|(?:head|lead)\s+(?:dentist|doctor|stylist|technician|vet(?:erinarian)?)|broker(?:\s+owner)?|master\s+(?:plumber|electrician|builder)`;
const OTHER = String.raw`dentist|doctor|physician|surgeon|orthodontist|hygienist|dental\s+(?:hygienist|assistant|therapist)|manager|attorney|lawyer|solicitor|barrister|accountant|(?:real\s+estate\s+)?agent|realtor|stylist|barber|therapist|physiotherapist|physio|chiropractor|veterinarian|vet|technician|electrician|plumber|roofer|builder|architect|consultant|specialist|administrator|coordinator|supervisor|engineer|designer|esthetician|nurse|receptionist|assistant|associate|advisor|adviser|trainer|instructor|photographer|florist|mechanic`;
const LEADER_RE = new RegExp(String.raw`\b(?:${LEADER})\b`, 'i');
const ROLE_RE = new RegExp(String.raw`\b(?:${LEADER}|${OTHER})\b`, 'i');
/** Owner, founder, president, CEO, director, partner and the like: someone who decides, not staff or admin. */
export const isLeaderTitle = (title?: string): boolean => !!title && LEADER_RE.test(title);
const SHORT_TITLE_RE = new RegExp(String.raw`^(?:[\p{L}&/,'’.-]+\s+){0,5}[\p{L}&/,'’.-]+$`, 'u');

const HONORIFIC = String.raw`(?:Dr|Mr|Mrs|Ms|Mx|Prof|Professor)\.?`;
const CREDENTIALS = String.raw`(?:DDS|DMD|MD|DO|DC|DVM|PhD|Esq|CPA|MBA|BDS|MBBS|BVSc|RN|JD|LLB|FRACDS)`;
const NAME_TOKEN = String.raw`(?:\p{Lu}[\p{L}'’-]*\.?|(?:de|da|del|della|di|van|von|der|den|la|le|bin|al|el|mac|mc)(?=\s+\p{L}))`;
const NAME_SRC = String.raw`(?:${HONORIFIC}\s+)?${NAME_TOKEN}(?:\s+${NAME_TOKEN}){1,3}`;

// Words that make a "name" something else: page furniture, services, business words.
const STOP = new Set(`a about all an and appointment appointments are at back book booking call care centre center choose clinic company contact copyright cosmetic
 customers dental dentist dentistry details email emergency estimate faq family free from get gallery google health home hours how in info is it join learn location locations
 login map meet more news new now of office on online open our out page patients patient policy practice privacy projects quote read request reserved reviews rights
 schedule service services smile smiles staff start started team terms testimonials the this to today us view visit we welcome who why with work works your
 monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december
 facebook instagram twitter linkedin youtube yelp tiktok pinterest implants whitening braces orthodontics veneers crowns cleaning cleanings roofing plumbing electrical heating
 cooling repair repairs install installation removals moving storage salon spa beauty hair nails massage fitness gym yoga law legal firm group associates partners limited ltd llc inc pty`.split(/\s+/));
const TITLE_WORDS = new Set('owner founder director president partner manager dentist doctor hygienist assistant receptionist'.split(' '));

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const stripHonorific = (n: string) => n.replace(new RegExp(String.raw`^${HONORIFIC}\s+`, 'i'), '');

/** Looks like a person's name, not page furniture or the business itself. */
export function isPlausibleName(raw: string, business = ''): boolean {
  const name = raw.trim();
  if (!name || name.length > 42 || /[0-9@/:©|]/.test(name)) return false;
  if (name === name.toUpperCase() && name.length > 3) return false; // "ABOUT US"
  const core = stripHonorific(name);
  const tokens = core.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (core !== name && tokens.length > 3) return false; // "Dr. Ip Provides Stunning Results" is a sentence, not a name
  if (/['’]s\b/.test(name)) return false;               // possessive: "Dr. Ip's Affiliations"
  if (!new RegExp(String.raw`^${NAME_SRC}$`, 'u').test(name)) return false;
  // Real name tokens: not an acronym (PPO, HMO), not a brand with an inner capital (MetLife; McDonald and DeShawn are fine),
  // and a trailing full stop only on an initial ("J.") or the honorific. "Frank." in the middle is the end of a sentence.
  for (const t of tokens) {
    const bare = t.replace(/\.$/, '');
    if (bare.length > 1 && bare === bare.toUpperCase() && /\p{L}/u.test(bare)) return false;
    if (/\p{Ll}\p{Lu}/u.test(bare) && !/^(Mc|Mac|De|Di|La|Le|Du|Van|Von|O['’])/.test(bare)) return false;
    if (t.endsWith('.') && bare.length > 1) return false;
  }
  const words = norm(core).split(' ').filter(Boolean);
  if (words.some(w => w.length > 1 && (STOP.has(w) || TITLE_WORDS.has(w)))) return false; // a single letter is an initial
  if (words.some(w => w.length < 2 && !/^[a-z]$/.test(w))) return false;
  const b = norm(business);
  // A business named after a person ("Dr David Gordon", "Gordon DDS") is that person; any other business-name match is the business.
  const personalBusiness = new RegExp(String.raw`^${HONORIFIC}\s|\b${CREDENTIALS}\b\s*$`, 'i').test(business.trim()) || core !== name;
  if (b && !personalBusiness && (b.includes(words.join(' ')) || words.join(' ') === b)) return false;
  const bizWords = new Set(b.split(' ').filter(w => w.length > 3));
  if (!personalBusiness && words.length === 2 && words.every(w => bizWords.has(w))) return false;
  return true;
}

const splitCredentials = (s: string) => {
  const m = s.match(new RegExp(String.raw`^(.*?)(?:,\s*|\s+)((?:${CREDENTIALS})(?:[,\s]+(?:${CREDENTIALS}))*)\.?$`));
  return m ? { name: m[1].trim(), credentials: m[2].trim() } : { name: s.trim(), credentials: '' };
};
/** "Call Anna Kowalski" -> "Anna Kowalski": drop leading words that are page text, not part of a name. */
const trimLead = (name: string) => {
  const t = name.trim().split(/\s+/);
  while (t.length > 2 && !new RegExp(String.raw`^${HONORIFIC}$`, 'i').test(t[0]) && (STOP.has(norm(t[0])) || TITLE_WORDS.has(norm(t[0])))) t.shift();
  return t.join(' ');
};
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/[ ]/g, ' ').trim();
const snippet = (s: string) => clean(s).slice(0, 140);

type Raw = { name: string; title?: string; confidence: 'High' | 'Medium'; evidence?: string };

function fromJsonLd($: cheerio.CheerioAPI): Raw[] {
  const out: Raw[] = [];
  const walk = (v: unknown, depth = 0): void => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) return v.forEach(x => walk(x, depth + 1));
    const o = v as Record<string, unknown>;
    const type = ([] as unknown[]).concat(o['@type'] ?? []).map(String).join(' ');
    if (/Person/i.test(type) && typeof o.name === 'string') {
      const title = typeof o.jobTitle === 'string' ? clean(o.jobTitle) : undefined;
      out.push({ name: clean(o.name), title, confidence: 'High', evidence: snippet(`${o.name}${title ? `, ${title}` : ''} (structured data)`) });
    }
    for (const k of ['founder', 'founders', 'employee', 'employees', 'member', 'members', 'owner', 'author'.slice(0, 0) || 'director', 'contactPoint', '@graph', 'sameAs'.slice(0, 0) || 'department'])
      if (o[k]) walk(o[k], depth + 1);
    if (/Person/i.test(type)) return;
    for (const k of ['founder', 'employee', 'member', 'owner']) if (typeof o[k] === 'string' && !out.length) out.push({ name: clean(String(o[k])), title: k === 'employee' || k === 'member' ? undefined : k[0].toUpperCase() + k.slice(1), confidence: 'High' });
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try { walk(JSON.parse($(el).contents().text())); } catch { /* broken JSON-LD: ignore */ }
  });
  return out;
}

function fromCards($: cheerio.CheerioAPI): Raw[] {
  const out: Raw[] = [];
  const NAME_EL = 'h1,h2,h3,h4,h5,h6,strong,b,[itemprop="name"],[class*="name" i],[class*="member" i] > p:first-child';
  const titleOf = (el: cheerio.Cheerio<any>): string | undefined => {
    const t = clean(el.text());
    return t && t.length <= 70 && SHORT_TITLE_RE.test(t) && ROLE_RE.test(t) && !/^(meet|our|the|about|welcome|why|see|view|read|call|book)\b/i.test(t) ? t : undefined;
  };
  $(NAME_EL).each((_, el) => {
    const node = $(el);
    const text = clean(node.text());
    if (text.length > 60 || node.find(NAME_EL).length) return;
    const { name, credentials } = splitCredentials(text);
    if (!isPlausibleName(name)) return;
    let title: string | undefined;
    // title next to the name: following siblings, then preceding siblings, then other short text in the same card
    for (const sib of [node.next(), node.next().next(), node.prev()]) { title = titleOf(sib); if (title) break; }
    if (!title) {
      const card = node.parent();
      card.children().each((_, c) => { if (!title && c !== el) title = titleOf($(c)); });
    }
    if (title && norm(title) === norm(name)) title = undefined; // the card repeats the name
    if (!title && credentials) title = credentials;
    if (!title && !/^Dr\.?\s/i.test(name)) return; // a bare capitalised heading with no role is not enough
    out.push({ name: /^Dr\.?\s/i.test(text) && !/^Dr/i.test(name) ? `Dr. ${name}` : name, title, confidence: title && LEADER_RE.test(title) ? 'High' : 'Medium', evidence: snippet(`${text}${title && title !== credentials ? ` — ${title}` : ''}`) });
  });
  return out;
}

function fromSentences($: cheerio.CheerioAPI): Raw[] {
  const out: Raw[] = [];
  const text = clean($('p, li, div, td, span, h1, h2, h3, h4, h5, h6, a').not('script,style').map((_, e) => $(e).children().length ? '' : $(e).text()).get().join('\n'));
  const add = (name: string, title: string | undefined, m: RegExpMatchArray) => {
    const { name: n } = splitCredentials(trimLead(name));
    out.push({ name: clean(n), title: title && clean(title), confidence: 'Medium', evidence: snippet(m[0]) });
  };
  const L = LEADER, R = `${LEADER}|${OTHER}`;
  // "Dr. Sarah Lee is the owner and principal dentist"
  for (const m of text.matchAll(new RegExp(String.raw`(${NAME_SRC})(?:,\s*${CREDENTIALS})?\s+(?:is|was|has been|serves as|works as)\s+(?:the\s+|our\s+|a\s+|an\s+|its\s+)?((?:${R})(?:\s+(?:and|&)\s+(?:${R}))?)`, 'gu'))) add(m[1], m[2], m);
  // "founded by John Smith", "owned and operated by Jane Doe"
  for (const m of text.matchAll(new RegExp(String.raw`\b(founded|owned|started|established|created|run|led|operated|managed)(?:\s+and\s+(?:owned|operated|run|managed))?\s+by\s+(${NAME_SRC})`, 'gu'))) {
    const title = /found|start|establish|creat/i.test(m[1]) ? 'Founder' : /owned/i.test(m[1]) ? 'Owner' : undefined;
    add(m[2], title, m);
  }
  // "Sarah Lee, Practice Manager" / "Sarah Lee – Owner" / "Sarah Lee | Owner"
  for (const m of text.matchAll(new RegExp(String.raw`(${NAME_SRC})(?:,\s*${CREDENTIALS})?\s*(?:,|–|—|-|\|)\s*((?:${R})(?:\s+(?:and|&)\s+(?:${R}))?)\b`, 'giu'))) add(m[1], m[2], m);
  // "Owner: Peter Jones"
  for (const m of text.matchAll(new RegExp(String.raw`\b(${L}|manager|director)\s*:\s*(${NAME_SRC})`, 'giu'))) add(m[2], m[1][0].toUpperCase() + m[1].slice(1), m);
  return out;
}

const rank = (p: Person) => (p.title && LEADER_RE.test(p.title) ? 0 : 1) * 4 + (p.confidence === 'High' ? 0 : 2) + (p.title ? 0 : 1);

/** Same person seen more than once (or on several pages): one entry, best title and confidence, longest name. Best first, at most 6. */
function dedupe(people: Person[], businessName: string): Person[] {
  const byKey = new Map<string, Person>();
  for (const r of people) {
    if (!isPlausibleName(r.name, businessName)) continue;
    const key = norm(stripHonorific(r.name));
    // a "title" that only repeats the name is page markup, not a job
    const next: Person = { ...r, title: r.title && norm(stripHonorific(r.title)) === key ? undefined : r.title };
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, next); continue; }
    byKey.set(key, {
      ...prev, name: next.name.length > prev.name.length ? next.name : prev.name,
      title: prev.title && (!next.title || LEADER_RE.test(prev.title) || !LEADER_RE.test(next.title) && prev.title.length >= next.title.length) ? prev.title : next.title,
      confidence: prev.confidence === 'High' || next.confidence === 'High' ? 'High' : 'Medium', evidence: prev.evidence ?? next.evidence,
    });
  }
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b)).slice(0, 6);
}

/** Names and titles found on one page. Highest confidence first, owners and founders before staff, at most 6. */
export function extractPeople(html: string, pageUrl: string, businessName: string): Person[] {
  if (!html || !/<[a-z]/i.test(html)) return [];
  const $ = cheerio.load(html);
  const found = [...fromJsonLd($), ...fromCards($), ...fromSentences($)];
  return dedupe(found.map(r => ({ name: r.name, title: r.title, source: pageUrl, confidence: r.confidence, evidence: r.evidence })), businessName);
}

/** Combine people from different sources (registry, website pages) into one list: same person once, best title, owners first. */
export const mergePeople = (people: Person[], businessName: string): Person[] => dedupe(people, businessName);

/** Everything found across a business's pages, merged. A person's source is the first page that named them. */
export function extractFromPages(pages: { url: string; html: string }[], businessName: string): Person[] {
  return dedupe(pages.flatMap(pg => extractPeople(pg.html, pg.url, businessName)), businessName);
}

const TEAM_HINT = /\b(team|staff|people|meet|doctors?|dentists?|providers?|practitioners?|leadership|management|owner|our-?story|who-?we-?are|about)\b/i;
const TEAM_FIRST = /\b(team|staff|people|meet|doctors?|dentists?|providers?|practitioners?|leadership)\b/i;
const NOT_TEAM = /\b(contact|blog|news|career|jobs?|privacy|terms|login|cart|shop|gallery|faq|review|testimonial)\b/i;

/** Up to two same-site pages worth reading for names: team and staff pages first, then about pages. */
export function findTeamLinks(html: string, base: string): string[] {
  let baseUrl: URL;
  try { baseUrl = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`); } catch { return []; }
  const host = (h: string) => h.replace(/^www\./, '').toLowerCase();
  const $ = cheerio.load(html || '');
  const seen = new Map<string, number>();
  $('a[href]').each((_, a) => {
    try {
      const u = new URL($(a).attr('href')!, baseUrl);
      if (!/^https?:$/.test(u.protocol) || host(u.hostname) !== host(baseUrl.hostname)) return;
      if (/\.(pdf|jpe?g|png|gif|webp|svg|docx?|zip)$/i.test(u.pathname)) return;
      u.hash = ''; u.search = '';
      const path = u.pathname.replace(/\/+$/, '') || '/';
      if (path === '/' || path === baseUrl.pathname.replace(/\/+$/, '')) return;
      const label = `${$(a).text()} ${path}`;
      if (NOT_TEAM.test(path) || !TEAM_HINT.test(label)) return;
      const score = TEAM_FIRST.test(label) ? 0 : 1;
      const key = `${u.origin}${path}`;
      if (!seen.has(key) || seen.get(key)! > score) seen.set(key, score);
    } catch { /* bad href */ }
  });
  return [...seen].sort((a, b) => a[1] - b[1]).map(([u]) => u).slice(0, 2);
}

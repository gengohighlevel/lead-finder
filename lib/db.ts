import Database from 'better-sqlite3';
import type { Research } from './research';
import type { NpiInfo } from './npi';
import type { Suppression, SuppressionKind } from './dnc';
import { identityKeys } from './leadKeys';

export type Lead = {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  instagram?: string;
  signals: string[];
  opener?: string;
  pushedAt?: string;
  research?: Research;
};
export type NewLead = Omit<Lead, 'id'>;
/** Where a lead came from on the map; kept until its website has been checked. */
/** Overture Maps record a lead was found in (free open places dataset). */
export type OvertureInfo = { id: string; confidence: number; dataset?: string; /** Facebook page it lists; for many solo businesses the only storefront */ facebook?: string };
export type Origin = { osmUrl?: string; city?: string; region?: string; npi?: NpiInfo; npiOnly?: boolean; overture?: OvertureInfo };
/** A lead plus the search it came from (`type|place`). */
export type StoredLead = Lead & { searchKey: string };

/** The library file. LEADS_DB (in .env) can point it elsewhere, e.g. a synced folder. */
export const dbPath = (): string => process.env.LEADS_DB?.trim() || 'leads.db';

let db: Database.Database | null = null;
function conn(): Database.Database {
  if (db) return db;
  db = new Database(process.env.NODE_ENV === 'test' || process.env.VITEST ? ':memory:' : dbPath());
  db.exec(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, searchKey TEXT NOT NULL, name TEXT NOT NULL,
    address TEXT, phone TEXT, email TEXT, website TEXT, instagram TEXT,
    signals TEXT NOT NULL DEFAULT '[]', opener TEXT, pushedAt TEXT)`);
  // migration: research column added in v2
  const cols = (db.prepare('PRAGMA table_info(leads)').all() as { name: string }[]).map(c => c.name);
  if (!cols.includes('research')) db.exec('ALTER TABLE leads ADD COLUMN research TEXT');
  // migration: origin column added with the two-step search (map first, websites after)
  if (!cols.includes('origin')) db.exec('ALTER TABLE leads ADD COLUMN origin TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS suppressions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT NOT NULL, reason TEXT, createdAt TEXT NOT NULL, UNIQUE(kind, value))`);
  // things that may be used only once (recovery codes), so a stolen copy cannot be replayed
  db.exec(`CREATE TABLE IF NOT EXISTS used_once (kind TEXT NOT NULL, value TEXT NOT NULL, usedAt TEXT NOT NULL, PRIMARY KEY(kind, value))`);
  return db;
}

type Row = Omit<Lead, 'signals' | 'research'> & { signals: string; research: string | null; origin?: string | null };
const toLead = (r: Row): Lead => {
  const l: any = { ...r, signals: JSON.parse(r.signals), research: r.research ? JSON.parse(r.research) : null };
  delete l.searchKey;
  delete l.origin;
  for (const k of Object.keys(l)) if (l[k] === null) delete l[k];
  return l as Lead;
};

/** Tests only: empty the leads table so one test's searches do not count as "already saved" for the next. */
export function resetLeadsForTests(): void {
  if (!(process.env.NODE_ENV === 'test' || process.env.VITEST)) throw new Error('tests only');
  conn().exec('DELETE FROM leads');
}
/** Tests only: let the same business be saved by two searches (a few tests model exactly that). */
let allowRepeats = false;
export function allowRepeatsForTests(v: boolean): void {
  if (!(process.env.NODE_ENV === 'test' || process.env.VITEST)) throw new Error('tests only');
  allowRepeats = v;
}
export type SkippedLead = { name: string; why: string };
export function saveLeads(searchKey: string, leads: (NewLead & { origin?: Origin })[]): Lead[] {
  return saveLeadsReport(searchKey, leads).leads;
}
/**
 * Save a search. A business already saved by ANOTHER search (same website, same phone with no website, or same name and street address)
 * is not saved again: it stays where it is, and is reported in `skipped`.
 */
export function saveLeadsReport(searchKey: string, leads: (NewLead & { origin?: Origin })[]): { leads: Lead[]; skipped: SkippedLead[] } {
  const d = conn();
  const ins = d.prepare(`INSERT INTO leads (searchKey,name,address,phone,email,website,instagram,signals,opener,research,origin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const skipped: SkippedLead[] = [];
  d.transaction(() => {
    d.prepare('DELETE FROM leads WHERE searchKey=? AND pushedAt IS NULL').run(searchKey);
    const norm = (n: string, a?: string | null) => `${n}|${a ?? ''}`.toLowerCase();
    const pushed = new Set(
      (d.prepare('SELECT name,address FROM leads WHERE searchKey=? AND pushedAt IS NOT NULL').all(searchKey) as { name: string; address: string | null }[])
        .map(r => norm(r.name, r.address)));
    // everything already saved (other searches, and this search's pushed rows): the keys a new lead must not repeat
    const have = new Map<string, string>();
    for (const r of d.prepare('SELECT name,address,phone,website FROM leads').all() as { name: string; address: string | null; phone: string | null; website: string | null }[])
      for (const k of identityKeys(r)) if (!have.has(k)) have.set(k, r.name);
    for (const l of leads) {
      if (pushed.has(norm(l.name, l.address))) continue; // already pushed: keep that row, no duplicate
      const hit = allowRepeats ? undefined : identityKeys(l).find(k => have.has(k));
      if (hit) { skipped.push({ name: l.name, why: `already saved as "${have.get(hit)}" (${hit.split(':')[0] === 'site' ? 'same website' : hit.split(':')[0] === 'phone' ? 'same phone' : 'same name and address'})` }); continue; }
      ins.run(searchKey, l.name, l.address ?? null, l.phone ?? null, l.email ?? null,
        l.website ?? null, l.instagram ?? null, JSON.stringify(l.signals ?? []), l.opener ?? null, l.research ? JSON.stringify(l.research) : null, l.origin ? JSON.stringify(l.origin) : null);
      for (const k of identityKeys(l)) have.set(k, l.name);   // two new leads that are the same business: the second is skipped too
    }
  })();
  return { leads: getLeads(searchKey), skipped };
}
export function getLeads(searchKey: string): Lead[] {
  return (conn().prepare('SELECT * FROM leads WHERE searchKey=? ORDER BY id').all(searchKey) as Row[]).map(toLead);
}
/** Every saved lead across all searches, newest first. */
export function getAllLeads(): StoredLead[] {
  return (conn().prepare('SELECT * FROM leads ORDER BY id DESC').all() as (Row & { searchKey: string })[])
    .map(r => ({ ...toLead(r), searchKey: r.searchKey }));
}
export function getLeadsByIds(ids: number[]): Lead[] {
  if (!ids.length) return [];
  const q = ids.map(() => '?').join(',');
  return (conn().prepare(`SELECT * FROM leads WHERE id IN (${q}) ORDER BY id`).all(...ids) as Row[]).map(toLead);
}
export function updateOpener(id: number, opener: string): void {
  conn().prepare('UPDATE leads SET opener=? WHERE id=?').run(opener, id);
}
export function markPushed(id: number): void {
  conn().prepare("UPDATE leads SET pushedAt=datetime('now') WHERE id=?").run(id);
}
export function updateResearch(id: number, research: Research): void {
  conn().prepare('UPDATE leads SET research=? WHERE id=?').run(JSON.stringify(research), id);
}

export function getOrigin(id: number): Origin {
  const r = conn().prepare('SELECT origin FROM leads WHERE id=?').get(id) as { origin: string | null } | undefined;
  return r?.origin ? JSON.parse(r.origin) : {};
}
/** Store what checking the website found. */
export function updateEnrichment(id: number, e: { email?: string; instagram?: string; signals: string[]; research: Research }): void {
  conn().prepare('UPDATE leads SET email=?, instagram=?, signals=?, research=? WHERE id=?')
    .run(e.email ?? null, e.instagram ?? null, JSON.stringify(e.signals), JSON.stringify(e.research), id);
}

export function updateEmailCheck(id: number, check: NonNullable<Research['emailCheck']>): void {
  const row = conn().prepare('SELECT research FROM leads WHERE id=?').get(id) as { research: string | null } | undefined;
  if (!row?.research) return;
  const r = JSON.parse(row.research) as Research;
  r.emailCheck = check;
  conn().prepare('UPDATE leads SET research=? WHERE id=?').run(JSON.stringify(r), id);
}
export function updatePeople(id: number, people: NonNullable<Research['people']>, checkedAt: string): void {
  const row = conn().prepare('SELECT research FROM leads WHERE id=?').get(id) as { research: string | null } | undefined;
  if (!row?.research) return;
  const r = JSON.parse(row.research) as Research;
  r.people = people; r.peopleCheckedAt = checkedAt;
  if (people.length) r.sourceUrls = [...new Set([...r.sourceUrls, ...people.map(p => p.source)])];
  conn().prepare('UPDATE leads SET research=? WHERE id=?').run(JSON.stringify(r), id);
}

// ---- do-not-contact list ----
export function listSuppressions(): Suppression[] {
  return (conn().prepare('SELECT id, kind, value, reason, createdAt FROM suppressions ORDER BY id DESC').all() as (Omit<Suppression, 'reason'> & { reason: string | null })[])
    .map(r => ({ ...r, kind: r.kind as SuppressionKind, ...(r.reason ? { reason: r.reason } : { reason: undefined }) }));
}
export function addSuppressions(entries: { kind: SuppressionKind; value: string }[], reason?: string): { added: number; existing: number } {
  const ins = conn().prepare('INSERT OR IGNORE INTO suppressions (kind, value, reason, createdAt) VALUES (?,?,?,?)');
  let added = 0, existing = 0;
  conn().transaction(() => { for (const e of entries) { if (ins.run(e.kind, e.value, reason?.trim() || null, new Date().toISOString()).changes) added++; else existing++; } })();
  return { added, existing };
}
export function removeSuppression(id: number): boolean {
  return conn().prepare('DELETE FROM suppressions WHERE id=?').run(id).changes > 0;
}

// ---- backup and delete ----
/** A consistent copy of the whole library, safe to take while the app is running. */
export function backupTo(dest: string): Promise<unknown> { return conn().backup(dest); }
export function countLeads(): number { return (conn().prepare('SELECT count(*) n FROM leads').get() as { n: number }).n; }
export function deleteLeads(ids: number[]): number {
  if (!ids.length) return 0;
  const del = conn().prepare('DELETE FROM leads WHERE id=?');
  let n = 0;
  conn().transaction(() => { for (const id of ids) n += del.run(id).changes; })();
  return n;
}

/** Mark something as used. true the first time, false if it was already used. */
export function useOnce(kind: string, value: string): boolean {
  return conn().prepare("INSERT OR IGNORE INTO used_once (kind, value, usedAt) VALUES (?,?,?)").run(kind, value, new Date().toISOString()).changes > 0;
}

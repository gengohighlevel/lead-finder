import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupTo } from './db';

/**
 * Backups of leads.db. A copy is made with SQLite's own backup, which is consistent even while the app runs, then opened to
 * prove it is readable. BACKUP_DIR (in .env) can point at a synced folder (iCloud Drive, Dropbox) for an off-computer copy.
 */
export const backupDir = (): string => path.resolve(process.env.BACKUP_DIR?.trim() || 'backups');
const NAME = /^leads-.*\.db$/;
const KEEP = 30;

export type BackupInfo = { file: string; bytes: number; createdAt: string };

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
const tidy = (label?: string) => (label ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

export async function backupNow(label?: string): Promise<BackupInfo & { leads: number }> {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const base = `leads-${stamp()}`, suffix = tidy(label) ? `-${tidy(label)}` : '';
  let file = `${base}${suffix}.db`;
  for (let n = 2; fs.existsSync(path.join(dir, file)); n++) file = `${base}-${n}${suffix}.db`;
  const dest = path.join(dir, file);
  await backupTo(dest);
  let leads = 0;
  try {                                   // a backup that cannot be opened is not a backup
    const copy = new Database(dest, { readonly: true });
    leads = (copy.prepare('SELECT count(*) n FROM leads').get() as { n: number }).n;
    copy.close();
  } catch (e) { fs.rmSync(dest, { force: true }); throw new Error(`The backup could not be verified and was removed: ${e instanceof Error ? e.message : e}`); }
  pruneBackups();
  const st = fs.statSync(dest);
  return { file, bytes: st.size, createdAt: st.mtime.toISOString(), leads };
}

export function listBackups(): BackupInfo[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => NAME.test(f)).map(file => { const st = fs.statSync(path.join(dir, file)); return { file, bytes: st.size, createdAt: st.mtime.toISOString(), ms: st.mtimeMs }; })
    .sort((a, b) => b.ms - a.ms || (a.file < b.file ? 1 : -1)).map(({ ms: _ms, ...b }) => { void _ms; return b; });
}

/** Keep the newest `keep` backups. Only files that look like backups are ever removed. */
export function pruneBackups(keep = KEEP): number {
  const all = listBackups();
  let removed = 0;
  for (const b of all.slice(keep)) { try { fs.rmSync(path.join(backupDir(), b.file)); removed++; } catch { /* leave it */ } }
  return removed;
}

/** A daily backup: only when there is none yet, or the newest is older than `maxAgeHours`. */
export async function backupIfDue(maxAgeHours = 20): Promise<BackupInfo | undefined> {
  const newest = listBackups()[0];
  if (newest && Date.now() - new Date(newest.createdAt).getTime() < maxAgeHours * 3600_000) return undefined;
  return backupNow('daily');
}

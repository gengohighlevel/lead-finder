import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { saveLeads } from '../lib/db';
import { backupNow, listBackups, pruneBackups, backupIfDue } from '../lib/backup';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-backup-'));
beforeEach(() => { process.env.BACKUP_DIR = dir; for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.BACKUP_DIR; });

describe('backupNow', () => {
  it('writes a complete copy of the library that opens and holds the same leads', async () => {
    saveLeads('backup-test', [{ name: 'Alpha', signals: [] }, { name: 'Beta', signals: [] }]);
    const b = await backupNow('manual');
    expect(b.file).toMatch(/^leads-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*-manual\.db$/);
    expect(fs.existsSync(path.join(dir, b.file))).toBe(true);
    expect(b.bytes).toBeGreaterThan(0);
    expect(b.leads).toBeGreaterThanOrEqual(2);
    const copy = new Database(path.join(dir, b.file), { readonly: true });
    expect((copy.prepare("SELECT count(*) n FROM leads WHERE searchKey='backup-test'").get() as { n: number }).n).toBe(2);
    copy.close();
  });
  it('creates the folder when it is missing', async () => {
    const nested = path.join(dir, 'a', 'b'); process.env.BACKUP_DIR = nested;
    await backupNow(); expect(fs.readdirSync(nested)).toHaveLength(1);
  });
  it('two backups in the same second do not overwrite each other', async () => {
    const a = await backupNow('x'), b = await backupNow('x');
    expect(a.file).not.toBe(b.file);
    expect(listBackups()).toHaveLength(2);
  });
});

describe('listBackups / pruneBackups', () => {
  it('lists newest first with size and time, ignoring other files', async () => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    await backupNow('a'); await backupNow('b');
    const l = listBackups();
    expect(l).toHaveLength(2);
    expect(l[0].file > l[1].file).toBe(true);
    expect(l[0]).toMatchObject({ bytes: expect.any(Number), createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
  });
  it('keeps the newest N and removes the rest', async () => {
    for (let i = 0; i < 5; i++) await backupNow(`n${i}`);
    expect(pruneBackups(3)).toBe(2);
    expect(listBackups()).toHaveLength(3);
    expect(listBackups().map(b => b.file).join()).toMatch(/n4.*n3.*n2/);
  });
  it('never removes anything that is not a backup file', async () => {
    fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'x'); await backupNow(); pruneBackups(0);
    expect(fs.existsSync(path.join(dir, 'keep-me.txt'))).toBe(true);
  });
});

describe('backupIfDue', () => {
  it('backs up when there is none or the newest is old, and skips when a recent one exists', async () => {
    expect((await backupIfDue(20))?.file).toBeTruthy();
    expect(await backupIfDue(20)).toBeUndefined();
    const f = listBackups()[0].file; const old = new Date(Date.now() - 30 * 3600_000);
    fs.utimesSync(path.join(dir, f), old, old);
    expect((await backupIfDue(20))?.file).toBeTruthy();
  });
});

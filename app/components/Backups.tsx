'use client';
import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { post, get } from './api';

type Info = { file: string; bytes: number; createdAt: string };
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** Settings: backups of your lead library. */
export function Backups() {
  const [list, setList] = useState<Info[]>([]);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() { try { const j = await get('/api/backups'); setList(j.backups ?? []); setFolder(j.folder ?? ''); } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not load'); } }
  useEffect(() => { void load(); }, []);
  async function now() {
    setBusy(true); setMsg(null);
    try { const r = (await post('/api/backups', { now: true })) as { backup: Info & { leads: number } }; setMsg(`Backed up ${r.backup.leads} leads (${size(r.backup.bytes)}).`); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Backup failed'); }
    finally { setBusy(false); }
  }

  return (
    <section className="panel material" aria-labelledby="bk-h">
      <div className="panel-head">
        <h2 id="bk-h">Backups</h2><span className="hint">a copy of your lead library, once a day and before any delete · the newest 30 are kept</span>
      </div>
      <div className="toolbar">
        <button type="button" className="btn" disabled={busy} onClick={now}><Icon name={busy ? 'loader' : 'download'} size={16} className={busy ? 'spin' : undefined} />{busy ? 'Backing up…' : 'Back up now'}</button>
        <span className="sub">Saved in <code>{folder || 'backups'}</code></span>
        {msg && <span className="sub" role="status">{msg}</span>}
      </div>
      {list.length === 0 ? <p className="sub">No backups yet. The first one is made a few seconds after the app starts.</p> : (
        <ul className="rules">
          {list.slice(0, 8).map(b => <li key={b.file} className="status-row"><b>{b.createdAt.slice(0, 16).replace('T', ' ')}</b> <span className="sub">· {size(b.bytes)} · {b.file}</span></li>)}
          {list.length > 8 && <li className="sub">…and {list.length - 8} older</li>}
        </ul>
      )}
      <details className="fold material">
        <summary>Keep a copy off this computer, and how to restore</summary>
        <div className="fold-body">
          <p>These backups live on this computer. To keep a copy somewhere safe, set <code>BACKUP_DIR</code> in <code>.env</code> to a synced folder (iCloud Drive or Dropbox), then restart the app. Time Machine also covers the project folder.</p>
          <p>To restore, in the project folder run <code>scripts/app restore</code> and pick a file. It stops the app, keeps a copy of the current library first, puts the backup in place, and starts the app again.</p>
        </div>
      </details>
    </section>
  );
}

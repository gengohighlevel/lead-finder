'use client';
import type { Stats } from '@/lib/stats';
import { Icon } from './Icons';
import type { System } from './Sidebar';

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%');

/** Horizontal bars, one hue: every bar is the same measure (a count of leads). Values are labelled, so no axis. */
function Bars({ rows, max, caption }: { rows: { label: string; value: number; note?: string }[]; max?: number; caption: string }) {
  const top = max ?? Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="bars" role="list" aria-label={caption}>
      {rows.map(r => (
        <div className="bar-row" role="listitem" key={r.label} title={`${r.label}: ${r.value.toLocaleString()}${r.note ? ` (${r.note})` : ''}`}>
          <span className="bar-label">{r.label}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.value / top) * 100}%` }} /></div>
          <span className="bar-value num">{r.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function Tile({ icon, label, value, note }: { icon: string; label: string; value: string; note: string }) {
  return (
    <div className="tile material">
      <span className="tile-label"><Icon name={icon} size={16} />{label}</span>
      <span className="tile-value num">{value}</span>
      <span className="tile-note">{note}</span>
    </div>
  );
}

export function Dashboard({ stats, system, onFind, onOpenSearch }: { stats: Stats | null; system: System | null; onFind: () => void; onOpenSearch: (key: string) => void }) {
  if (!stats) return <div className="callout material" data-tone="info" role="status"><Icon name="loader" className="spin" />Loading your numbers…</div>;
  if (!stats.total) return (
    <div className="empty material">
      <Icon name="target" size={34} />
      <h2>No leads yet</h2>
      <p>Run your first search to find local businesses, score them and get an outreach angle for each one.</p>
      <button type="button" className="btn btn-primary" onClick={onFind}><Icon name="search" size={16} />Find leads</button>
    </div>
  );
  const s = stats;
  const toPush = s.qualified - Math.min(s.pushed, s.qualified);
  return (
    <>
      <div className="tiles">
        <Tile icon="users" label="Leads found" value={s.total.toLocaleString()} note={`${s.searches.length} ${s.searches.length === 1 ? 'search' : 'searches'}`} />
        <Tile icon="star" label="Qualified (A or B)" value={s.qualified.toLocaleString()} note={`${pct(s.qualified, s.total)} of all leads`} />
        <Tile icon="mail" label="With an email" value={s.withEmail.toLocaleString()} note={`${pct(s.withEmail, s.total)} of all leads`} />
        <Tile icon="send" label="Pushed to GHL" value={s.pushed.toLocaleString()} note={toPush > 0 ? `${toPush.toLocaleString()} qualified still waiting` : 'All qualified leads sent'} />
      </div>

      <div className="grid-2">
        <section className="panel material" aria-labelledby="pipe-h">
          <div className="panel-head"><h2 id="pipe-h">From found to sent</h2><span className="hint">leads at each step</span></div>
          <Bars caption="Leads at each step of the workflow" max={s.total} rows={[
            { label: 'Found', value: s.total },
            { label: 'Can be contacted', value: s.contactable, note: 'email or phone' },
            { label: 'Angle written', value: s.withAngle },
            { label: 'Named contact found', value: s.withPerson, note: 'a person published on their site' },
            { label: 'Qualified (A–B)', value: s.qualified },
            { label: 'Pushed to GHL', value: s.pushed },
          ]} />
        </section>
        <section className="panel material" aria-labelledby="prio-h">
          <div className="panel-head"><h2 id="prio-h">Lead quality</h2><span className="hint num">average score {s.avgScore}/100</span></div>
          <Bars caption="Leads by priority" rows={[
            { label: 'A · 80 and up', value: s.priority.A }, { label: 'B · 60 to 79', value: s.priority.B },
            { label: 'C · 40 to 59', value: s.priority.C }, { label: 'D · under 40', value: s.priority.D },
          ]} />
        </section>
      </div>

      <section className="panel material" aria-labelledby="recent-h">
        <div className="panel-head">
          <h2 id="recent-h">Your searches</h2><span className="hint">newest first</span><span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={onFind}><Icon name="search" size={16} />New search</button>
        </div>
        <div className="table-wrap inset">
          <table className="simple">
            <thead><tr><th scope="col">Business type</th><th scope="col">Place</th><th scope="col" className="r">Leads</th><th scope="col" className="r">Qualified</th><th scope="col" className="r">Pushed</th><th scope="col">Last checked</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {s.searches.slice(0, 8).map(x => (
                <tr key={x.key}>
                  <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{x.type}</td>
                  <td>{x.place || <span className="muted">Unknown</span>}</td>
                  <td className="r num">{x.count}</td><td className="r num">{x.qualified}</td><td className="r num">{x.pushed}</td>
                  <td className="muted">{x.lastChecked ? new Date(x.lastChecked).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '–'}</td>
                  <td className="r"><button type="button" className="btn btn-ghost" onClick={() => onOpenSearch(x.key)}>Open<Icon name="chevron" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="fold material">
        <summary><Icon name="chevron" size={16} className="chev" />What to pitch<span className="hint">services recommended most, and the gaps behind them</span></summary>
        <div className="fold-body">
          <div className="grid-2" style={{ marginTop: 8 }}>
            <div className="panel inset"><div className="panel-head"><h2 style={{ fontSize: 14 }}>Recommended service</h2></div>
              {s.services.length ? <Bars caption="Leads by recommended service" rows={s.services.slice(0, 6).map(x => ({ label: x.name.replace(/ System$/, ''), value: x.count }))} /> : <p className="muted">No outreach angles written yet.</p>}
            </div>
            <div className="panel inset"><div className="panel-head"><h2 style={{ fontSize: 14 }}>Gaps we observed</h2></div>
              {s.gaps.length ? <Bars caption="Leads by observed gap" rows={s.gaps.slice(0, 6).map(x => ({ label: x.label, value: x.count }))} /> : <p className="muted">No gaps observed yet.</p>}
            </div>
          </div>
        </div>
      </details>

      <details className="fold material">
        <summary><Icon name="chevron" size={16} className="chev" />GHL status and system<span className="hint">who already uses GoHighLevel, and what is connected</span></summary>
        <div className="fold-body">
          <div className="grid-2" style={{ marginTop: 8 }}>
            <div className="panel inset"><div className="panel-head"><h2 style={{ fontSize: 14 }}>GoHighLevel on their website</h2></div>
              <Bars caption="Leads by GHL status" rows={[{ label: 'No GHL found', value: s.ghl.potential }, { label: 'Likely GHL user', value: s.ghl.likely }, { label: 'Not enough info', value: s.ghl.insufficient }]} />
              <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>Based on public website code only. It never confirms a subscription.</p>
            </div>
            <div className="panel inset"><div className="panel-head"><h2 style={{ fontSize: 14 }}>System</h2></div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                <li className="status-row"><span className="dot" data-ok={system?.ollama} />{system?.ollama ? `AI writer ready (Ollama, ${system.ollamaModel})` : 'AI writer off. Start Ollama for AI-written angles; templates are used meanwhile.'}</li>
                <li className="status-row" style={{ whiteSpace: 'normal' }}><span className="dot" data-ok={system?.ghl} />{system?.ghl ? 'GHL connected' : 'GHL not set up. Add GHL_TOKEN and GHL_LOCATION_ID to .env to push leads.'}</li>
                <li className="status-row"><span className="dot" data-ok />Business data: OpenStreetMap + Overture Maps (free)</li>
              </ul>
            </div>
          </div>
        </div>
      </details>
    </>
  );
}

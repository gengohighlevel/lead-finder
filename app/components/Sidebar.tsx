import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './Icons';

export type View = 'dashboard' | 'find' | 'library' | 'playbook' | 'settings';
export type System = { ollama: boolean; ollamaModel: string; ghl: boolean; senderReady?: boolean };

/** Menu grouped by job: see the big picture, find and manage leads, then outreach copy. */
export const NAV: { label: string; items: { id: View; text: string; icon: string }[] }[] = [
  { label: 'Overview', items: [{ id: 'dashboard', text: 'Dashboard', icon: 'dashboard' }] },
  { label: 'Prospecting', items: [{ id: 'find', text: 'Find leads', icon: 'search' }, { id: 'library', text: 'Lead library', icon: 'users' }] },
  { label: 'Outreach', items: [{ id: 'playbook', text: 'Playbook', icon: 'book' }] },
  { label: 'System', items: [{ id: 'settings', text: 'Settings', icon: 'settings' }] },
];

/** Sign-out button for the hosted app (shown on phones, where the sidebar footer is hidden). Renders nothing on the local app. */
export function SignOutButton() {
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => { fetch('/api/auth/me', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => setMe(j?.email ?? null)).catch(() => {}); }, []);
  if (!me) return null;
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* the cookie still expires */ }
    window.location.href = '/login';
  }
  return <button type="button" className="link-btn mobile-only" style={{ marginLeft: 'auto' }} onClick={signOut} title={`Signed in as ${me}`}>Sign out</button>;
}

export function Sidebar({ view, onNavigate, system, leadCount, sideRef }: {
  view: View; onNavigate: (v: View) => void; system: System | null; leadCount: number | null; sideRef: React.RefObject<HTMLElement | null>;
}) {
  // hosted with the app's own login: who is signed in, and a way to sign out. On the local app /api/auth/me is 401 and nothing shows.
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => { fetch('/api/auth/me', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => setMe(j?.email ?? null)).catch(() => {}); }, []);
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* the cookie still expires */ }
    window.location.href = '/login';
  }
  // one selection pill that glides between items. It is always full width, so only its height and vertical position
  // are measured (on view change), never while the sidebar is resizing.
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const a = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!a) return setPill(null);
      setPill({ transform: `translateY(${a.offsetTop}px)`, height: a.offsetHeight });
    };
    place();
    document.fonts?.ready.then(place);
  }, [view]);

  return (
    <aside className="sidebar glass" ref={sideRef}>
      <div className="brand">
        <span className="brand-mark" style={{ fontWeight: 700, fontSize: 13, color: '#27304f' }}>LF</span>
        <span className="brand-name">Lead Finder</span>
      </div>
      <nav aria-label="Main" ref={navRef}>
        {pill && <span className="nav-pill" style={pill} aria-hidden="true" />}
        {NAV.map(g => (
          <div className="nav-group" key={g.label}>
            <div className="nav-label" id={`nav-${g.label}`}>{g.label}</div>
            <ul className="nav-list" aria-labelledby={`nav-${g.label}`}>
              {g.items.map(i => (
                <li key={i.id}>
                  <button type="button" className="nav-item" aria-current={view === i.id ? 'page' : undefined} onClick={() => onNavigate(i.id)} title={i.text}>
                    <Icon name={i.icon} />
                    <span className="nav-text">{i.text}</span>
                    {i.id === 'library' && leadCount ? <span className="nav-count num">{leadCount}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="sidebar-foot" aria-label="System status">
        <div className="status-row" title={system ? (system.ollama ? `Ollama running (${system.ollamaModel})` : 'Ollama not running: template openers will be used') : 'Checking…'}>
          <span className="dot" data-ok={system ? system.ollama : undefined} />
          <span className="status-text">{system ? (system.ollama ? 'AI writer ready' : 'AI writer off') : 'Checking AI writer…'}</span>
        </div>
        <div className="status-row" title={system ? (system.ghl ? 'GHL token and location set' : 'Add GHL_TOKEN and GHL_LOCATION_ID to .env') : 'Checking…'}>
          <span className="dot" data-ok={system ? system.ghl : undefined} />
          <span className="status-text">{system ? (system.ghl ? 'GHL connected' : 'GHL not set up') : 'Checking GHL…'}</span>
        </div>
        <div className="status-row" title={system ? (system.senderReady ? 'Email drafts carry your name, business, address and opt-out line' : 'Add SENDER_NAME, SENDER_BUSINESS, SENDER_ADDRESS and SENDER_EMAIL to .env.server: drafts have no opt-out footer without them') : 'Checking…'}>
          <span className="dot" data-ok={system ? !!system.senderReady : undefined} />
          <span className="status-text">{system ? (system.senderReady ? 'Email sender set up' : 'Email sender details missing') : 'Checking email sender…'}</span>
        </div>
        {me && (
          <div className="account" title={`Signed in as ${me}`}>
            <span className="account-email">{me}</span>
            <button type="button" className="btn btn-ghost account-out" onClick={signOut}>Sign out</button>
          </div>
        )}
      </div>
    </aside>
  );
}

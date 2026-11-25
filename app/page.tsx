'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Stats } from '@/lib/stats';
import { Sidebar, SignOutButton, type System, type View } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { FindLeads } from './components/FindLeads';
import { Library } from './components/Library';
import { Playbook } from './components/Playbook';
import { Settings } from './components/Settings';
import { Icon } from './components/Icons';
import { get } from './components/api';

const HEAD: Record<View, [string, string]> = {
  dashboard: ['Dashboard', 'Where your leads stand, from found to sent.'],
  find: ['Find leads', 'Search a business type and place, review the scored results, then send the best to GHL.'],
  library: ['Lead library', 'Every lead you have saved. Filter, edit angles and push when ready.'],
  playbook: ['Playbook', 'The copy rules and questions the app uses to write outreach angles.'],
  settings: ['Settings', 'Make it yours: background, theme and how the cards look. Saved on this computer.'],
};
const VIEWS = Object.keys(HEAD) as View[];
const fromHash = (): View => {
  const h = window.location.hash.slice(1) as View;
  return VIEWS.includes(h) ? h : 'dashboard';
};

export default function Home() {
  const [view, setView] = useState<View>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [system, setSystem] = useState<System | null>(null);
  const [libraryKey, setLibraryKey] = useState('all');
  const [libraryVersion, setLibraryVersion] = useState(0);

  const refresh = useCallback(() => {
    get('/api/stats').then(j => { setStats(j.stats); setSystem(j.system); }).catch(() => {});
    setLibraryVersion(v => v + 1); // library re-reads next time it opens
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // the view lives in the URL hash so refresh and back/forward keep your place
  useEffect(() => {
    setView(fromHash());
    try { setCollapsed(localStorage.getItem('nav-collapsed') === '1'); } catch { /* private mode */ }
    const onHash = () => setView(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (v: View) => { window.location.hash = v; setView(v); window.scrollTo({ top: 0, behavior: 'instant' }); };
  /* Collapse without animating layout. The grid jumps to its final columns at once; the content then slides from where it
     was (transform, compositor only) and the sidebar eases its width. Animating grid-template-columns re-lays-out every
     panel on every frame, which is what made it stutter. */
  const sideRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const before = useRef<{ side: number; left: number } | null>(null);
  const toggle = () => {
    if (sideRef.current && mainRef.current) before.current = { side: sideRef.current.offsetWidth, left: mainRef.current.getBoundingClientRect().left };
    setCollapsed(c => { try { localStorage.setItem('nav-collapsed', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  };
  useLayoutEffect(() => {
    const b = before.current, side = sideRef.current, main = mainRef.current;
    before.current = null;
    if (!b || !side || !main || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const opts: KeyframeAnimationOptions = { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
    main.animate([{ transform: `translateX(${b.left - main.getBoundingClientRect().left}px)` }, { transform: 'translateX(0)' }], opts);
    side.animate([{ width: `${b.side}px` }, { width: `${side.offsetWidth}px` }], opts);
  }, [collapsed]);

  const [title, sub] = HEAD[view];
  return (
    <div className="shell" data-collapsed={collapsed}>
      <Sidebar view={view} onNavigate={go} system={system} leadCount={stats?.total ?? null} sideRef={sideRef} />
      <div className="scroll-edge" aria-hidden="true" />
      <main className="main" ref={mainRef}>
        <header className="page-head glass">
          {/* Apple places the sidebar toggle in the toolbar, not inside the sidebar */}
          <button type="button" className="icon-btn collapse-btn" onClick={toggle} aria-label={collapsed ? 'Show menu labels' : 'Hide menu labels'} aria-pressed={collapsed} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
            <Icon name="sidebar" />
          </button>
          <div><h1>{title}</h1><p>{sub}</p></div>
          <SignOutButton />
        </header>
        {view === 'dashboard' && <div className="view"><Dashboard stats={stats} system={system} onFind={() => go('find')} onOpenSearch={k => { setLibraryKey(k); go('library'); }} /></div>}
        {/* kept mounted so a running search survives a trip to another page */}
        <div className="view" hidden={view !== 'find'}>
          <FindLeads onChanged={refresh} aiReady={system ? system.ollama : null} />
        </div>
        {view === 'library' && <div className="view"><Library key={libraryVersion} searchKey={libraryKey} onSearchKey={setLibraryKey} onChanged={() => get('/api/stats').then(j => setStats(j.stats)).catch(() => {})} onFind={() => go('find')} /></div>}
        {view === 'playbook' && <div className="view"><Playbook /></div>}
        {view === 'settings' && <div className="view"><Settings /></div>}
      </main>
    </div>
  );
}

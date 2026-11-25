'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Lead, StoredLead } from '@/lib/db';
import { Icon } from './Icons';
import { get } from './api';
import { ResultsPanel } from './ResultsPanel';

const typeOfKey = (k: string) => k.split('|')[0];

/** Every lead saved so far, across all searches. */
export function Library({ searchKey, onSearchKey, onChanged, onFind }: { searchKey: string; onSearchKey: (k: string) => void; onChanged: () => void; onFind: () => void }) {
  const [all, setAll] = useState<StoredLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // business type and country filters (on top of the per-search filter below)
  const [typeFilter, setTypeFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');

  useEffect(() => {
    get('/api/leads').then(j => setAll(j.leads)).catch(e => setError(e instanceof Error ? e.message : 'Could not load leads'));
  }, []);

  const countryOf = (l: StoredLead) => (l.research?.country ?? '').toUpperCase();
  const countOf = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const types = useMemo(() => countOf((all ?? []).map(l => typeOfKey(l.searchKey))), [all]);
  const countries = useMemo(() => countOf((all ?? []).map(countryOf).filter(Boolean)), [all]);
  const searches = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const l of all ?? []) {
      if (typeFilter !== 'all' && typeOfKey(l.searchKey) !== typeFilter) continue;
      const g = m.get(l.searchKey) ?? { label: [typeOfKey(l.searchKey), l.research?.city].filter(Boolean).join(' in '), count: 0 };
      g.count++; m.set(l.searchKey, g);
    }
    return [...m];
  }, [all, typeFilter]);
  const keyOf = useMemo(() => new Map((all ?? []).map(l => [l.id, l.searchKey])), [all]);
  const shown = useMemo(() => (all ?? []).filter(l => (searchKey === 'all' || l.searchKey === searchKey)
    && (typeFilter === 'all' || typeOfKey(l.searchKey) === typeFilter) && (countryFilter === 'all' || countryOf(l) === countryFilter)), [all, searchKey, typeFilter, countryFilter]);

  if (error) return <div className="callout material" data-tone="bad" role="alert"><Icon name="alert" />{error}</div>;
  if (!all) return <div className="callout material" data-tone="info" role="status"><Icon name="loader" className="spin" />Loading saved leads…</div>;
  if (!all.length) return (
    <div className="empty material">
      <Icon name="users" size={34} />
      <h2>No saved leads yet</h2>
      <p>Every search you run is saved here so you can come back, filter and push later.</p>
      <button type="button" className="btn btn-primary" onClick={onFind}><Icon name="search" size={16} />Find leads</button>
    </div>
  );

  return (
    <ResultsPanel leads={shown} reviewStep={1} exportName={searchKey !== 'all' ? typeOfKey(searchKey) : typeFilter !== 'all' ? typeFilter : 'library'} onPushed={onChanged}
      typeOf={(l: Lead) => typeOfKey(keyOf.get(l.id) ?? '')}
      setLeads={fn => setAll(prev => {
        if (!prev) return prev;
        const next = typeof fn === 'function' ? fn(prev) : fn;
        return next.map(l => ({ ...l, searchKey: keyOf.get(l.id) ?? '' }));
      })}
      extraFilters={<>
        <select className="select" aria-label="Filter by business type" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); if (searchKey !== 'all' && typeOfKey(searchKey) !== e.target.value && e.target.value !== 'all') onSearchKey('all'); }} style={{ maxWidth: 220 }}>
          <option value="all">All business types ({all.length})</option>
          {types.map(([t, n]) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)} ({n})</option>)}
        </select>
        <select className="select" aria-label="Filter by country" value={countryFilter} onChange={e => setCountryFilter(e.target.value)} style={{ maxWidth: 170 }}>
          <option value="all">All countries</option>
          {countries.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
        </select>
        <select className="select" aria-label="Filter by search" value={searchKey} onChange={e => onSearchKey(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="all">All searches ({all.length})</option>
          {searches.map(([k, g]) => <option key={k} value={k}>{g.label} ({g.count})</option>)}
        </select>
      </>} />
  );
}

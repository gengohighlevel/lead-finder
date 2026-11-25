'use client';
import { useEffect, useState } from 'react';
import type { Lead } from '@/lib/db';
import { Icon } from './Icons';
import { post } from './api';
import { ResultsPanel } from './ResultsPanel';

type Place = { osmType: string; osmId: number; lat: number; lon: number; label: string; countryCode?: string };
const MARKETS: [string, string][] = [['all', 'All my markets'], ['us', 'United States'], ['ca', 'Canada'], ['au', 'Australia'], ['nz', 'New Zealand'], ['ph', 'Philippines'], ['eu', 'European Union'], ['world', 'Anywhere in the world']];

/** The search workflow in order: 1 search, 2 review, 3 send. */
export function FindLeads({ onChanged, aiReady }: { onChanged: () => void; aiReady: boolean | null }) {
  const [type, setType] = useState('');
  const [location, setLocation] = useState('');
  const [country, setCountry] = useState('all');
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeIdx, setPlaceIdx] = useState(0);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<{ checked: number; written: number; total: number } | null>(null);
  const [source, setSource] = useState<'map' | 'fallback'>('map');
  const [lookingUp, setLookingUp] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [nameOnly, setNameOnly] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [ollamaDown, setOllamaDown] = useState(false);
  const [searchedType, setSearchedType] = useState('');

  // look up exact places as the user types (debounced; server throttles to 1 req/s)
  useEffect(() => {
    setPlaces([]); setPlaceIdx(0);
    if (location.trim().length < 2) { setGeoMsg(null); return; }
    setGeoMsg('Finding place…');
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const j = await post('/api/geocode', { location, country });
        if (cancelled) return;
        setPlaces(j.candidates); setGeoMsg(j.candidates.length ? null : 'No place found. Check the spelling or market.');
      } catch (e) { if (!cancelled) setGeoMsg(e instanceof Error ? e.message : 'Place lookup failed'); }
    }, 700);
    return () => { cancelled = true; clearTimeout(t); };
  }, [location, country]);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const place = places[placeIdx];
    if (!type.trim()) { setError('Enter a business type first, for example "dentist".'); return; }
    if (!place) { setError('Pick a place first. Type a location and wait for the match list.'); return; }
    setError(null); setOllamaDown(false); setLeads([]); setSearching(true);
    try {
      // 1. the list: answers as soon as the map does
      const { leads: found, matchedBy, source: from, skippedExisting } = (await post('/api/search', { type, place })) as { leads: Lead[]; matchedBy: string; source: 'map' | 'fallback'; skippedExisting?: number };
      setSkipped(skippedExisting ?? 0);
      setNameOnly(matchedBy === 'name');
      setSource(from);
      setSearchedType(type.trim());
      setLeads(found);
      setSearching(false);
      if (!found.length) { setError('No results. Try a broader business type or another location.'); return; }
      const merge = (fresh: Lead[]) => setLeads(prev => prev.map(l => fresh.find(x => x.id === l.id) ?? l));
      const ids = found.map(l => l.id);
      setProgress({ checked: 0, written: 0, total: ids.length });

      // 2. websites, 16 at a time; 3. angles for each checked batch, written while the next batch is being checked
      let angles: Promise<void> = Promise.resolve();
      let people: Promise<void> = Promise.resolve();
      for (let i = 0; i < ids.length; i += 16) {
        const batch = ids.slice(i, i + 16);
        const r = (await post('/api/enrich', { ids: batch, type, place })) as { leads: Lead[] };
        merge(r.leads);
        setProgress(p => p && { ...p, checked: p.checked + batch.length });
        // 2b. people finder, only for qualified (A or B) leads that have a website; runs beside the angle writing
        const worth = r.leads.filter(l => l.website && (l.research?.score.priority === 'A' || l.research?.score.priority === 'B')).map(l => l.id);
        if (worth.length) {
          setLookingUp(p => new Set([...p, ...worth]));
          people = people.then(async () => {
            try {
              const pr = (await post('/api/people', { ids: worth })) as { leads: Lead[] };
              setLeads(prev => prev.map(l => { const f = pr.leads.find(x => x.id === l.id); return f ? { ...l, research: f.research ?? l.research } : l; }));
            } catch { /* people are a bonus: a failure here must not stop the search */ }
            setLookingUp(p => { const n = new Set(p); worth.forEach(id => n.delete(id)); return n; });
          });
        }
        angles = angles.then(async () => {
          for (let k = 0; k < batch.length; k += 5) {
            const chunk = batch.slice(k, k + 5);
            const s = (await post('/api/score', { ids: chunk, type })) as { leads: Lead[]; ollamaDown: boolean };
            if (s.ollamaDown) setOllamaDown(true);
            merge(s.leads);
            setProgress(p => p && { ...p, written: p.written + chunk.length });
          }
        });
      }
      await Promise.all([angles, people]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally { setSearching(false); setProgress(null); onChanged(); }
  }

  const scoring = !!progress;
  const step = leads.length ? 2 : 1;
  const steps = ['Search', 'Review leads', 'Send to GHL'];

  return (
    <>
      <ol className="stepper glass" aria-label="Workflow">
        {steps.map((s, i) => {
          const state = i + 1 < step ? 'done' : i + 1 === step ? 'now' : 'todo';
          return <li key={s} data-state={state} aria-current={state === 'now' ? 'step' : undefined}><span className="step-num" data-state={state === 'now' ? undefined : state}>{state === 'done' ? <Icon name="check" size={14} /> : i + 1}</span>{s}</li>;
        })}
      </ol>

      <section className="panel material" aria-labelledby="search-h">
        <div className="panel-head">
          <span className="step-num" data-state={leads.length ? 'done' : undefined}>{leads.length ? <Icon name="check" size={14} /> : 1}</span>
          <h2 id="search-h">Search</h2>
          <span className="hint">What kind of business, and where?</span>
        </div>
        <form onSubmit={runSearch} className="search-grid">
          <label className="field"><span>Business type</span>
            <input className="input" placeholder="e.g. dentist, makeup artist, personal trainer" value={type} onChange={e => setType(e.target.value)} />
          </label>
          <label className="field"><span>Market</span>
            <select className="select" value={country} onChange={e => setCountry(e.target.value)}>{MARKETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="field"><span>City or area</span>
            <input className="input" placeholder="e.g. Austin, TX" value={location} onChange={e => setLocation(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={searching || scoring || !places.length}>
            <Icon name={searching ? 'loader' : 'search'} size={16} className={searching ? 'spin' : undefined} />{searching ? 'Searching…' : 'Search'}
          </button>
          {(places.length > 0 || geoMsg) && (
            <label className="field wide"><span>Exact place to search in</span>
              {places.length > 0
                ? <select className="select" value={placeIdx} onChange={e => setPlaceIdx(Number(e.target.value))}>{places.map((p, i) => <option key={`${p.osmType}${p.osmId}`} value={i}>{p.label}</option>)}</select>
                : <span className="muted" role="status">{geoMsg}</span>}
            </label>
          )}
        </form>
        <details className="fold inset" style={{ marginTop: 14 }}>
          <summary><Icon name="chevron" size={16} className="chev" />Search tips<span className="hint">what works, and the limits</span></summary>
          <div className="fold-body">
            <ul>
              <li>Common terms match best: “dentist”, “plumber”, “hair salon”, “moving company”, “real estate”.</li>
              <li>Business data comes from OpenStreetMap and Overture Maps, two free open datasets (plus the US NPI registry for healthcare). Listings can be out of date, so check the website.</li>
              <li>Each website’s home and contact pages are read for email, socials and gaps. Emails are never guessed.</li>
              <li>The AI writer (Ollama) runs on this computer. If it is off, playbook templates are used instead.</li>
            </ul>
          </div>
        </details>
      </section>

      {searching && <div className="callout material" data-tone="info" role="status"><Icon name="loader" className="spin" />Searching the map…</div>}
      {progress && (
        <div className="callout material" data-tone="info" role="status"><Icon name="loader" className="spin" />
          <div style={{ flex: 1 }}>
            {progress.checked < progress.total ? <>Checking websites <span className="num">{progress.checked} of {progress.total}</span> · </> : null}
            Writing outreach angles <span className="num">{progress.written} of {progress.total}</span>
            <div className="progress"><div style={{ width: `${((progress.checked + progress.written) / (2 * progress.total)) * 100}%` }} /></div>
          </div>
        </div>
      )}
      {source === 'fallback' && leads.length > 0 && <div className="callout material" data-tone="info"><Icon name="info" /><span>The map servers are down, so these came from OpenStreetMap’s place search instead: the same map data, up to 100 results inside a box around the place. Search again later for the exact area.</span></div>}
      {skipped > 0 && <div className="callout material" data-tone="info"><Icon name="info" /><span>{skipped} business{skipped === 1 ? ' was' : 'es were'} left out because {skipped === 1 ? 'it is' : 'they are'} already saved by an earlier search (same website, phone, or name and address). {skipped === 1 ? 'It is' : 'They are'} still in the Lead library.</span></div>}
      {error && <div className="callout material" data-tone="bad" role="alert"><Icon name="alert" />{error}</div>}
      {nameOnly && leads.length > 0 && <div className="callout material" data-tone="info"><Icon name="info" /><span>No exact category for “{searchedType}”, so this matched business <b>names</b> only. Results may be incomplete. Try a common term like “plumber” or “dentist”.</span></div>}
      {(ollamaDown || (aiReady === false && !leads.length && !searching)) && <div className="callout material" data-tone="warn"><Icon name="alert" /><span>The AI writer (Ollama) isn’t running, so playbook templates {ollamaDown ? 'were' : 'will be'} used for outreach angles. Start Ollama and search again for AI-written ones.</span></div>}

      {leads.length > 0 && (
        <ResultsPanel leads={leads} setLeads={setLeads} typeOf={() => searchedType} exportName={searchedType} scoring={scoring} lookingUp={lookingUp}
          suggestedTag={searchedType.toLowerCase().replace(/\s+/g, '-')} onPushed={onChanged} />
      )}
    </>
  );
}

'use client';
import { Fragment, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Lead } from '@/lib/db';
import { toRecord, toCsv, gapLabels } from '@/lib/export';
import { PROCESS_LABEL, type Process } from '@/lib/evidence';
import { opportunitiesFor, UNCHECKED_LABEL, SITE_CHECK_VERSION } from '@/lib/research';
import { reachChannels, dmDraft } from '@/lib/channel';
import { isSendable, canSend, EMAIL_CHECK_VERSION } from '@/lib/emailStatus';
import { emailDecision, leadSuppression, DEFAULT_GATE, type GateState } from '@/lib/emailGate';
import { WEAK_CRITERIA, type WeakCriterion } from '@/lib/weak';
import { toE164, isMobileNumber } from '@/lib/phone';
import { Icon } from './Icons';
import { post } from './api';
import { CounterPitchPanel, CounterPitchBadge } from './CounterPitchPanel';

const GHL_BADGE: Record<string, [string, string]> = {
  likely: ['Likely GHL user', 'violet'], potential: ['No GHL found', 'accent'], insufficient: ['Not enough info', ''],
};
const FACTOR_LABEL: Record<string, [string, number]> = {
  crmRelevance: ['Fit for our services', 25], leadGenDependency: ['Relies on inquiries', 20], customerValue: ['Customer value', 15],
  workflowComplexity: ['Process complexity', 15], contactAccessibility: ['Easy to contact', 10], actionableOpportunity: ['Clear opportunity', 15],
};
const PRIORITIES: [string, string][] = [['D', 'All'], ['C', 'A–C'], ['B', 'A–B'], ['A', 'A only']];
const PAGE = 30; // rows drawn at a time; long lists stay fast
const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const pretty = (u: string) => u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

function download(name: string, text: string, mime: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

/** Steps 2 and 3 of the workflow: review the leads, then send the chosen ones to GHL. Shared by Find leads and Lead library. */
export function ResultsPanel({ leads, setLeads, typeOf, exportName, suggestedTag, scoring = false, reviewStep = 2, extraFilters, onPushed, lookingUp }: {
  leads: Lead[]; setLeads: Dispatch<SetStateAction<Lead[]>>; typeOf: (l: Lead) => string; exportName: string;
  suggestedTag?: string; scoring?: boolean; reviewStep?: number; extraFilters?: ReactNode; onPushed?: () => void;
  /** ids the parent is looking up people for right now (automatic lookup after a search) */
  lookingUp?: Set<number>;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState<number | null>(null);
  const [rechecking, setRechecking] = useState(0);
  const [approving, setApproving] = useState<number | null>(null);
  // your country rules and do-not-contact list: the page applies the same gate the push does
  const [gate, setGate] = useState<GateState>(DEFAULT_GATE);
  useEffect(() => { fetch('/api/gate', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.policy) setGate({ policy: j.policy, suppressions: j.suppressions ?? [] }); }).catch(() => {}); }, []);
  async function addDnc(l: Lead) {
    const why = window.prompt(`Add ${l.name} to your do-not-contact list?\n\nIts email, website domain and phone will never be sent to GHL again, and it is flagged if a later search finds it. Optional note (why):`, '');
    if (why === null) return;
    setError(null);
    try {
      const r = (await post('/api/dnc', { fromLead: l.id, ...(why.trim() ? { reason: why.trim().slice(0, 200) } : {}) })) as { suppressions: GateState['suppressions'] };
      setGate(g => ({ ...g, suppressions: r.suppressions }));
      setSel(p => { const n = new Set(p); n.delete(l.id); return n; });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add to the list'); }
  }

  // ---- clean up: delete weak leads, delete selected, forget a business. Always backed up first; pushed leads are never deleted here.
  const [cleanOpen, setCleanOpen] = useState(false);
  const [crit, setCrit] = useState<Set<WeakCriterion>>(new Set<WeakCriterion>(['priority-d', 'no-way-to-reach', 'dead-email-only', 'business-closed', 'duplicate', 'junk-name']));
  const [preview, setPreview] = useState<{ count: number; protectedPushed: number; byCriterion: Record<string, number>; sample: string[] } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!cleanOpen) return;
    let live = true;
    post('/api/leads/weak', { criteria: [...crit] }).then(r => { if (live) setPreview(r); }).catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [cleanOpen, crit]);
  function removeFromView(ids: number[]) {
    const gone = new Set(ids);
    setLeads(p => p.filter(x => !gone.has(x.id)));
    setSel(p => new Set([...p].filter(id => !gone.has(id))));
    onPushed?.();
  }
  async function deleteWeak() {
    if (!preview || !preview.count) return;
    if (!window.confirm(`Delete ${preview.count} weak lead${preview.count === 1 ? '' : 's'} from your whole library?\n\nYour library is backed up first. Leads already pushed to GHL are never deleted here.\n\nExamples: ${preview.sample.slice(0, 4).join(', ')}${preview.count > 4 ? '…' : ''}`)) return;
    setCleaning(true); setError(null); setCleanMsg(null);
    try {
      const r = (await post('/api/leads/delete', { criteria: [...crit], expected: preview.count })) as { deleted: number; ids: number[]; backup?: string; skippedPushed: number };
      removeFromView(r.ids);
      setCleanMsg(`Deleted ${r.deleted}.${r.skippedPushed ? ` ${r.skippedPushed} already pushed to GHL were kept.` : ''}${r.backup ? ` Backup: ${r.backup}` : ''}`);
      setPreview(null); setCrit(c => new Set(c));
    } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setCleaning(false); }
  }
  async function deleteSelected() {
    const ids = [...sel];
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected lead${ids.length === 1 ? '' : 's'}?\n\nYour library is backed up first. Leads already pushed to GHL are skipped.`)) return;
    setCleaning(true); setError(null); setCleanMsg(null);
    try {
      const r = (await post('/api/leads/delete', { ids })) as { deleted: number; ids: number[]; backup?: string; skippedPushed: number };
      removeFromView(r.ids);
      setCleanMsg(`Deleted ${r.deleted}.${r.skippedPushed ? ` ${r.skippedPushed} already pushed to GHL were kept.` : ''}${r.backup ? ` Backup: ${r.backup}` : ''}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setCleaning(false); }
  }
  async function forgetLead(l: Lead) {
    if (!window.confirm(`Forget ${l.name}?\n\nIts email, website and phone go on your do-not-contact list, and it is deleted everywhere in your library (even if pushed). Your library is backed up first.\n\nIf it was pushed to GHL, delete or unsubscribe the contact there too.`)) return;
    setCleaning(true); setError(null); setCleanMsg(null);
    try {
      const r = (await post('/api/leads/forget', { id: l.id })) as { deleted: number; ids: number[]; backup?: string; note?: string };
      removeFromView(r.ids);
      setCleanMsg(`${l.name} forgotten (${r.deleted} record${r.deleted === 1 ? '' : 's'}). ${r.note ?? ''}`);
      fetch('/api/gate', { cache: 'no-store' }).then(x => x.json()).then(j => { if (j?.policy) setGate({ policy: j.policy, suppressions: j.suppressions ?? [] }); }).catch(() => {});
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not forget'); }
    finally { setCleaning(false); }
  }
  const [tags, setTags] = useState('');
  const [minPriority, setMinPriority] = useState('D');
  const [ghlFilter, setGhlFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [pushing, setPushing] = useState(false);
  const [finding, setFinding] = useState<Set<number>>(new Set());
  const [checkingEmails, setCheckingEmails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<number, { ok: boolean; text: string; warn?: boolean }>>({});

  useEffect(() => { if (suggestedTag) setTags(prev => (prev.trim() ? prev : suggestedTag)); }, [suggestedTag]);
  // drop selections for leads that left the list (new search, changed library filter)
  useEffect(() => { const ids = new Set(leads.map(l => l.id)); setSel(p => new Set([...p].filter(id => ids.has(id)))); }, [leads]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads
      .filter(l => !l.research || l.research.score.priority <= minPriority)
      .filter(l => ghlFilter === 'all' || (ghlFilter === 'hide' ? l.research?.ghlStatus !== 'likely' : l.research?.ghlStatus === 'likely'))
      .filter(l => !q || `${l.name} ${l.address ?? ''} ${l.email ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.research?.score.total ?? 0) - (a.research?.score.total ?? 0));
  }, [leads, minPriority, ghlFilter, query]);
  const allSelected = visible.length > 0 && visible.every(l => sel.has(l.id));

  // "Ready to send": angle writing has finished, and these qualified (A or B) leads have an angle and are not in GHL yet.
  // Qualified leads without an angle (older searches) are left out rather than blocking the rest.
  const waiting = useMemo(() => visible.filter(l => (l.research?.score.priority === 'A' || l.research?.score.priority === 'B') && !!l.opener?.trim() && !l.pushedAt && !status[l.id]?.ok && !leadSuppression(l, gate)), [visible, status, gate]);
  const ready = !scoring && !pushing && waiting.length > 0;
  const waitingPicked = ready && waiting.every(l => sel.has(l.id));
  // each time the list becomes ready, the plane on the Push button lands and starts to hover
  const [flight, setFlight] = useState(0);
  const [sent, setSent] = useState(0);
  useEffect(() => { if (ready) setFlight(n => n + 1); }, [ready]);
  useEffect(() => { if (copied === null) return; const t = setTimeout(() => setCopied(null), 1800); return () => clearTimeout(t); }, [copied]);
  async function copyMessage(id: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(id); }
    catch { setError('Could not copy. Open the research panel and copy the message by hand.'); }
  }
  useEffect(() => { if (!sent) return; const t = setTimeout(() => setSent(0), 2600); return () => clearTimeout(t); }, [sent]);
  const flip = (set: Dispatch<SetStateAction<Set<number>>>, id: number) => set(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // People finder: reads each business's own team/about pages. Runs for the selected leads, or every shown lead not looked at yet.
  const unlooked = useMemo(() => visible.filter(l => l.website && l.research && l.research.peopleCheckedAt === undefined), [visible]);
  const peopleTargets = sel.size ? leads.filter(l => sel.has(l.id) && l.website && l.research) : unlooked;
  async function findPeople(force = false) {
    const ids = peopleTargets.map(l => l.id);
    if (!ids.length) return;
    setError(null); setFinding(new Set(ids));
    try {
      for (let i = 0; i < ids.length; i += 8) {
        const r = (await post('/api/people', { ids: ids.slice(i, i + 8), force })) as { leads: Lead[] };
        setLeads(p => p.map(x => r.leads.find(y => y.id === x.id) ?? x));
        setFinding(p => { const n = new Set(p); ids.slice(i, i + 8).forEach(id => n.delete(id)); return n; });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'People lookup failed');
    } finally { setFinding(new Set()); onPushed?.(); }
  }

  // how many leads share each third-party GHL domain: the same domain on several unrelated businesses is an agency
  const agencyCount = useMemo(() => { const c: Record<string, number> = {}; for (const l of leads) { const d = l.research?.ghlVia?.domain; if (d) c[d] = (c[d] ?? 0) + 1; } return c; }, [leads]);

  // Approve (or undo) an email by hand. Only for ownership doubts; the server refuses anything else.
  async function approveEmail(l: Lead, approve: boolean) {
    if (approve && !window.confirm(`Approve ${l.email}?\n\nYou are saying this address belongs to ${l.name}. It will then be sent to GHL and may be emailed. If it is wrong, mail may bounce and hurt your sending domain.\n\nWhy it was held: ${l.research?.emailCheck?.reasons.join('; ') ?? ''}`)) return;
    setError(null); setApproving(l.id);
    try {
      const r = (await post('/api/email-approve', { id: l.id, approve })) as { lead: Lead };
      setLeads(p => p.map(x => (x.id === r.lead.id ? r.lead : x)));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not approve'); }
    finally { setApproving(null); }
  }

  // Leads checked by older, less careful website rules: their gaps and outreach may state things that are not true
  const stale = useMemo(() => visible.filter(l => !l.research || (l.research.siteCheck ?? 0) < SITE_CHECK_VERSION), [visible]);
  async function recheckSites() {
    const groups = new Map<string, Lead[]>();
    for (const l of stale) { const k = `${typeOf(l)}|${l.research?.country ?? ''}`; groups.set(k, [...(groups.get(k) ?? []), l]); }
    setError(null); setRechecking(stale.length);
    try {
      for (const [k, group] of groups) {
        const [type, country] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
        for (let i = 0; i < group.length; i += 12) {
          const ids = group.slice(i, i + 12).map(l => l.id);
          await post('/api/enrich', { ids, type, place: { countryCode: country || undefined }, force: true });
          const r = (await post('/api/score', { ids, type })) as { leads: Lead[] };   // rewrites the outreach angle from the corrected facts
          setLeads(p => p.map(x => r.leads.find(y => y.id === x.id) ?? x));
          setRechecking(n => Math.max(0, n - ids.length));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-check failed');
    } finally { setRechecking(0); onPushed?.(); }
  }

  // Email check for leads saved before it existed (new searches do it on their own)
  // never checked, or checked under older, looser rules
  const unchecked = useMemo(() => visible.filter(l => l.email && l.research && (l.research.emailCheck?.v ?? 0) < EMAIL_CHECK_VERSION), [visible]);
  async function checkEmails() {
    const ids = unchecked.map(l => l.id);
    if (!ids.length) return;
    setError(null); setCheckingEmails(true);
    try {
      for (let i = 0; i < ids.length; i += 50) {
        const r = (await post('/api/email-check', { ids: ids.slice(i, i + 50) })) as { leads: Lead[] };
        setLeads(p => p.map(x => r.leads.find(y => y.id === x.id) ?? x));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email check failed');
    } finally { setCheckingEmails(false); }
  }

  async function runPush() {
    setError(null); setPushing(true);
    try {
      const ids = [...sel];
      const openers = Object.fromEntries(leads.filter(l => sel.has(l.id) && l.opener).map(l => [l.id, l.opener]));
      const { results, warning } = await post('/api/push', { ids, tags: tags.split(',').map(t => t.trim()).filter(Boolean), openers });
      if (warning) setError(warning);
      const s: Record<number, { ok: boolean; text: string; warn?: boolean }> = {};
      for (const r of results as { id: number; ok: boolean; error?: string; warning?: string }[]) s[r.id] = r.ok ? { ok: true, text: r.warning ?? 'Pushed', warn: !!r.warning } : { ok: false, text: r.error ?? 'Failed' };
      setStatus(p => ({ ...p, ...s }));
      setSent(Object.values(s).filter(x => x.ok).length);
      onPushed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally { setPushing(false); }
  }

  function exportAs(kind: 'csv' | 'json') {
    const rows = (sel.size ? visible.filter(l => sel.has(l.id)) : visible).map(l => toRecord(l, typeOf(l)));
    const name = `leads-${exportName.replace(/\s+/g, '-') || 'export'}-${new Date().toISOString().slice(0, 10)}`;
    if (kind === 'csv') download(`${name}.csv`, toCsv(rows), 'text/csv');
    else download(`${name}.json`, JSON.stringify({ requested_count: leads.length, returned_count: rows.length,
      research_limitations: ['Business data from OpenStreetMap, Overture Maps and (US healthcare) the NPI registry; coverage varies by area and industry', 'Decision-maker, LinkedIn, company size and revenue not researched', 'GHL status is based on public website code only and never confirms a subscription', 'Only the home and /contact pages were checked'],
      leads: rows }, null, 2), 'application/json');
  }

  return (
    <>
      <section className="panel material" aria-labelledby="review-h">
        <div className="panel-head">
          <span className="step-num">{reviewStep}</span>
          <h2 id="review-h">Review leads</h2>
          <span className="hint num">{visible.length} of {leads.length} shown, best score first</span>
        </div>

        <div className="toolbar">
          <div className="seg" role="group" aria-label="Filter by priority">
            {PRIORITIES.map(([v, t]) => <button key={v} type="button" aria-pressed={minPriority === v} onClick={() => setMinPriority(v)}>{t}</button>)}
          </div>
          <select className="select" aria-label="Filter by GHL status" value={ghlFilter} onChange={e => setGhlFilter(e.target.value)}>
            <option value="all">All GHL statuses</option><option value="hide">Hide likely GHL users</option><option value="only">Only likely GHL users</option>
          </select>
          {extraFilters}
          <button type="button" className="btn" disabled={!peopleTargets.length || finding.size > 0 || scoring}
            title="Reads each business's own About and Team pages for the names and job titles they publish. Names only: emails are never guessed."
            onClick={() => findPeople(peopleTargets.some(l => l.research?.peopleCheckedAt !== undefined))}>
            <Icon name={finding.size ? 'loader' : 'users'} size={16} className={finding.size ? 'spin' : undefined} />
            {finding.size ? `Finding people… ${finding.size} left` : sel.size ? `Find people for ${peopleTargets.length}` : unlooked.length ? `Find people (${unlooked.length})` : 'People found'}
          </button>
          {(stale.length > 0 || rechecking > 0) && (
            <button type="button" className="btn" disabled={rechecking > 0 || scoring || finding.size > 0} onClick={recheckSites}
              title="These leads were checked by older, less careful rules, so their 'What we saw' and outreach angle may say things that are not true (for example 'not on HTTPS' for a site that redirects to https). This reads each website again with the corrected rules and rewrites the outreach angle (edits you made to it are replaced).">
              <Icon name={rechecking ? 'loader' : 'search'} size={16} className={rechecking ? 'spin' : undefined} />
              {rechecking ? `Re-checking… ${rechecking} left` : `Re-check websites (${stale.length})`}
            </button>
          )}
          {unchecked.length > 0 && (
            <button type="button" className="btn" disabled={checkingEmails || scoring} onClick={checkEmails}
              title="Looks up each email's mail server (free, nothing is sent) so addresses that cannot receive mail are flagged and kept out of GHL.">
              <Icon name={checkingEmails ? 'loader' : 'mail'} size={16} className={checkingEmails ? 'spin' : undefined} />
              {checkingEmails ? 'Checking emails…' : `Check emails (${unchecked.length})`}
            </button>
          )}
          <button type="button" className="btn" aria-pressed={cleanOpen} onClick={() => { setCleanOpen(o => !o); setCleanMsg(null); }} title="Delete leads that are not worth keeping. Your library is backed up first.">
            <Icon name="reset" size={16} />Clean up
          </button>
          {sel.size > 0 && <button type="button" className="btn" disabled={cleaning || scoring} onClick={deleteSelected} title="Delete the selected leads (a backup is made first; pushed leads are skipped)">Delete selected ({sel.size})</button>}
          <span className="spacer" />
          <input className="input" type="search" placeholder="Filter by name or address" aria-label="Filter by name or address" value={query} onChange={e => setQuery(e.target.value)} style={{ width: 230 }} />
        </div>

        {cleanMsg && <div className="callout material" data-tone="info" role="status"><Icon name="info" /><span>{cleanMsg}</span></div>}
        {cleanOpen && (
          <div className="callout material" data-tone="info">
            <Icon name="info" />
            <div style={{ display: 'grid', gap: 8 }}>
              <b>Delete weak leads from your whole library</b>
              <span className="sub">Nothing is deleted until you confirm. The library is backed up first, and leads already pushed to GHL are never deleted here. Leads we have not looked at yet are left alone.</span>
              {(Object.keys(WEAK_CRITERIA) as WeakCriterion[]).map(c => (
                <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <input type="checkbox" checked={crit.has(c)} onChange={() => setCrit(p => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n; })} />
                  <span><b>{WEAK_CRITERIA[c].title}</b> <span className="sub">· {WEAK_CRITERIA[c].hint}{preview && crit.has(c) ? ` · ${preview.byCriterion[c] ?? 0} found` : ''}</span></span>
                </label>
              ))}
              <div className="toolbar">
                <button type="button" className="btn" disabled={cleaning || !preview || !preview.count} onClick={deleteWeak}>
                  {cleaning ? 'Deleting…' : preview ? `Delete ${preview.count} lead${preview.count === 1 ? '' : 's'}` : 'Counting…'}
                </button>
                {preview && preview.protectedPushed > 0 && <span className="sub">{preview.protectedPushed} already pushed to GHL will be kept</span>}
                {preview && preview.sample.length > 0 && <span className="sub">e.g. {preview.sample.slice(0, 3).join(', ')}</span>}
              </div>
            </div>
          </div>
        )}
        <div className="table-wrap inset">
          <table className="leads">
            <thead><tr>
              <th scope="col"><input type="checkbox" aria-label="Select all shown leads" checked={allSelected} onChange={() => setSel(allSelected ? new Set() : new Set(visible.filter(l => !leadSuppression(l, gate)).map(l => l.id)))} /></th>
              <th scope="col">Score</th><th scope="col">Business</th><th scope="col">Contact</th><th scope="col">Outreach angle</th><th scope="col"><span className="sr-only">Research</span></th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 28 }}>No leads match these filters.</td></tr>}
              {visible.slice(0, limit).map(l => {
                const r = l.research;
                const [ghlText, ghlTone] = GHL_BADGE[r?.ghlStatus ?? 'insufficient'];
                const st = status[l.id];
                const dec = emailDecision(l, gate), sup = leadSuppression(l, gate);
                const isOpen = open.has(l.id);
                return (
                  <Fragment key={l.id}>
                    <tr className="row" data-selected={sel.has(l.id)}>
                      <td><input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.has(l.id)} disabled={!!sup} title={sup ? 'On your do-not-contact list' : undefined} onChange={() => flip(setSel, l.id)} /></td>
                      <td>
                        {r ? (
                          <div className="stack">
                            <span className="score"><span className="score-letter" data-p={r.score.priority} title={`Priority ${r.score.priority}`}>{r.score.priority}</span><span className="score-total num">{r.score.total}</span></span>
                            <span className="sub nowrap">{r.score.confidence} confidence</span>
                          </div>
                        ) : scoring ? <span className="sub nowrap"><Icon name="loader" size={13} className="spin" /> Checking…</span> : <span className="muted">–</span>}
                      </td>
                      <td>
                        <div className="name">{l.name}</div>
                        {l.address && <div className="sub">{l.address}</div>}
                        <div className="chips">
                          <span className="badge" data-tone={ghlTone}>{ghlText}</span>
                          {r?.ghlVia && <span className="badge" data-tone="violet" title={`${r.ghlVia.reason}.${(agencyCount[r.ghlVia.domain] ?? 1) > 1 ? ` The same domain serves ${agencyCount[r.ghlVia.domain]} leads in your library.` : ''}`}>GHL via {r.ghlVia.domain}{(agencyCount[r.ghlVia.domain] ?? 1) > 1 ? ` · ${agencyCount[r.ghlVia.domain]} leads` : ''}</span>}
                          {r?.sourceUrls.some(u => u.includes('npiregistry.cms.hhs.gov')) && <span className="badge" data-tone="accent" title="Found in the US NPI registry, an official government list of healthcare providers">US registry</span>}
                          {r?.abn && <span className="badge" data-tone={r.abn.status === 'Active' ? 'good' : 'bad'} title={`${r.abn.entityName} · ${r.abn.entityType}${r.abn.gst ? ' · GST registered' : ''}. From the Australian Business Register.`}>{r.abn.status === 'Active' ? 'ABN active' : `ABN ${r.abn.status.toLowerCase()}`}</span>}
                          {r?.sourceUrls.some(u => u.includes('overturemaps.org')) && <span className="badge" data-tone="accent" title="Listed in Overture Maps, a free open places dataset. Listings can be out of date, so check the website.">Overture</span>}
                          {st ? <span className="badge" data-tone={st.ok ? (st.warn ? 'warn' : 'good') : 'bad'} title={st.text}>{st.ok ? (st.warn ? '✓ Pushed, note failed' : '✓ Pushed') : '✗ Push failed'}</span>
                            : l.pushedAt ? <span className="badge" data-tone="good">✓ Pushed earlier</span> : null}
                        </div>
                        {st && !st.ok && <div className="sub" style={{ color: 'var(--bad)', marginTop: 4 }}>{st.text}</div>}
                        {st?.ok && st.warn && <div className="sub" style={{ marginTop: 4 }}>{st.text}</div>}
                        {finding.has(l.id) || lookingUp?.has(l.id)
                          ? <div className="sub people-line"><Icon name="loader" size={13} className="spin" /> Looking for people…</div>
                          : r?.people?.length
                            ? <div className="people-line" title="Published on the business's own website">
                                <Icon name="users" size={13} />
                                <span><b>{r.people[0].name}</b>{r.people[0].title ? <span className="muted"> · {r.people[0].title}</span> : null}{r.people.length > 1 ? <span className="muted"> +{r.people.length - 1}</span> : null}</span>
                              </div>
                            : r?.peopleCheckedAt ? <div className="sub people-line">No names published</div> : null}
                      </td>
                      <td>
                        <div className="stack">
                          {l.email ? (
                            <span className="email-line">
                              <a href={`mailto:${l.email}`}>{l.email}</a>
                              {isSendable(r?.emailCheck) ? <span className="badge" data-tone="good" title="Domain accepts mail and the address belongs to this business. Only verified or approved emails are sent to GHL. (The mailbox itself is not tested.)"><Icon name="check" size={13} />Verified</span>
                                : canSend(r?.emailCheck, r?.emailApproval, l.email) ? <>
                                    <span className="badge" data-tone="good" title={`You approved this address${r?.emailApproval ? ` on ${r.emailApproval.at.slice(0, 10)}` : ''}. Held because: ${r?.emailCheck?.reasons.join('; ')}`}><Icon name="check" size={13} />Approved by you</span>
                                    <button type="button" className="link-btn" disabled={approving === l.id} onClick={() => approveEmail(l, false)} title="Stop sending this address to GHL">Undo</button>
                                  </>
                                : r?.emailCheck?.status === 'bad' ? <span className="badge" data-tone="bad" title={`${r.emailCheck.reasons.join('; ')}. Not sent to GHL.`}>Can’t receive mail</span>
                                : <>
                                    <span className="badge" data-tone="warn" title={r?.emailCheck ? (r.emailCheck.v ? `${r.emailCheck.reasons.join('; ')}. Not sent to GHL.` : 'Checked under older rules. Use Check emails. Not sent to GHL until verified.') : 'Not checked yet. Not sent to GHL until verified.'}>Not verified · won’t be sent</span>
                                    {r?.emailCheck?.status === 'risky' && r.emailCheck.approvable && (r.emailCheck.v ?? 0) >= EMAIL_CHECK_VERSION && (
                                      <button type="button" className="link-btn" disabled={approving === l.id} onClick={() => approveEmail(l, true)} title={`You decide this address is theirs. Held because: ${r.emailCheck.reasons.join('; ')}`}>{approving === l.id ? 'Approving…' : 'Approve'}</button>
                                    )}
                                  </>}
                              {isSendable(r?.emailCheck) && r!.emailCheck!.kind === 'role' && <span className="badge" title={r!.emailCheck!.reasons.join('; ')}>Shared inbox</span>}
                            </span>
                          ) : <span className="muted">No email found</span>}
                          {sup && <span className="badge" data-tone="bad" title={dec.reason}>Do not contact</span>}
                          {!sup && dec.by === 'policy' && <span className="badge" data-tone="warn" title={`${dec.reason}. The contact can still be sent to GHL; its email will not be.`}>Email held · {dec.country ?? 'country?'}</span>}
                          {l.phone && <span>{l.phone}</span>}
                          {!sup && <button type="button" className="link-btn" onClick={() => addDnc(l)} title="Never contact this business again (and flag it if found again)">Do not contact</button>}
                          <button type="button" className="link-btn" disabled={cleaning} onClick={() => forgetLead(l)} title="A removal request: do-not-contact AND delete it everywhere in your library">Forget</button>
                          {l.website ? <a href={href(l.website)} target="_blank" rel="noreferrer">{pretty(l.website)}</a>
                            : <span className="muted">{r?.sourceUrls.some(u => u.includes('npiregistry.cms.hhs.gov')) && !l.signals.length ? 'No website on record' : 'No website'}</span>}
                          {(l.instagram || r?.facebook) && (
                            <span className="sub">
                              {l.instagram && <a href={`https://instagram.com/${l.instagram}`} target="_blank" rel="noreferrer">Instagram</a>}
                              {l.instagram && r?.facebook && ' · '}
                              {r?.facebook && <a href={r.facebook} target="_blank" rel="noreferrer">Facebook</a>}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="angle">
                        <textarea className="textarea" rows={7} aria-label={`Outreach angle for ${l.name}`} value={l.opener ?? ''} placeholder={scoring ? 'Writing…' : 'No angle yet'} disabled={scoring}
                          onChange={e => setLeads(p => p.map(x => (x.id === l.id ? { ...x, opener: e.target.value } : x)))} />
                        {r?.counterPitch ? <div className="sub" style={{ marginTop: 4 }}><CounterPitchBadge lead={l} /> <span title="No service is pitched in the first email">First touch: no pitch</span></div>
                          : r?.outreach && <div className="sub" style={{ marginTop: 4 }}>Pitch: <b style={{ color: 'var(--text-2)' }}>{r.outreach.service}</b></div>}
                        {(() => {
                          const ch = reachChannels(l, r, toE164, isMobileNumber);
                          if (!ch.length) return null;
                          const dm = r?.outreach ? dmDraft(l.name, r.outreach.openingQuestion, ch) : undefined;
                          return (
                            <div className="sub reach">
                              Reach via: {ch.map((c, i) => <Fragment key={c.kind}>{i > 0 && ' · '}<a href={c.url} {...(/^https?:/.test(c.url) ? { target: '_blank', rel: 'noreferrer' } : {})}>{c.label}</a></Fragment>)}
                              {dm && <> · <button type="button" className="link-btn" title={dm.text} onClick={() => copyMessage(l.id, dm.text)}>{copied === l.id ? 'Copied' : `Copy ${dm.platform} message`}</button></>}
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        <button type="button" className="icon-btn" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} research for ${l.name}`} title={isOpen ? 'Hide research' : 'Show research'} onClick={() => flip(setOpen, l.id)}>
                          <span style={{ display: 'grid', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .4s var(--glide)' }}><Icon name="chevron" /></span>
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="detail"><td colSpan={6}>
                        <div className="reveal"><div><div className="detail-grid">
                          {r && <CounterPitchPanel lead={l} setLeads={setLeads} setGate={setGate} busy={scoring} onError={setError} />}
                          <div className="detail-card inset">
                            <h4>Why this score</h4>
                            {r ? <ul>{Object.entries(r.score.factors).map(([k, v]) => <li key={k}>{FACTOR_LABEL[k]?.[0] ?? k}<span className="v num">{v}/{FACTOR_LABEL[k]?.[1]}</span></li>)}</ul> : <p className="muted">Not scored.</p>}
                          </div>
                          <div className="detail-card inset">
                            <h4>What we saw</h4>
                            <ul>
                              {(r?.processes ?? []).map(p => <li key={p}><span className="tick">✓</span>{PROCESS_LABEL[p as Process] ?? p}</li>)}
                              {gapLabels(l.signals).map(g => <li key={g}><span className="cross">✗</span>{g}</li>)}
                              {(r?.ghlEvidence ?? []).map(g => <li key={g}><span className="muted">GHL</span>{g}</li>)}
                              {l.email && (() => { const verified = isSendable(r?.emailCheck), approved = !verified && canSend(r?.emailCheck, r?.emailApproval, l.email); return <li><span className={verified || approved ? 'tick' : r?.emailCheck?.status === 'bad' ? 'cross' : 'muted'}>{verified || approved ? '✓' : r?.emailCheck?.status === 'bad' ? '✗' : '?'}</span>{verified ? 'Email verified: the domain accepts mail and the address belongs to this business (the mailbox itself is not tested)' : approved ? 'Email approved by you: it was held, and you decided it belongs to this business' : r?.emailCheck?.status === 'bad' ? 'Email cannot receive mail' : 'Email not verified, so it will not be sent to GHL'}{r?.emailCheck?.reasons.length ? ` (${r.emailCheck.reasons.join('; ')})` : ''}</li>; })()}
                              {r?.unchecked && <li className="muted"><span>?</span>Couldn’t check {r.unchecked.signals.map(s => UNCHECKED_LABEL[s] ?? s).join(', ')}. {r.unchecked.reason}</li>}
                              {!r?.processes.length && !l.signals.length && !r?.ghlEvidence.length && !r?.unchecked && <li className="muted">Nothing observed</li>}
                            </ul>
                          </div>
                          <div className="detail-card inset">
                            <h4>Possible opportunities</h4>
                            <ul>{opportunitiesFor(l.signals).map(o => <li key={o}>{o}</li>)}{!l.signals.length && <li className="muted">None identified from public data</li>}</ul>
                            {l.website && r && <p className="sub" style={{ marginTop: 6 }}>Based on what the home, /contact and booking pages show. Anything we could not judge is left out.</p>}
                            {r?.outreach && <><h4 style={{ marginTop: 12 }}>Ask on the call</h4><p>{r.outreach.discoveryQuestion}</p></>}
                            {(() => { const dm = r?.outreach ? dmDraft(l.name, r.outreach.openingQuestion, reachChannels(l, r, toE164, isMobileNumber)) : undefined; return dm ? <><h4 style={{ marginTop: 12 }}>First message on {dm.platform}</h4><p>{dm.text}</p></> : null; })()}
                          </div>
                          <div className="detail-card inset">
                            <h4>People on their website</h4>
                            {r?.people?.length ? (
                              <ul>{r.people.map(p => (
                                <li key={p.name} style={{ flexWrap: 'wrap' }}>
                                  <span><b>{p.name}</b>{p.title ? <span className="muted"> · {p.title}</span> : null}</span>
                                  <a className="v" href={p.source} target="_blank" rel="noreferrer" title={p.evidence}>{p.confidence === 'High' ? 'Source' : 'Source (check)'}</a>
                                </li>
                              ))}</ul>
                            ) : <p className="muted">{r?.peopleCheckedAt ? 'This business does not publish names on its site, or the page could not be read.' : l.website ? 'Not looked up yet. Use “Find people”.' : 'No website to read.'}</p>}
                            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Names exactly as the business publishes them. Emails are never guessed. Check before using.</p>
                          </div>
                          <div className="detail-card inset">
                            <h4>Sources</h4>
                            <ul>{(r?.sourceUrls ?? []).map(u => <li key={u}><a href={u} target="_blank" rel="noreferrer">{pretty(u)}</a></li>)}</ul>
                            {r && <p className="muted" style={{ marginTop: 8 }}>Checked {new Date(r.verifiedAt).toLocaleString()}</p>}
                          </div>
                        </div></div></div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {visible.length > limit && (
            <div className="more"><button type="button" className="btn" onClick={() => setLimit(n => n + PAGE)}>Show {Math.min(PAGE, visible.length - limit)} more <span className="muted num">({visible.length - limit} hidden)</span></button></div>
          )}
        </div>
      </section>

      {error && <div className="callout material" data-tone="bad" role="alert"><Icon name="alert" />{error}</div>}

      <section className="actionbar glass" aria-labelledby="send-h" data-ready={ready}>
        <span className="step-num" data-state={sel.size || ready ? undefined : 'todo'}>{reviewStep + 1}</span>
        <h2 id="send-h" className="count num" style={{ fontSize: 14 }} aria-live="polite">
          {sel.size ? `Send ${sel.size} selected to GHL` : ready ? `${waiting.length} qualified ${waiting.length === 1 ? 'lead is' : 'leads are'} ready to send` : 'Select leads to send to GHL'}
        </h2>
        {ready && !waitingPicked && <button type="button" className="btn" onClick={() => setSel(p => new Set([...p, ...waiting.map(l => l.id)]))}>Select {waiting.length === 1 ? 'it' : `all ${waiting.length}`}</button>}
        <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Tags</span>
          <input className="input" placeholder="comma separated" value={tags} onChange={e => setTags(e.target.value)} />
        </label>
        <details className="pop">
          <summary className="btn" style={{ padding: '8px 12px' }}><Icon name="download" size={16} />Export</summary>
          <div className="menu glass">
            <span className="sub muted" style={{ padding: '2px 8px', fontSize: 12 }}>{sel.size ? `${sel.size} selected` : `All ${visible.length} shown`}</span>
            <button type="button" className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} onClick={() => exportAs('csv')}>CSV (spreadsheet)</button>
            <button type="button" className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} onClick={() => exportAs('json')}>JSON (with limits)</button>
          </div>
        </details>
        <button type="button" className="btn btn-primary push" data-state={pushing ? 'flying' : sent ? 'sent' : ready ? 'ready' : undefined}
          disabled={!sel.size || pushing || scoring} onClick={runPush} title={scoring ? 'Unlocks when outreach angles finish' : undefined}>
          <span className="plane" key={flight}><Icon name={sent && !pushing ? 'check' : 'send'} size={16} /></span>
          {pushing ? 'Sending…' : sent ? `${sent} sent` : 'Push to GHL'}
        </button>
      </section>
    </>
  );
}

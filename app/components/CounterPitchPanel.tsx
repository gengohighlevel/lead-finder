'use client';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Lead } from '@/lib/db';
import type { GateState } from '@/lib/emailGate';
import { CONFIDENCE_LABEL } from '@/lib/counterPitch';
import { validateEmail } from '@/lib/emailValidate';
import { post } from './api';

const STATUS: Record<string, [string, string]> = { ready: ['Ready', 'good'], review: ['Needs review', 'warn'], needs_research: ['Needs further research', 'bad'] };

/** Small status badge for the angle cell. */
export function CounterPitchBadge({ lead }: { lead: Lead }) {
  const cp = lead.research?.counterPitch;
  if (!cp) return null;
  const [text, tone] = STATUS[cp.status];
  return <span className="badge" data-tone={tone} title={cp.status === 'needs_research' ? cp.missing.join(' ') : 'Counter Pitch email: ten-point check'}>{text}</span>;
}

/**
 * The Counter Pitch email for one lead: the research it is built from, the ten-point check (run live on whatever is in the text box,
 * so hand edits are checked too), editable wording that rebuilds the email on the same evidence, and reply handling.
 * Nothing here sends an email.
 */
export function CounterPitchPanel({ lead, setLeads, setGate, busy, onError }: {
  lead: Lead; setLeads: Dispatch<SetStateAction<Lead[]>>; setGate: Dispatch<SetStateAction<GateState>>; busy?: boolean; onError: (m: string | null) => void;
}) {
  const cp = lead.research?.counterPitch;
  const r = cp?.research;
  const [edit, setEdit] = useState<{ subject: string; observation: string; impact: string; question: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [reply, setReply] = useState('');
  const [followUp, setFollowUp] = useState<{ kind: string; action: string; draft: string | null; suppress: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  // the check runs on the text box itself, so an edit made by hand shows its result straight away
  const live = useMemo(() => (lead.opener?.startsWith('Subject:') && r ? validateEmail(lead.opener, { confidence: r.confidence, businessName: lead.name }) : undefined), [lead.opener, r, lead.name]);

  async function rebuild(withEdits: boolean) {
    setWorking(true); onError(null);
    try {
      const j = (await post('/api/counter-pitch', { id: lead.id, type: r?.industry, ...(withEdits && edit ? { edits: edit } : {}) })) as { lead: Lead };
      setLeads(p => p.map(x => (x.id === j.lead.id ? j.lead : x)));
      setEdit(null);
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not rebuild the email'); }
    finally { setWorking(false); }
  }
  async function reactTo(body: { reply?: string; noResponse?: boolean }) {
    setWorking(true); onError(null); setFollowUp(null);
    try {
      const j = (await post('/api/follow-up', { id: lead.id, ...body })) as { result: NonNullable<typeof followUp>; suppressions?: GateState['suppressions'] };
      setFollowUp(j.result);
      if (j.suppressions) setGate(g => ({ ...g, suppressions: j.suppressions! }));
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not read the reply'); }
    finally { setWorking(false); }
  }
  async function copy(t: string) { try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { onError('Could not copy. Select the text and copy by hand.'); } }

  if (!cp) return <div className="detail-card inset"><h4>Counter Pitch email</h4><p className="muted">Not written yet. Use “Re-check” or score this lead to write it. Nothing is sent.</p></div>;
  const [stText, stTone] = STATUS[cp.status];
  const startEdit = () => setEdit({ subject: cp.subject ?? '', observation: r?.observation ?? '', impact: r?.impact ?? '', question: r?.question ?? '' });

  return (
    <div className="detail-card inset" style={{ gridColumn: '1 / -1' }}>
      <h4>Counter Pitch email <span className="badge" data-tone={stTone} style={{ marginLeft: 6 }}>{stText}</span></h4>

      {cp.status === 'needs_research' ? (
        <>
          <p>No email was written: there is not enough checked research. Missing:</p>
          <ul>{cp.missing.map(m => <li key={m}><span className="cross">✗</span>{m}</li>)}</ul>
        </>
      ) : r && (
        <>
          <div className="detail-grid" style={{ marginTop: 6 }}>
            <div>
              <ul>
                <li><span className="muted">Pain subject</span><span className="v">{cp.subject}</span></li>
                <li><span className="muted">Friction observation</span><span className="v" style={{ whiteSpace: 'normal', textAlign: 'right' }}>{r.observation}</span></li>
                <li><span className="muted">Evidence</span><span className="v" style={{ whiteSpace: 'normal', textAlign: 'right' }}>{r.evidence}{r.source ? ` · ${r.source}` : ''}</span></li>
                <li><span className="muted">Potential impact</span><span className="v" style={{ whiteSpace: 'normal', textAlign: 'right' }}>{r.impact}</span></li>
                <li><span className="muted">Counter pitch question</span><span className="v" style={{ whiteSpace: 'normal', textAlign: 'right' }}>{r.question}</span></li>
                <li><span className="muted">Opt-out</span><span className="v">Reply “No” (P.S.)</span></li>
                <li><span className="muted">Evidence confidence</span><span className="v" title={CONFIDENCE_LABEL[r.confidence]}>{r.confidence}</span></li>
                <li><span className="muted">Word count</span><span className="v num">{live ? live.words : cp.words} / 50</span></li>
              </ul>
              <p className="sub" style={{ marginTop: 6 }}>{CONFIDENCE_LABEL[r.confidence]}. The impact is a possibility, not a fact. No service is pitched in this email.</p>
            </div>
            <div>
              <h4>Validation {live && <span className="badge" data-tone={live.ok ? 'good' : 'warn'} style={{ marginLeft: 6 }}>{live.ok ? 'All 10 passed' : `${live.checks.filter(c => !c.ok).length} to fix`}</span>}</h4>
              {live ? <ul>{live.checks.map(c => <li key={c.id}><span className={c.ok ? 'tick' : 'cross'}>{c.ok ? '✓' : '✗'}</span>{c.label}{!c.ok && c.detail ? <span className="muted"> · {c.detail}</span> : null}</li>)}</ul>
                : <p className="muted">The text box no longer holds the generated email, so it cannot be checked. Use “Regenerate from research”.</p>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" className="btn" disabled={working || busy} onClick={() => rebuild(false)} title="Write the email again from the saved research. Replaces what is in the text box.">Regenerate from research</button>
            {!edit && <button type="button" className="btn" disabled={working || busy} onClick={startEdit} title="Reword the subject, observation, impact or question. The evidence and source stay.">Edit wording</button>}
          </div>
          {edit && (
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {(['subject', 'observation', 'impact', 'question'] as const).map(k => (
                <label key={k} className="sub" style={{ display: 'grid', gap: 3 }}>
                  {k === 'subject' ? 'Pain subject' : k === 'observation' ? 'Friction observation' : k === 'impact' ? 'Potential impact (can be empty)' : 'Counter pitch question'}
                  <input className="input" value={edit[k]} maxLength={300} onChange={e => setEdit({ ...edit, [k]: e.target.value })} />
                </label>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary" disabled={working} onClick={() => rebuild(true)}>Rebuild and check</button>
                <button type="button" className="btn" disabled={working} onClick={() => setEdit(null)}>Cancel</button>
              </div>
              <p className="sub">The email is rebuilt on the same research and checked again. If a check fails you will see which one; nothing is hidden.</p>
            </div>
          )}
        </>
      )}

      {cp.status !== 'needs_research' && (
        <>
          <h4 style={{ marginTop: 14 }}>When they reply</h4>
          <textarea className="textarea" rows={2} placeholder="Paste their reply here" value={reply} maxLength={5000} onChange={e => setReply(e.target.value)} aria-label={`Reply from ${lead.name}`} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <button type="button" className="btn" disabled={working || !reply.trim()} onClick={() => reactTo({ reply })}>Read reply</button>
            <button type="button" className="btn" disabled={working} onClick={() => { if (window.confirm(`Mark ${lead.name} as replied “No”?\n\nIt goes on your do-not-contact list: its email, website domain and phone will not be contacted by any campaign.`)) reactTo({ reply: 'No' }); }}>Replied “No”</button>
            <button type="button" className="btn" disabled={working} onClick={() => reactTo({ noResponse: true })}>No reply: suggest a follow-up</button>
          </div>
          {followUp && (
            <div style={{ marginTop: 8 }}>
              <p><b>{followUp.kind.replace(/_/g, ' ')}</b>. {followUp.action}</p>
              {followUp.draft && (
                <>
                  <pre className="sub" style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{followUp.draft}</pre>
                  <button type="button" className="link-btn" onClick={() => copy(followUp.draft!)}>{copied ? 'Copied' : 'Copy draft'}</button> <span className="sub">Nothing is sent from here.</span>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

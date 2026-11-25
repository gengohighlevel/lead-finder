'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Policy, Rule } from '@/lib/outreachPolicy';
import { EU } from '@/lib/outreachPolicy';
import type { Suppression } from '@/lib/dnc';
import { post, get } from './api';

const RULE_LABEL: Record<Rule, string> = { allow: 'Email allowed', 'published-only': 'Only addresses the business publishes on its own website', block: 'No email' };
const RULE_TONE: Record<Rule, string> = { allow: 'good', 'published-only': 'warn', block: 'bad' };
const EXAMPLE = `{
  "US": "allow",
  "CA": "block",
  "AU": "published-only",
  "EU": "block",
  "GB": "block",
  "default": "block"
}`;

/** Settings: where you may email (your country rules) and the do-not-contact list. */
export function OutreachRules() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [list, setList] = useState<Suppression[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const j = await get('/api/gate');
      setPolicy(j.policy); setList(j.suppressions ?? []); setProblem(j.problem ?? null);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not load'); }
  }
  useEffect(() => { void load(); }, []);

  async function add() {
    if (!text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = (await post('/api/dnc', { text, ...(reason.trim() ? { reason: reason.trim() } : {}) })) as { added: number; existing: number; unreadable: string[]; suppressions: Suppression[] };
      setList(r.suppressions);
      setMsg(`Added ${r.added}${r.existing ? `, ${r.existing} already on the list` : ''}.${r.unreadable.length ? ` Could not read: ${r.unreadable.slice(0, 5).join(', ')}${r.unreadable.length > 5 ? '…' : ''}` : ''}`);
      if (!r.unreadable.length) setText('');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not add'); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    if (!window.confirm('Take this off the do-not-contact list? Only do this if you are sure it is safe to contact them again.')) return;
    try { setList(((await post('/api/dnc', { remove: id })) as { suppressions: Suppression[] }).suppressions); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Could not remove'); }
  }

  // group the rules: the EU as one line when its members agree
  const rows = useMemo(() => {
    if (!policy) return [] as { label: string; rule: Rule }[];
    const out: { label: string; rule: Rule }[] = [];
    const euRules = new Set(EU.map(c => policy.rules[c] ?? policy.fallback));
    if (euRules.size === 1) out.push({ label: 'EU members (27)', rule: [...euRules][0] });
    for (const [c, rule] of Object.entries(policy.rules).sort()) if (euRules.size !== 1 || !EU.includes(c)) out.push({ label: c, rule });
    out.push({ label: 'Everywhere else, and when the country is unknown', rule: policy.fallback });
    return out;
  }, [policy]);

  return (
    <section className="panel material" aria-labelledby="out-h">
      <div className="panel-head">
        <h2 id="out-h">Who you may email</h2><span className="hint">country rules · applied to the email only; the contact still goes to GHL</span>
      </div>
      {problem && <div className="callout material" data-tone="warn"><span>{problem}</span></div>}
      <ul className="rules">
        {rows.map(r => <li key={r.label} className="status-row"><b>{r.label}</b> <span className="badge" data-tone={RULE_TONE[r.rule]}>{RULE_LABEL[r.rule]}</span></li>)}
      </ul>
      <details className="fold material">
        <summary>How to change these rules</summary>
        <div className="fold-body">
          <p><b>These defaults are cautious starting points, not legal advice.</b> Laws differ by country and change, and some (Canada’s CASL, the EU’s GDPR and e-privacy rules, Germany’s competition law) are stricter than a simple rule can express. Ask a lawyer about the markets you email, then set the rules.</p>
          <p>Create a file called <code>outreach-policy.json</code> in the project folder. Reload this page to see it. Each line is a country code (or <code>EU</code> for all 27 members) and one of <code>allow</code>, <code>published-only</code>, <code>block</code>. <code>default</code> covers everything else. A mistake in the file leaves the safe default in place.</p>
          <pre>{EXAMPLE}</pre>
          <p>Phone numbers are not covered here: texting and calling have their own rules (for example the US TCPA).</p>
        </div>
      </details>

      <div className="panel-head" style={{ marginTop: 18 }}>
        <h2 id="dnc-h">Do not contact</h2><span className="hint">{list.length} on the list · never pushed to GHL, and flagged if found again</span>
      </div>
      <p className="sub">Paste emails, business websites or phone numbers: one per line, or separated by commas. Good for addresses that unsubscribed or bounced in GHL. A website covers every address on that business’s domain. A free-mail provider (gmail.com) can’t be added as a whole.</p>
      <textarea className="textarea" aria-label="Emails, websites or phone numbers to add" rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={'unsubscribed@example.com\nexample-business.com\n+61 412 345 678'} />
      <div className="toolbar">
        <input className="input" aria-label="Why (optional)" placeholder="Why (optional), e.g. unsubscribed in GHL" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} style={{ width: 320 }} />
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={add}>{busy ? 'Adding…' : 'Add to the list'}</button>
        {msg && <span className="sub" role="status">{msg}</span>}
      </div>
      {list.length > 0 && (
        <ul className="rules">
          {list.map(s => (
            <li key={s.id} className="status-row">
              <span className="badge">{s.kind === 'email' ? 'Email' : s.kind === 'domain' ? 'Website' : 'Phone'}</span> <b>{s.value}</b>
              {s.reason && <span className="sub"> · {s.reason}</span>} <span className="sub muted"> · {s.createdAt.slice(0, 10)}</span>
              <button type="button" className="link-btn" onClick={() => remove(s.id)} style={{ marginLeft: 8 }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

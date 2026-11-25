import type { Lead } from './db';
import { PROCESS_LABEL, type Process } from './evidence';
import { GAP_LABEL, opportunitiesFor } from './research';
import { toE164, isMobileNumber } from './phone';
import { reachChannels, dmDraft } from './channel';
import { formatAbn } from './abn';
import { isSendable } from './emailCheck';
import { emailDecision, leadSuppression, DEFAULT_GATE, type GateState, type EmailDecision } from './emailGate';

const BASE = 'https://services.leadconnectorhq.com';

const GHL_STATUS_LABEL = { likely: 'Likely GHL user (technical indicators only, not confirmed)', potential: 'Potential GHL customer (no GHL code found)', insufficient: 'Insufficient information' };

export function leadTags(l: Lead, tags: string[], dec: EmailDecision = emailDecision(l)): string[] {
  const extra: string[] = [];
  if (l.research) extra.push(`priority-${l.research.score.priority.toLowerCase()}`);
  if (l.research?.ghlStatus === 'likely') extra.push('ghl-likely');
  // only an email that is actually given to GHL is tagged: verified by the check, or approved by you
  if (dec.send) extra.push(isSendable(l.research?.emailCheck) ? 'email-verified' : 'email-approved');
  return [...new Set(['lead-finder', ...tags, ...extra])];
}

export function buildNote(l: Lead, dec: EmailDecision = emailDecision(l)): string {
  const r = l.research, o = r?.outreach;
  const lines: string[] = [];
  if (o) lines.push(`Outreach angle: ${o.observation} ${o.openingQuestion}`, `Recommended service: ${o.service}`, `Discovery question: ${o.discoveryQuestion}`);
  else if (l.opener) lines.push(`Opener idea: ${l.opener}`);
  const cp = r?.counterPitch;
  if (cp?.status === 'needs_research') lines.push(`Counter Pitch email: needs further research, no email written. Missing: ${cp.missing.join(' ')}`);
  else if (cp) lines.push(`Counter Pitch email: ${cp.status === 'ready' ? 'passed the ten-point check' : 'FLAGGED, needs a manual review before use'}. Evidence confidence: ${cp.research.confidence}. No service is pitched in the first email.`);
  if (l.opener?.startsWith('Subject:')) lines.push(`Email draft:\n${l.opener}`);
  else if (l.opener && o && !l.opener.includes(o.openingQuestion)) lines.push(`Edited opener: ${l.opener}`);
  const channels = reachChannels(l, r, toE164, isMobileNumber);
  if (channels.length) lines.push(`Ways to reach: ${channels.map(c => `${c.label} ${c.url}`).join(' | ')}`);
  const dm = o ? dmDraft(l.name, o.openingQuestion, channels) : undefined;
  if (dm) lines.push(`DM draft (${dm.platform}): ${dm.text}`);
  if (r) {
    lines.push('', `Score: ${r.score.total}/100 (Priority ${r.score.priority}, ${r.score.confidence} confidence)`, `GHL status: ${GHL_STATUS_LABEL[r.ghlStatus]}`);
    if (r.ghlEvidence.length) lines.push(`GHL evidence: ${r.ghlEvidence.join('; ')}`);
    if (r.ghlVia) lines.push(`GHL via a third party: ${r.ghlVia.reason}.`);
    const c = r.emailCheck, why = c?.reasons.length ? ` (${c.reasons.join('; ')})` : '';
    if (l.email && dec.send) {
      if (!isSendable(c)) lines.push(`Email approved by you on ${r.emailApproval!.at.slice(0, 10)}: ${l.email} (${c!.reasons.join('; ')}).`);
      else if (c && c.kind !== 'personal') lines.push(`Email verified: ${l.email}${why}.`);
    } else if (l.email && dec.by === 'policy') lines.push(`Email not added: ${l.email}: held by your country policy (${dec.reason}).`);
    else if (l.email) lines.push(!c ? `Email not added: ${l.email} was not checked.`
      : c.status === 'bad' ? `Email not added: ${l.email} cannot receive mail${why}.`
      : c.status === 'ok' ? `Email not added: ${l.email} was checked under older rules; check it again.`
      : `Email not added: ${l.email} is not verified${why}.`);
    if (r.abn) lines.push(`ABN: ${formatAbn(r.abn.abn)}, ${r.abn.status}${r.abn.entityType ? `, ${r.abn.entityType}` : ''}${r.abn.gst ? ', GST registered' : ''}${r.abn.status !== 'Active' ? '. The business may have closed.' : ''}`);
    if (r.processes.length) lines.push(`Observed: ${r.processes.map(p => PROCESS_LABEL[p as Process] ?? p).join('; ')}`);
  }
  if (r?.people?.length) lines.push(`People on their website: ${r.people.map(p => `${p.name}${p.title ? ` (${p.title})` : ''}`).join('; ')} (from ${[...new Set(r.people.map(p => p.source))].join(' ')}; names as published, check before using)`);
  if (l.signals.length) lines.push(`Gaps: ${l.signals.map(s => GAP_LABEL[s] ?? s).join('; ')}`);
  const opp = opportunitiesFor(l.signals);
  if (opp.length) lines.push(`Potential opportunities: ${opp.join('; ')}`);
  if (r?.sourceUrls.length) lines.push(`Sources: ${r.sourceUrls.join(' ')}`, `Verified: ${r.verifiedAt}`);
  return lines.join('\n');
}

/** `warning` = the contact was saved but something minor failed (its note), so the lead is not retried blindly. */
export type PushResult = { id: number; ok: boolean; error?: string; warning?: string };

export async function pushToGhl(
  leads: Lead[], tags: string[], gate: GateState = DEFAULT_GATE,
): Promise<PushResult[]> {
  const token = process.env.GHL_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error('GHL_TOKEN and GHL_LOCATION_ID required');
  const headers = { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' };

  const results: PushResult[] = [];
  for (const l of leads) {
    // a business on your do-not-contact list is never sent: no request at all
    const sup = leadSuppression(l, gate);
    if (sup) { results.push({ id: l.id, ok: false, error: `On your do-not-contact list (${sup.via}: ${sup.suppression.value}${sup.suppression.reason ? `, ${sup.suppression.reason}` : ''}). Not sent.` }); continue; }
    const dec = emailDecision(l, gate);
    try {
      // only a verified email is given to GHL: GHL could email any address it is given
      const res = await fetch(`${BASE}/contacts/upsert`, {
        method: 'POST', headers,
        body: JSON.stringify({
          locationId, name: l.name, email: dec.send ? l.email : undefined, phone: toE164(l.phone, l.research?.country) ?? l.phone, website: l.website, companyName: l.name, tags: leadTags(l, tags, dec), source: 'lead-finder',
        }),
      });
      if (!res.ok) throw new Error(`GHL ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { contact?: { id?: string } };
      const cid = data.contact?.id;
      const note = buildNote(l, dec);
      let warning: string | undefined;
      if (cid && note) {
        // a note failure must not fail the contact push, but it must not be hidden either
        try {
          const nr = await fetch(`${BASE}/contacts/${cid}/notes`, { method: 'POST', headers, body: JSON.stringify({ body: note }) });
          if (!nr.ok) warning = `Contact saved, but its research note did not save (GHL ${nr.status}).`;
        } catch { warning = 'Contact saved, but its research note did not save (network error).'; }
      }
      results.push({ id: l.id, ok: true, ...(warning ? { warning } : {}) });
    } catch (e) {
      results.push({ id: l.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

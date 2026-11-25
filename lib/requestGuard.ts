/**
 * Who may talk to this app. It listens on the local address only, but a website open in YOUR browser can still send
 * requests to it, so two things are checked on every request:
 *  1. the Host must be this computer's own local name (otherwise a hostile site could point its own name at 127.0.0.1 and
 *     read your leads: "DNS rebinding");
 *  2. anything that CHANGES something must come from this app's own page: not another site, not another local app, and must
 *     send JSON (a plain-text POST is the one kind a browser sends to any site without asking).
 * Scripts such as curl and scripts/app send no Origin and are fine as long as they send JSON.
 */
export type Verdict = { ok: true } | { ok: false; status: 403 | 415; reason: string };
export type GuardInput = { method: string; host: string | null; origin: string | null; secFetchSite: string | null; contentType: string | null };

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostname = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, '');

/** `hosts`: extra names the app may be served under when it is hosted (APP_HOSTS). Empty for the local app. */
export type GuardConfig = { hosts?: string[] };

export function checkRequest(r: GuardInput, cfg: GuardConfig = {}): Verdict {
  const host = (r.host ?? '').trim().toLowerCase();
  const allowed = (cfg.hosts ?? []).map(h => h.trim().toLowerCase()).filter(Boolean);
  if (!host || !(LOCAL.has(hostname(host)) || allowed.includes(hostname(host)))) return { ok: false, status: 403, reason: 'This app only answers to its own local address.' };
  const method = r.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return { ok: true };
  if (method === 'OPTIONS') return { ok: false, status: 403, reason: 'Cross-site use is not allowed.' };

  const site = (r.secFetchSite ?? '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return { ok: false, status: 403, reason: 'Requests from other sites are not allowed.' };
  if (r.origin !== null && r.origin !== undefined) {
    let originHost = '';
    try { originHost = new URL(r.origin).host.toLowerCase(); } catch { /* "null" or junk */ }
    if (!originHost || originHost !== host) return { ok: false, status: 403, reason: 'Requests from other sites are not allowed.' };
  }
  if (!/^application\/json\b/i.test((r.contentType ?? '').trim())) return { ok: false, status: 415, reason: 'Send JSON (Content-Type: application/json).' };
  return { ok: true };
}

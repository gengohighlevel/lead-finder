import { checkRequest } from './requestGuard';
import { hostedConfig, verifyAccessToken, type AccessResult } from './cfAccess';
import { verifySession } from './auth';

/**
 * The single front door. Local app: only this computer's own page may use it. Hosted (APP_HOSTS set): the same rules for the
 * configured public host, PLUS a login on every request: Cloudflare Access (AUTH_MODE=access) or the app's own password +
 * authenticator login (AUTH_MODE=password). Incomplete login settings serve nothing.
 */
export const SESSION_COOKIE = 'lf_session';

export type GateInput = {
  method: string; host: string | null; origin: string | null; secFetchSite: string | null; contentType: string | null; path: string;
  accessToken: string | null; cookie?: string | null;
};
export type GateResult =
  | { ok: true; email?: string }
  | { ok: false; status: 401 | 403 | 415 | 503; reason: string }
  | { ok: false; status: 302; reason: string; redirect: string };
type Verify = (token: string | null, cfg: { team: string; aud: string; emails?: string[] }) => Promise<AccessResult>;

export function getCookie(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}

/**
 * An absolute address for a redirect (Next.js refuses a relative one from the front door). The host has already passed the
 * allowed-host check; it is still validated here so a crafted Host header can never turn into an open redirect.
 */
export function loginUrl(host: string | null | undefined, forwardedProto: string | null | undefined, path: string): string {
  const h = (host ?? '').trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(h) && !/^\[::1\](:\d{1,5})?$/.test(h)) return `https://invalid.invalid${path}`;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);
  const p = (forwardedProto ?? '').split(',')[0].trim().toLowerCase();
  const proto = p === 'http' || p === 'https' ? p : local ? 'http' : 'https';
  return `${proto}://${h}${path}`;
}

/** Pages and endpoints reachable without a session in password mode: the login page and endpoint (and the health check, above). */
const OPEN_IN_PASSWORD_MODE = new Set(['/login', '/api/auth/login']);
/** Public art the login page itself shows (the default wallpaper and the logo). No private data; GET only. Your own wallpapers stay behind the login. */
const OPEN_ASSETS = new Set(['/background.jpg']);

export async function gateRequest(r: GateInput, env: Record<string, string | undefined>, verify: Verify = verifyAccessToken, now: number = Date.now()): Promise<GateResult> {
  const cfg = hostedConfig(env);
  const v = checkRequest(r, { hosts: cfg.hosted ? cfg.hosts : [] });
  if (!v.ok) return v;
  if (!cfg.hosted) return { ok: true };
  if (r.path === '/api/health') return { ok: true };                       // returns nothing private; lets the container's health check work

  if (cfg.mode === 'password') {
    if (!cfg.complete || !cfg.password) return { ok: false, status: 503, reason: 'Hosted mode is not fully configured (SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD_HASH, ADMIN_TOTP_SECRET), so nothing is served.' };
    if (OPEN_IN_PASSWORD_MODE.has(r.path)) return { ok: true };
    if (OPEN_ASSETS.has(r.path) && r.method.toUpperCase() === 'GET') return { ok: true };
    const s = verifySession(getCookie(r.cookie, SESSION_COOKIE), cfg.password.secret, now);
    if (s && s.email === cfg.password.email) return { ok: true, email: s.email };
    return r.path.startsWith('/api/')
      ? { ok: false, status: 401, reason: 'Login required.' }
      : { ok: false, status: 302, reason: 'Login required.', redirect: '/login' };
  }

  if (!cfg.complete || !cfg.team || !cfg.aud) return { ok: false, status: 503, reason: 'Hosted mode is not fully configured (CF_ACCESS_TEAM and CF_ACCESS_AUD), so nothing is served.' };
  const a = await verify(r.accessToken, { team: cfg.team, aud: cfg.aud, emails: cfg.emails });
  return a.ok ? { ok: true, email: a.email } : { ok: false, status: 401, reason: `Login required (${a.reason}).` };
}

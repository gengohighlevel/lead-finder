import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { base32Decode } from './auth';

/**
 * Hosted mode: APP_HOSTS names the public host(s). The app is then protected in one of two ways (AUTH_MODE):
 *  - "access" (default): Cloudflare Access sits in front and adds a signed token to every request; the app verifies it.
 *  - "password": the app's own login (password + authenticator code), for a domain whose DNS is not on Cloudflare.
 * Either way, incomplete settings serve nothing: the app fails closed.
 */
export type PasswordSettings = { email: string; secret: string; passwordHash: string; totpSecret: string; recoveryHashes: string[] };
export type HostedConfig =
  | { hosted: false }
  | { hosted: true; mode: 'access' | 'password'; hosts: string[]; team?: string; aud?: string; emails: string[]; password?: PasswordSettings; complete: boolean };

const list = (v?: string) => (v ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function validTotpSecret(s: string): boolean { try { return base32Decode(s).length >= 10; } catch { return false; } }

/** Read hosted-mode settings from the environment. complete = everything the chosen login needs is present and sane. */
export function hostedConfig(env: Record<string, string | undefined>): HostedConfig {
  const hosts = list(env.APP_HOSTS);
  if (!hosts.length) return { hosted: false };

  if ((env.AUTH_MODE ?? '').trim().toLowerCase() === 'password') {
    const secret = (env.SESSION_SECRET ?? '').trim(), email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    const passwordHash = (env.ADMIN_PASSWORD_HASH ?? '').trim(), totpSecret = (env.ADMIN_TOTP_SECRET ?? '').replace(/[\s-]/g, '').toUpperCase();
    const recoveryHashes = (env.RECOVERY_CODE_HASHES ?? '').split(',').map(s => s.trim().toLowerCase()).filter(h => /^[a-f0-9]{64}$/.test(h));
    const complete = secret.length >= 32 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && passwordHash.startsWith('scrypt:') && passwordHash.split(':').length === 6 && validTotpSecret(totpSecret);
    return { hosted: true, mode: 'password', hosts, emails: [], complete, password: { email, secret, passwordHash, totpSecret, recoveryHashes } };
  }

  const team = (env.CF_ACCESS_TEAM ?? '').trim(), aud = (env.CF_ACCESS_AUD ?? '').trim();
  const teamOk = /^[a-z0-9][a-z0-9-]{0,62}$/i.test(team);   // a bare team name, so the check can only go to cloudflareaccess.com
  const audOk = /^[a-f0-9]{16,}$/i.test(aud);
  return { hosted: true, mode: 'access', hosts, emails: list(env.ACCESS_EMAILS), ...(teamOk ? { team } : {}), ...(audOk ? { aud } : {}), complete: teamOk && audOk };
}

export type AccessResult = { ok: true; email: string } | { ok: false; reason: string };

const remote = new Map<string, JWTVerifyGetKey>();
const keysFor = (team: string): JWTVerifyGetKey => {
  let k = remote.get(team);
  if (!k) { k = createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`)) as JWTVerifyGetKey; remote.set(team, k); }
  return k;
};

export async function verifyAccessToken(token: string | null | undefined, cfg: { team: string; aud: string; emails?: string[] }, keys: JWTVerifyGetKey = keysFor(cfg.team)): Promise<AccessResult> {
  if (!token || token.split('.').length !== 3) return { ok: false, reason: 'no login token' };
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${cfg.team}.cloudflareaccess.com`, audience: cfg.aud, algorithms: ['RS256'] });
    const email = String((payload as { email?: unknown }).email ?? '').toLowerCase();
    if (!email) return { ok: false, reason: 'token has no email' };
    if (cfg.emails?.length && !cfg.emails.includes(email)) return { ok: false, reason: 'this email is not allowed' };
    return { ok: true, email };
  } catch { return { ok: false, reason: 'login token not valid' }; }
}

import { LoginLimiter } from './loginLimiter';

/** State shared by the login routes. Kept on globalThis so every copy of this module in the server sees the same limiter. */
type Shared = { limiter?: LoginLimiter; lastTotpStep?: number };
const g = globalThis as unknown as { __leadFinderAuth?: Shared };
const shared = (): Shared => (g.__leadFinderAuth ??= {});

export const loginLimiter = (): LoginLimiter => (shared().limiter ??= new LoginLimiter({ maxFails: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 }));
export const resetLoginLimiter = (): void => { const s = shared(); s.limiter = undefined; s.lastTotpStep = undefined; };
export const getLastTotpStep = (): number | undefined => shared().lastTotpStep;
export const setLastTotpStep = (step: number): void => { shared().lastTotpStep = step; };

/**
 * The address the reverse proxy saw: the LAST value of X-Forwarded-For (Caddy appends the real client address, so earlier
 * values are whatever the client claimed and must not be trusted).
 */
export function clientAddress(headers: Headers): string {
  const parts = (headers.get('x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? 'direct';
}

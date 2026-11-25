/** Slows down password guessing: too many failures from one address lock that address out for a while. In memory, per process. */
export type LimiterOptions = { maxFails: number; windowMs: number; lockMs: number; maxKeys?: number };

export class LoginLimiter {
  private entries = new Map<string, { fails: number[]; lockedUntil: number }>();
  constructor(private o: LimiterOptions) {}

  check(key: string, now: number): { allowed: boolean; retryAfterSec: number } {
    const e = this.entries.get(key);
    if (e && e.lockedUntil > now) return { allowed: false, retryAfterSec: Math.ceil((e.lockedUntil - now) / 1000) };
    return { allowed: true, retryAfterSec: 0 };
  }
  fail(key: string, now: number): { locked: boolean } {
    const e = this.entries.get(key) ?? { fails: [], lockedUntil: 0 };
    e.fails = e.fails.filter(t => now - t < this.o.windowMs);
    e.fails.push(now);
    let locked = false;
    if (e.fails.length >= this.o.maxFails) { e.lockedUntil = now + this.o.lockMs; e.fails = []; locked = true; }
    this.entries.delete(key); this.entries.set(key, e);          // most recently used goes last
    const cap = this.o.maxKeys ?? 10_000;
    while (this.entries.size > cap) this.entries.delete(this.entries.keys().next().value as string);   // drop the oldest
    return { locked };
  }
  succeed(key: string): void { this.entries.delete(key); }
  size(): number { return this.entries.size; }
}

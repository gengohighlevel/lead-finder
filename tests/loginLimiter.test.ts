import { describe, it, expect } from 'vitest';
import { LoginLimiter } from '../lib/loginLimiter';

describe('LoginLimiter', () => {
  const MIN = 60_000;
  it('allows attempts until too many failures, then locks that address out for a while', () => {
    const l = new LoginLimiter({ maxFails: 5, windowMs: 15 * MIN, lockMs: 15 * MIN });
    for (let i = 0; i < 5; i++) { expect(l.check('1.1.1.1', i * 1000).allowed).toBe(true); l.fail('1.1.1.1', i * 1000); }
    const r = l.check('1.1.1.1', 6000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(14 * 60);
    expect(l.check('1.1.1.1', 15 * MIN + 10_000).allowed).toBe(true);          // the lock ends
  });
  it('keeps addresses separate', () => {
    const l = new LoginLimiter({ maxFails: 2, windowMs: MIN, lockMs: MIN });
    l.fail('a', 0); l.fail('a', 1);
    expect(l.check('a', 2).allowed).toBe(false);
    expect(l.check('b', 2).allowed).toBe(true);
  });
  it('failures older than the window are forgotten', () => {
    const l = new LoginLimiter({ maxFails: 3, windowMs: MIN, lockMs: MIN });
    l.fail('a', 0); l.fail('a', 1000);
    expect(l.fail('a', 2 * MIN).locked).toBe(false);                         // the first two have aged out
    expect(l.check('a', 2 * MIN + 1).allowed).toBe(true);
  });
  it('a success clears the count', () => {
    const l = new LoginLimiter({ maxFails: 3, windowMs: MIN, lockMs: MIN });
    l.fail('a', 0); l.fail('a', 1); l.succeed('a');
    l.fail('a', 2); l.fail('a', 3);
    expect(l.check('a', 4).allowed).toBe(true);
  });
  it('does not grow without bound', () => {
    const l = new LoginLimiter({ maxFails: 3, windowMs: MIN, lockMs: MIN, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) l.fail(`ip${i}`, i);
    expect(l.size()).toBeLessThanOrEqual(100);
  });
});

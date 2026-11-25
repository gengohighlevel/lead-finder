import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { hostedConfig } from '@/lib/cfAccess';
import { hashRecoveryCode, signSession, verifyPassword, verifyTotp } from '@/lib/auth';
import { clientAddress, getLastTotpStep, loginLimiter, setLastTotpStep } from '@/lib/authState';
import { useOnce } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/hostedGate';

export const dynamic = 'force-dynamic';

const SESSION_MS = 12 * 3600_000;
const WRONG = 'Wrong email, password or code.';
// compared against when the email is wrong, so a wrong email takes as long as a wrong password
const DUMMY_HASH = 'scrypt:32768:8:1:ZHVtbXlzYWx0ZHVtbXlzYWx0:ZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXM';

/**
 * Sign in with email + password + an authenticator code (or a one-time recovery code instead of the code).
 * Every failure gets the same answer, so nobody can tell which part was wrong. Repeated failures lock the address out.
 */
export const POST = safeRoute(async (req: Request) => {
  const cfg = hostedConfig(process.env);
  if (!cfg.hosted || cfg.mode !== 'password' || !cfg.password || !cfg.complete) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const acct = cfg.password;
  const now = Date.now(), ip = clientAddress(req.headers), limiter = loginLimiter();

  const gate = limiter.check(ip, now);
  if (!gate.allowed) return NextResponse.json({ error: `Too many attempts. Try again in ${Math.ceil(gate.retryAfterSec / 60)} minutes.` }, { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } });

  const raw = await req.json().catch(() => null);
  const b = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const code = typeof b.code === 'string' ? b.code.replace(/\s/g, '') : '';
  const recovery = typeof b.recovery === 'string' ? b.recovery : '';

  const emailOk = email === acct.email;
  const passwordOk = (await verifyPassword(password, emailOk ? acct.passwordHash : DUMMY_HASH)) && emailOk;

  let secondOk = false, usedRecovery = false, step: number | undefined;
  if (recovery) {
    const h = hashRecoveryCode(recovery);
    // only spend a recovery code when the password was right, so a guess cannot burn one
    if (passwordOk && acct.recoveryHashes.includes(h)) { secondOk = useOnce('recovery', h); usedRecovery = secondOk; }
  } else if (code) {
    step = verifyTotp(acct.totpSecret, code, now, getLastTotpStep());
    secondOk = step !== undefined;
  }

  if (!(passwordOk && secondOk)) {
    limiter.fail(ip, now);
    console.warn(`[auth] failed sign-in from ${ip}`);
    await new Promise(r => setTimeout(r, 400));          // a small fixed delay: guessing gets slower, honest typos barely notice
    return NextResponse.json({ error: WRONG }, { status: 401 });
  }

  if (step !== undefined) setLastTotpStep(step);
  limiter.succeed(ip);
  const res = NextResponse.json({ ok: true, ...(usedRecovery ? { recoveryUsed: true } : {}) });
  res.cookies.set(SESSION_COOKIE, signSession({ email: acct.email }, acct.secret, now, SESSION_MS), {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: SESSION_MS / 1000,
  });
  return res;
});

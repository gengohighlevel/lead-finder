import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/hostedGate';

/** Sign out: clear the session cookie. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return res;
}

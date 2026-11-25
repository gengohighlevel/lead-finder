import { NextResponse } from 'next/server';
import { hostedConfig } from '@/lib/cfAccess';
import { verifySession } from '@/lib/auth';
import { getCookie, SESSION_COOKIE } from '@/lib/hostedGate';

export const dynamic = 'force-dynamic';

/** Who is signed in (password mode), so the page can show it and offer Sign out. 401 when nobody is. */
export async function GET(req: Request) {
  const cfg = hostedConfig(process.env);
  if (!cfg.hosted || cfg.mode !== 'password' || !cfg.password) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const s = verifySession(getCookie(req.headers.get('cookie'), SESSION_COOKIE), cfg.password.secret, Date.now());
  return s && s.email === cfg.password.email ? NextResponse.json({ email: s.email }) : NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
}

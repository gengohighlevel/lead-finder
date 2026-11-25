import { NextResponse, type NextRequest } from 'next/server';
import { gateRequest, loginUrl } from './lib/hostedGate';

/** Runs before every request: the local rules, plus the hosted login when the app is hosted (lib/hostedGate.ts). */
export async function proxy(request: NextRequest) {
  const g = await gateRequest({
    method: request.method, host: request.headers.get('host'), origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'), contentType: request.headers.get('content-type'),
    path: request.nextUrl.pathname, accessToken: request.headers.get('cf-access-jwt-assertion'), cookie: request.headers.get('cookie'),
  }, process.env);
  if (g.ok) return NextResponse.next();
  if ('redirect' in g) return NextResponse.redirect(loginUrl(request.headers.get('host'), request.headers.get('x-forwarded-proto'), g.redirect), 302);
  return NextResponse.json({ error: g.reason }, { status: g.status });
}

export const config = { matcher: ['/((?!_next/static|_next/image|icon.svg).*)'] };

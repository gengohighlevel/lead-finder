import { NextResponse } from 'next/server';

/**
 * Wraps an API route so a thrown error comes back as a JSON answer ({ error }) with status 500.
 * Without it Next sends an empty 500 and the page can only say "Unexpected end of JSON input".
 */
export function safeRoute(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async req => {
    try { return await handler(req); }
    catch (e) {
      console.error(`[api ${new URL(req.url).pathname}]`, e);
      return NextResponse.json({ error: `The server hit an error: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
    }
  };
}

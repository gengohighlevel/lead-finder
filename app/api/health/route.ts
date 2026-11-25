import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** For the container health check. Returns nothing private. */
export async function GET() { return NextResponse.json({ ok: true }); }

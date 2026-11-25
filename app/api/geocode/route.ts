import { NextResponse } from 'next/server';
import { geocode, countryCodes } from '@/lib/geocode';
import { LocationNotFoundError } from '@/lib/place';

export async function POST(req: Request) {
  const { location, country } = await req.json().catch(() => ({}));
  if (typeof location !== 'string' || !location.trim()) return NextResponse.json({ error: 'location required' }, { status: 400 });
  try {
    return NextResponse.json({ candidates: await geocode(location.trim(), countryCodes(country)) });
  } catch (e) {
    if (e instanceof LocationNotFoundError) return NextResponse.json({ error: `Location not found: ${location}. Check spelling or pick another country.` }, { status: 404 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'geocoding failed' }, { status: 502 });
  }
}

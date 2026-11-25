import path from 'node:path';
import { NextResponse } from 'next/server';
import { listCollections } from '@/lib/localBackgrounds';

export const dynamic = 'force-dynamic';

/** The wallpaper collections in public/backgrounds (see lib/localBackgrounds.ts). */
export function GET() {
  return NextResponse.json({ collections: listCollections(path.join(process.cwd(), 'public', 'backgrounds')) });
}

import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { getLeadsByIds } from '@/lib/db';
import { checkLeadEmails } from '@/lib/emailCheckLeads';

export const POST = safeRoute(async (req: Request) => {
  const { ids } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) return NextResponse.json({ error: 'ids required' }, { status: 400 });
  await checkLeadEmails(getLeadsByIds(ids));
  return NextResponse.json({ leads: getLeadsByIds(ids) });
});

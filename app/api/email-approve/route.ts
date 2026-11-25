import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { getLeadsByIds, updateResearch } from '@/lib/db';
import { EMAIL_CHECK_VERSION } from '@/lib/emailStatus';

/**
 * Approve (or undo approving) one lead's email by hand. Only an ownership doubt can be approved (an address on another
 * company's domain, a free mailbox not shown on their site, no website to compare): never an address that cannot receive
 * mail, and never a mail-server problem. The approval is for that exact address.
 */
export const POST = safeRoute(async (req: Request) => {
  const { id, approve } = await req.json().catch(() => ({}));
  if (!Number.isInteger(id) || typeof approve !== 'boolean') return NextResponse.json({ error: 'id and approve required' }, { status: 400 });
  const lead = getLeadsByIds([id])[0];
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  const r = lead.research;
  if (!r || !lead.email) return NextResponse.json({ error: 'this lead has no email to approve' }, { status: 400 });
  if (approve) {
    const c = r.emailCheck;
    if (!c || (c.v ?? 0) < EMAIL_CHECK_VERSION) return NextResponse.json({ error: 'check this email first' }, { status: 400 });
    if (c.status === 'bad') return NextResponse.json({ error: 'this address cannot receive mail and cannot be approved' }, { status: 400 });
    if (c.status === 'risky' && !c.approvable) return NextResponse.json({ error: 'this is a mail-server problem, not a question of whose address it is, so it cannot be approved' }, { status: 400 });
    if (c.status === 'ok') return NextResponse.json({ lead }); // already verified
    updateResearch(id, { ...r, emailApproval: { email: lead.email, at: new Date().toISOString() } });
  } else {
    const { emailApproval: _removed, ...rest } = r;
    void _removed;
    updateResearch(id, rest);
  }
  return NextResponse.json({ lead: getLeadsByIds([id])[0] });
});

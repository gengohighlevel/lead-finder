import { NextResponse } from 'next/server';
import { loadGateState } from '@/lib/gateState';

export const dynamic = 'force-dynamic';

/** Your country rules and do-not-contact list, for the page to apply the same gate the push does. */
export async function GET() {
  const { state, problem } = loadGateState();
  return NextResponse.json({ policy: state.policy, suppressions: state.suppressions, ...(problem ? { problem } : {}) });
}

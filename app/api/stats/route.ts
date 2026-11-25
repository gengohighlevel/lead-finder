import { NextResponse } from 'next/server';
import { getAllLeads } from '@/lib/db';
import { computeStats } from '@/lib/stats';
import { senderComplete, senderFromEnv } from '@/lib/emailDraft';

export const dynamic = 'force-dynamic';

async function ollamaUp(): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    return (await fetch(`${process.env.OLLAMA_URL ?? 'http://localhost:11434'}/api/tags`, { signal: ctl.signal })).ok;
  } catch { return false; } finally { clearTimeout(t); }
}

export async function GET() {
  return NextResponse.json({
    stats: computeStats(getAllLeads()),
    // booleans only: never send the token or location id to the browser
    system: { ollama: await ollamaUp(), ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.2:3b', ghl: !!(process.env.GHL_TOKEN && process.env.GHL_LOCATION_ID), senderReady: senderComplete(senderFromEnv()) },
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { listSuppressions } from './db';
import { DEFAULT_POLICY, normalizePolicy } from './outreachPolicy';
import type { GateState } from './emailGate';

/** Your country rules from outreach-policy.json (if the file exists) and your do-not-contact list. Server only. */
export function loadGateState(): { state: GateState; problem?: string } {
  const file = process.env.OUTREACH_POLICY_FILE?.trim() || path.join(process.cwd(), 'outreach-policy.json');
  let policy = DEFAULT_POLICY, problem: string | undefined;
  if (fs.existsSync(file)) {
    try { policy = normalizePolicy(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { problem = 'outreach-policy.json could not be read (invalid JSON), so the safe defaults are in use.'; }
  }
  return { state: { policy, suppressions: listSuppressions() }, ...(problem ? { problem } : {}) };
}

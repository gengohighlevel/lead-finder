import { backupIfDue } from './backup';

/** Back up once a day while the app runs (checked every hour, and shortly after it starts). Never throws. */
export function startBackups(): void {
  const g = globalThis as { __leadFinderBackups?: boolean };
  if (g.__leadFinderBackups) return;                 // dev reloads must not stack timers
  g.__leadFinderBackups = true;
  const run = () => backupIfDue().catch(e => console.error('[backup] failed:', e instanceof Error ? e.message : e));
  setTimeout(run, 5_000);
  setInterval(run, 3_600_000).unref?.();
}

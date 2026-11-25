import fs from 'node:fs';
import path from 'node:path';

export const offerText = () => {
  for (const f of ['OFFER.md', 'OFFER.example.md']) { try { return fs.readFileSync(path.join(process.cwd(), f), 'utf8'); } catch { /* try the next */ } }
  return '';
};

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

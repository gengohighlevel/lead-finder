import { isShared } from './dnc';
import { FREEMAIL } from './emailStatus';
import { normName } from './research';

/**
 * How we decide two saved leads are the same business. A name alone never matches (different branches share names):
 *   site:   the same website host (social pages and free-mail domains do not count)
 *   phone:  the same phone number, only when there is no website to compare
 *   place:  the same name AND the same street address
 * Pure and client-safe. Used by the cross-search duplicate guard on save and by the "Duplicates" clean-up.
 */
export type KeyInput = { name: string; website?: string | null; phone?: string | null; address?: string | null };

const host = (u?: string | null) => (u ?? '').trim().toLowerCase().match(/^(?:[a-z]+:\/\/)?([^/?#:]+)/)?.[1]?.replace(/^www\./, '');

export function identityKeys(l: KeyInput): string[] {
  const keys: string[] = [];
  const h = host(l.website);
  const site = h && h.includes('.') && !isShared(h) && !FREEMAIL.has(h) ? h : undefined;
  if (site) keys.push(`site:${site}`);
  const digits = (l.phone ?? '').replace(/\D/g, '');
  if (!site && digits.length >= 7) keys.push(`phone:${digits.slice(-9)}`);
  const addr = (l.address ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (addr.length >= 6 && normName(l.name).length >= 3) keys.push(`place:${normName(l.name)}|${addr}`);
  return keys;
}

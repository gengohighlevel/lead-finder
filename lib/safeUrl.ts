import { lookup } from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(v)) {
    return v === '::' || v === '::1' || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')
      || v.startsWith('fc') || v.startsWith('fd');
  }
  return true; // unparseable: treat as unsafe
}

/** Throws unless url is http(s) and every resolved address is public. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked protocol');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('blocked host');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('blocked address');
    return u;
  }
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('blocked address');
  return u;
}

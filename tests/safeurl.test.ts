import { describe, it, expect, vi } from 'vitest';
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (h: string) => (h === 'evil.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])),
}));
import { isPrivateIp, assertPublicUrl } from '../lib/safeUrl';

describe('isPrivateIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1'])('%s private', ip => expect(isPrivateIp(ip)).toBe(true));
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700::1111'])('%s public', ip => expect(isPrivateIp(ip)).toBe(false));
});
describe('assertPublicUrl', () => {
  it('rejects non-http', async () => { await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(); });
  it('rejects ip literal private', async () => { await expect(assertPublicUrl('http://127.0.0.1:3000/')).rejects.toThrow(); });
  it('rejects hostname resolving private', async () => { await expect(assertPublicUrl('http://evil.example/')).rejects.toThrow(); });
  it('accepts public', async () => { expect((await assertPublicUrl('https://ok.example/x')).hostname).toBe('ok.example'); });
});

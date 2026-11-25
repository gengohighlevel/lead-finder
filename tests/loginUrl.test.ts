import { describe, it, expect } from 'vitest';
import { loginUrl } from '../lib/hostedGate';

describe('loginUrl: where an unsigned-in visitor is sent', () => {
  it('uses the host they asked for and the protocol the reverse proxy saw (https behind Caddy)', () => {
    expect(loginUrl('dashboard.example.com', 'https', '/login')).toBe('https://dashboard.example.com/login');
    expect(loginUrl('dashboard.example.com', 'https, http', '/login')).toBe('https://dashboard.example.com/login');
  });
  it('defaults to https for a real host when no protocol was forwarded, and http for the local app', () => {
    expect(loginUrl('dashboard.example.com', null, '/login')).toBe('https://dashboard.example.com/login');
    expect(loginUrl('127.0.0.1:3000', null, '/login')).toBe('http://127.0.0.1:3000/login');
    expect(loginUrl('localhost:3000', null, '/login')).toBe('http://localhost:3000/login');
  });
  it('ignores a forwarded protocol that is not http or https', () => {
    expect(loginUrl('dashboard.example.com', 'javascript', '/login')).toBe('https://dashboard.example.com/login');
  });
  it('never builds a URL from a host with odd characters (it falls back to a relative-safe default)', () => {
    for (const bad of ['evil.com/x', 'a b.com', 'a.com@evil.com', '', 'a.com\r\nSet-Cookie: x=1']) expect(loginUrl(bad, 'https', '/login'), bad).toBe('https://invalid.invalid/login');
  });
});

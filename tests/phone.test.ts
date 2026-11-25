import { describe, it, expect } from 'vitest';
import { toE164, formatPhones, isMobileNumber, phoneCountry } from '../lib/phone';

describe('toE164', () => {
  it('formats national numbers using the lead country', () => {
    expect(toE164('(512) 327-3631', 'us')).toBe('+15123273631');
    expect(toE164('512-327-3631', 'us')).toBe('+15123273631');
    expect(toE164('0412 345 678', 'AU')).toBe('+61412345678');
    expect(toE164('021 123 4567', 'nz')).toBe('+64211234567');
    expect(toE164('030 12345678', 'de')).toBe('+493012345678');
    expect(toE164('416-967-1111', 'ca')).toBe('+14169671111');
  });
  it('keeps numbers that already carry a country code, whatever the lead country', () => {
    expect(toE164('+44 20 7946 0958', 'us')).toBe('+442079460958');
    expect(toE164('+1 512 327 3631', undefined)).toBe('+15123273631');
    expect(toE164('0061 412 345 678', 'au')).toBe('+61412345678');
  });
  it('takes the first number when OpenStreetMap lists several', () => {
    expect(toE164('+1 512 327 3631; +1 512 327 2234', 'us')).toBe('+15123273631');
    expect(toE164('512-327-3631 / 512-327-2234', 'us')).toBe('+15123273631');
  });
  it('drops extensions and labels', () => {
    expect(toE164('512-327-3631 ext. 4', 'us')).toBe('+15123273631');
    expect(toE164('Tel: 512 327 3631', 'us')).toBe('+15123273631');
  });
  it('returns undefined for junk, empty and impossible numbers', () => {
    for (const bad of ['', undefined, 'call us', '12345', '000', '+1 123']) expect(toE164(bad as string | undefined, 'us'), String(bad)).toBeUndefined();
  });
  it('without any country and no plus sign, does not guess', () => {
    expect(toE164('512-327-3631', undefined)).toBeUndefined();
  });
  it('treats EU as "unknown country" for a national number but still reads international ones', () => {
    expect(toE164('030 12345678', 'eu')).toBeUndefined();
    expect(toE164('+49 30 12345678', 'eu')).toBe('+493012345678');
  });
});

describe('formatPhones', () => {
  it('adds a readable international form next to E.164, only when valid', () => {
    expect(formatPhones('512-327-3631', 'us')).toEqual({ e164: '+15123273631', display: '+1 512 327 3631' });
    expect(formatPhones('call us', 'us')).toEqual({});
  });
});

describe('isMobileNumber', () => {
  it('is true only for numbers that are definitely mobile (the ones that can have WhatsApp)', () => {
    expect(isMobileNumber('+61412345678')).toBe(true);     // Australian mobile
    expect(isMobileNumber('+2348012345678')).toBe(true);   // Nigerian mobile
    expect(isMobileNumber('+61733334444')).toBe(false);    // Brisbane landline
    expect(isMobileNumber('+493012345678')).toBe(false);   // Berlin landline
    expect(isMobileNumber('+611300669409')).toBe(false);   // 1300 number
  });
  it('is false for the US and Canada (mobile and landline share ranges, so it cannot be told) and for garbage', () => {
    expect(isMobileNumber('+15123273631')).toBe(false);
    expect(isMobileNumber('nope')).toBe(false);
    expect(isMobileNumber('')).toBe(false);
  });
});

describe('Philippines numbers', () => {
  it('turns a national mobile and a Manila landline into E.164', () => {
    expect(toE164('0917 123 4567', 'PH')).toBe('+639171234567');
    expect(toE164('(02) 8123 4567', 'PH')).toBe('+63281234567');
    expect(toE164('+63 917 123 4567')).toBe('+639171234567');
  });
  it('knows a Philippine mobile can have WhatsApp-type channels and belongs to PH', () => {
    expect(isMobileNumber('+639171234567')).toBe(true);
    expect(phoneCountry('+63 917 123 4567')).toBe('PH');
  });
});

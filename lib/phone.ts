import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';

/**
 * A phone number in international format (E.164, "+15123273631"), which is what GHL needs to text or call.
 * Reads the lead's own country for numbers written nationally; numbers that already start with + or 00 need no country.
 * Returns undefined when the number is not a real, possible number, so a bad one is never sent on.
 */
export function toE164(raw: string | undefined, country?: string): string | undefined {
  if (!raw) return undefined;
  // OpenStreetMap often holds several numbers ("a; b" or "a / b"): use the first
  let s = raw.split(/[;/,|]|\s+or\s+/i)[0].replace(/\b(?:ext|extension|x)\.?\s*\d+\s*$/i, '').replace(/^[^+\d(]*/, '').trim();
  if (/^00(?!0)/.test(s)) s = `+${s.slice(2)}`;
  const c = country?.toUpperCase();
  // "EU" is a market, not a country: a national number there cannot be placed
  const region = c && /^[A-Z]{2}$/.test(c) && c !== 'EU' ? (c as CountryCode) : undefined;
  try {
    const p = parsePhoneNumberFromString(s, region);
    return p && p.isValid() ? p.number : undefined;
  } catch { return undefined; }
}

export function formatPhones(raw: string | undefined, country?: string): { e164?: string; display?: string } {
  const e164 = toE164(raw, country);
  if (!e164) return {};
  const p = parsePhoneNumberFromString(e164);
  return { e164, display: p?.formatInternational() };
}

/** True only for a number that is definitely a mobile (the kind that can have WhatsApp). The US and Canada share one range for mobile and landline, so they are never "definitely mobile". */
export function isMobileNumber(e164: string): boolean {
  try { return parsePhoneNumberFromString(e164)?.getType() === 'MOBILE'; } catch { return false; }
}

/** The country an international number belongs to ("AU"), or undefined when it cannot be told. */
export function phoneCountry(raw: string | undefined): string | undefined {
  const e164 = toE164(raw);
  if (!e164) return undefined;
  try { return parsePhoneNumberFromString(e164)?.country; } catch { return undefined; }
}

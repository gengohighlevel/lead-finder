/**
 * Where you may email. One rule per country, applied to the email address only (the contact still goes to GHL without it):
 *   allow           any verified address
 *   published-only  only an address the business itself publishes on its own website (not one from a map listing)
 *   block           no email for this country
 * The defaults are cautious starting points, NOT legal advice: laws differ by country and change, and some (Canada's CASL,
 * the EU's GDPR and ePrivacy rules, Germany's UWG) are stricter than the defaults here. Check with a lawyer for your markets,
 * then change the rules in outreach-policy.json.
 */
export type Rule = 'allow' | 'published-only' | 'block';
export type Policy = { rules: Record<string, Rule>; fallback: Rule };

export const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
export const DEFAULT_POLICY: Policy = { rules: { US: 'allow', CA: 'published-only', AU: 'published-only', NZ: 'published-only', PH: 'published-only' }, fallback: 'block' };

const RULES = new Set<Rule>(['allow', 'published-only', 'block']);
const isRule = (v: unknown): v is Rule => typeof v === 'string' && RULES.has(v as Rule);

/** The policy file's contents merged over the defaults. Anything invalid is ignored, so a typo can only leave a default in place. */
export function normalizePolicy(raw: unknown): Policy {
  const rules: Record<string, Rule> = { ...DEFAULT_POLICY.rules };
  let fallback = DEFAULT_POLICY.fallback;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (isRule(o.EU)) for (const c of EU) rules[c] = o.EU;                       // the group first, so a named country wins over it
    for (const [k, v] of Object.entries(o)) {
      const key = k.toUpperCase();
      if (key === 'DEFAULT' && isRule(v)) fallback = v;
      else if (/^[A-Z]{2}$/.test(key) && key !== 'EU' && isRule(v)) rules[key] = v;
    }
  }
  return { rules, fallback };
}

export const ruleFor = (country: string | undefined, p: Policy): Rule => (country ? p.rules[country.toUpperCase()] ?? p.fallback : 'block');

/** The lead's country: its own, else the one its phone number belongs to, else unknown. "EU" is a market, not a country. */
export function countryOfLead(l: { phone?: string }, research?: { country?: string }, fromPhone?: (phone?: string) => string | undefined): string | undefined {
  const own = (research?.country ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(own) && own !== 'EU') return own;
  return fromPhone?.(l.phone)?.toUpperCase();
}

export type PolicyDecision = { allowed: boolean; rule: Rule; reason: string };

export function emailPolicyDecision(country: string | undefined, emailSource: 'website' | 'listing' | undefined, p: Policy): PolicyDecision {
  if (!country) return { allowed: false, rule: 'block', reason: "this business's country is unknown, so its email is held until it is known" };
  const c = country.toUpperCase(), rule = ruleFor(c, p);
  if (rule === 'allow') return { allowed: true, rule, reason: `${c}: email allowed by your policy` };
  if (rule === 'block') return { allowed: false, rule, reason: `${c}: email outreach is switched off for this country in your policy` };
  return emailSource === 'website'
    ? { allowed: true, rule, reason: `${c}: allowed because this address is published on the business's own website` }
    : { allowed: false, rule, reason: `${c}: your policy only allows addresses the business publishes on its own website; this one came from a listing` };
}

export type Factors = {
  crmRelevance: number; leadGenDependency: number; customerValue: number;
  workflowComplexity: number; contactAccessibility: number; actionableOpportunity: number;
};
export type Score = { total: number; factors: Factors; priority: 'A' | 'B' | 'C' | 'D'; confidence: 'High' | 'Medium' | 'Low' };

// Industry tiers by keyword in the searched business type.
const HIGH_CRM = /(rental|charter|yacht|vacation|holiday|airbnb|car hire|boat hire|dent|medic|clinic|doctor|chiro|physio|aesthetic|spa|real estate|realtor|estate|lawyer|attorney|law|insurance|financial|account|tax|roof|hvac|plumb|electric|contract|build|remodel|solar|moving|mover|removal|landscap|coach|consult|gym|fitness|vet|optic|driving school|car dealer|marketing|agency|architect)/i;
const MID_CRM = /(makeup|lash|brow|esthetic|stylist|hair|wedding|tutor|trainer|groom|doula|interior|design|bookkeep|handyman|tailor|seamstress|\\bdj\\b|videograph|event plan|notary|therap|hypno|nutrition|dietit|salon|barber|beauty|nail|massage|tattoo|yoga|hotel|bed and breakfast|travel|car repair|mechanic|pet|daycare|childcare|kindergarten|photograph|locksmith|painter|carpenter|tiler|plaster|clean|storage|it )/i;
const HIGH_VALUE = /(yacht|charter|vacation rental|holiday rental|dent|medic|clinic|aesthetic|real estate|realtor|estate|lawyer|attorney|law|insurance|financial|roof|hvac|contract|build|remodel|solar|moving|mover|removal|architect|car dealer|marketing|agency)/i;
const LOW_VALUE = /(cafe|coffee|bakery|restaurant|bar|florist|laundry|dry clean|pharmacy)/i;
const APPOINTMENT_OR_QUOTE = /(rental|charter|yacht|vacation|holiday|airbnb|hire|makeup|lash|brow|esthetic|stylist|hair|wedding|tutor|trainer|groom|doula|interior|design|bookkeep|handyman|tailor|seamstress|\\bdj\\b|videograph|event plan|notary|therap|hypno|nutrition|dietit|dent|medic|clinic|doctor|chiro|physio|aesthetic|spa|salon|barber|beauty|nail|massage|tattoo|lawyer|attorney|law|account|tax|insurance|financial|real estate|realtor|roof|hvac|plumb|electric|contract|build|remodel|moving|mover|removal|landscap|vet|optic|consult|coach|driving school|car repair|mechanic|architect|photograph)/i;

export function priorityFor(total: number): Score['priority'] {
  return total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : 'D';
}

export function scoreLead(i: {
  type: string; hasWebsite: boolean; siteReachable: boolean; email?: string; phone?: string;
  processes: string[]; signals: string[];
  /** Has an Instagram or Facebook page: a way to reach a business that lists no email. */
  hasSocial?: boolean;
  /** false = the email failed verification: it earns nothing, because it will never be sent. */
  emailVerified?: boolean;
  /** false = nobody can reach this business (no email, phone, social page or form): it can never rank A or B. */
  reachable?: boolean;
}): Score {
  const email = i.emailVerified === false ? undefined : i.email;
  const t = ` ${i.type.toLowerCase()} `;
  const intake = i.processes.some(p => ['contact_form', 'quote_request', 'online_booking'].includes(p));
  const factors: Factors = {
    crmRelevance: HIGH_CRM.test(t) ? 25 : MID_CRM.test(t) ? 15 : 10,
    leadGenDependency: i.siteReachable ? 12 + (intake ? 8 : 0) : i.hasWebsite ? 8 : 4,
    customerValue: HIGH_VALUE.test(t) ? 15 : LOW_VALUE.test(t) ? 5 : 10,
    workflowComplexity: Math.min(15, (APPOINTMENT_OR_QUOTE.test(t) ? 10 : 5) + (intake ? 5 : 0)),
    contactAccessibility: Math.min(10, (email ? 6 : 0) + (i.phone ? 4 : 0) + (!email && i.hasSocial ? 3 : 0)),
    actionableOpportunity: i.signals.includes('no_website') ? 12 : Math.min(15, i.signals.length * 4),
  };
  const raw = Math.min(100, Object.values(factors).reduce((a, b) => a + b, 0));
  const total = i.reachable === false ? Math.min(raw, 59) : raw;
  const confidence: Score['confidence'] = i.siteReachable && (email || i.phone) ? 'High'
    : i.siteReachable || i.phone || email || i.hasSocial ? 'Medium' : 'Low';
  if (i.reachable === false) return { total, factors, priority: priorityFor(total), confidence: 'Low' };
  return { total, factors, priority: priorityFor(total), confidence };
}

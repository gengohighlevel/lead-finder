/** Example outreach plays. Edit the wording to match what you sell; service names must match the lines in OFFER.md (or OFFER.example.md). */
export type Play = { id: string; service: string; opportunity: string; question: string; hook: string };

export const PLAYBOOK: Record<string, Play> = {
  lead_management: { id: 'lead_management', service: 'Lead Management System', opportunity: 'Every inquiry from every channel in one place with a clear owner, so nothing sits unanswered',
    question: 'Where do most of your new inquiries come in right now, and who keeps track of them?',
    hook: 'When someone messages your Facebook page on a Saturday, who sees it first, and when?' },
  booking: { id: 'booking', service: 'Appointment Booking System', opportunity: 'Customers book themselves at any hour, with reminders that go out on their own so fewer people forget',
    question: 'When someone wants to book after hours, what happens right now?',
    hook: 'How many of your bookings still start with a phone call and end with a voicemail?' },
  pipeline: { id: 'pipeline', service: 'Sales Pipeline System', opportunity: 'See every open quote at a glance: where it is at, who is following up, and what happens next',
    question: 'After you send a quote, what usually happens next?',
    hook: 'If I asked how many quotes you sent last month are still waiting on an answer, could you tell me in under a minute?' },
  followups: { id: 'followups', service: 'Automated Follow-Up System', opportunity: 'Follow up with every prospect at the right time, by text or email, without anyone having to remember',
    question: 'After someone asks for a price, how many times do they usually hear from you?',
    hook: "When someone says 'let me think about it', who follows up, and when?" },
  onboarding: { id: 'onboarding', service: 'Client Onboarding System', opportunity: 'A smooth start for every new yes: welcome, forms and next steps sent on their own',
    question: 'What happens between someone saying yes and their first appointment or job?',
    hook: 'When someone says yes, how many back-and-forth emails before you can actually start?' },
  reactivation: { id: 'reactivation', service: 'Customer Reactivation System', opportunity: 'Reconnect with past customers in a friendly, personal way so more come back without extra ad spend',
    question: "What do you do right now to bring back customers who haven't been in for a while?",
    hook: "How many people have bought from you before but haven't been back in the last 12 months?" },
  reviews: { id: 'reviews', service: 'Review & Reputation System', opportunity: 'Ask every happy customer for a review at the right moment so your online reputation matches your work',
    question: 'How do you ask for reviews right now, if at all?',
    hook: 'How many happy customers did you see last month, and how many left a review?' },
  payments: { id: 'payments', service: 'Payment Follow-Up System', opportunity: 'Polite, consistent payment reminders that go out on their own, so you get paid faster without awkward calls',
    question: 'When an invoice goes past due, what happens next?',
    hook: 'How much time does someone spend each week chasing unpaid invoices?' },
  retention: { id: 'retention', service: 'Customer Retention System', opportunity: 'Stay in touch between visits with reminders and check-ins that feel personal, so customers come back to you first',
    question: 'After a job or appointment is finished, does the customer hear from you again?',
    hook: 'When did a happy customer last hear from you without having to call you first?' },
  qualification: { id: 'qualification', service: 'AI-Assisted Lead Qualification System', opportunity: 'Reply to every inquiry instantly, ask the right questions, and send serious prospects straight to you',
    question: 'How do you decide which inquiries get called back first?',
    hook: 'How much of your week goes to inquiries that were never going to buy?' },
};

/** Priority order of detected gaps. */
export const GAP_ORDER = ['no_website', 'no_booking', 'booking_by_form', 'no_chat', 'no_analytics', 'not_mobile', 'no_https', 'no_instagram'];

/** Gaps that point at a playbook service. not_mobile / no_https are website-only fixes. */
const GAP_PLAY: Record<string, string> = {
  no_website: 'lead_management', no_booking: 'booking', booking_by_form: 'booking', no_chat: 'qualification', no_analytics: 'pipeline', no_instagram: 'reactivation',
};

/** Playbook "Top 5 for cold outreach": best-fit service by business type when no gap decides it. */
const TYPE_PLAY: Array<[RegExp, string]> = [
  [/\b(plumb|electric|hvac|roof|contractor|builder|painter|carpenter|garden|landscap|tiler|plasterer|glazier|locksmith|mov(er|ing)|removal)/, 'followups'],
  [/\b(dentist|dental|doctor|clinic|physio|chiropract|salon|hair|barber|beauty|nail|spa|massage|optic|optom|tattoo)/, 'booking'],
  [/\b(gym|fitness|yoga|vet|car repair|mechanic|laundry|dry clean|pet)\b/, 'reactivation'],
  [/\b(real estate|realtor|lawyer|attorney|law firm|insurance|accountant|accounting)/, 'lead_management'],
  // one-person businesses: appointment-led ones book by message; designers, coaches and the like live on inquiries.
  // quote-led ones (wedding planners, handymen, cleaners, tailors) fall through to follow-ups.
  [/\b(makeup|lash|brow|esthetic|stylist|tutor|trainer|groom|doula|therap|hypno|nutrition|dietit)/, 'booking'],
  [/\b(rental|charter|yacht|vacation|holiday|airbnb|boat hire|car hire)/, 'booking'],
  [/\b(designer|bookkeep|notary|interior|coach|photograph|videograph)|\bdj\b/, 'lead_management'],
];

export function pickPlay(gaps: string[], type = ''): Play {
  const gap = GAP_ORDER.find(g => gaps.includes(g) && GAP_PLAY[g]);
  if (gap) return PLAYBOOK[GAP_PLAY[gap]];
  const t = type.toLowerCase();
  const hit = TYPE_PLAY.find(([re]) => re.test(t));
  return PLAYBOOK[hit ? hit[1] : 'followups'];
}

/**
 * Businesses that sell by quote, not by appointment (movers, trades, cleaners, planners). A booking calendar is not a gap for them,
 * so no booking claim is made: their way in is the enquiry or quote form.
 */
const QUOTE_LED = /(plumb|electric|hvac|roof|contract|build|remodel|renovat|painter|carpenter|garden|landscap|tiler|plaster|glazier|locksmith|mov(er|ing)|removal|relocat|storage|freight|courier|transport|logistic|handyman|clean|pest|solar|fenc|concret|wedding|event plan|caterer|catering|tailor|seamstress|architect|interior)/i;
export const isQuoteLed = (type: string) => QUOTE_LED.test(type);

/** Playbook rule: no tech words up front. */
const TECH = /\b(crm|automat\w*|ai|pipeline|software|workflow\w*|chatbot)\b/i;
export const hasTechWords = (s: string) => TECH.test(s);

/** Rules block injected into the model prompt. */
export const COPY_RULES = `Copy rules (owner-to-owner, problem before solution):
- Write everything in English, even when the business name or country is not English. Do not translate or switch language.
- Plain words a busy local business owner uses. Never use the words CRM, automation, AI, pipeline, software or workflow in the observation or either question.
- Unverified problems are asked as questions, never stated as facts. No invented numbers, clients or compliments.
- Questions are short (under 25 words), friendly and non-pushy.`;

import { checkEmail, EMAIL_CHECK_VERSION } from './emailCheck';
import { updateEmailCheck, type Lead } from './db';
import { mapLimit } from './pipeline';

/** An email never checked, or checked under older, looser rules, is checked (again) before anything trusts it. */
export const needsEmailCheck = (l: Lead) => !!l.email && !!l.research && (l.research.emailCheck?.v ?? 0) < EMAIL_CHECK_VERSION;

/** Check each lead's email against the business's own website. Never sends anything. */
export async function checkLeadEmails(leads: Lead[]): Promise<void> {
  await mapLimit(leads.filter(needsEmailCheck), 16, async l => updateEmailCheck(l.id, await checkEmail(l.email!, {
    website: l.website, foundOnSite: l.research?.emailSource === 'website',
  })));
}

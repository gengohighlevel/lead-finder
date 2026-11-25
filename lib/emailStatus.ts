/** Email check results and the send rule. No server-only imports, so the page can use it too. */
export type EmailKind = 'personal' | 'role' | 'freemail';
export type EmailCheck = { status: 'ok' | 'risky' | 'bad'; kind: EmailKind; reasons: string[]; checkedAt: string; /** rules version; older checks are not trusted */ v?: number;
  /** A person may approve this by hand: the doubt is about WHOSE address it is, not about whether it can receive mail. */
  approvable?: boolean };
/** A person's decision that this exact address belongs to the business. */
export type EmailApproval = { email: string; at: string };

/** Raise when the rules get stricter, so older 'ok' answers are checked again before anything is sent. */
export const EMAIL_CHECK_VERSION = 3; // 3: approvable flag
/** The only emails that may be handed to GHL (and so ever be emailed). */
export const isSendable = (c?: EmailCheck): boolean => !!c && c.status === 'ok' && (c.v ?? 0) >= EMAIL_CHECK_VERSION;
/** May this address be given to GHL? Verified, or an approvable doubt that a person approved for THIS address. Never a bad address. */
export const canSend = (check?: EmailCheck, approval?: EmailApproval, email?: string): boolean =>
  isSendable(check) || (!!check && check.status === 'risky' && !!check.approvable && (check.v ?? 0) >= EMAIL_CHECK_VERSION
    && !!approval && !!email && approval.email.trim().toLowerCase() === email.trim().toLowerCase());

/** Mailbox providers anyone can sign up to: an address here says nothing about which business owns it, and the provider itself must never be blocked as a whole. */
export const FREEMAIL = new Set(`gmail.com googlemail.com yahoo.com yahoo.com.au yahoo.co.uk yahoo.ca ymail.com hotmail.com hotmail.co.uk outlook.com live.com msn.com icloud.com me.com
  aol.com proton.me protonmail.com gmx.com gmx.net gmx.de web.de mail.com zoho.com bigpond.com bigpond.net.au optusnet.com.au xtra.co.nz sympatico.ca shaw.ca rogers.com
  btinternet.com sky.com orange.fr wanadoo.fr free.fr libero.it t-online.de`.split(/\s+/));


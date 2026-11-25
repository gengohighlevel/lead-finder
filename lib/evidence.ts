export type Process = 'contact_form' | 'quote_request' | 'online_booking' | 'booking_link' | 'live_chat' | 'messaging_link' | 'phone_link' | 'email_link';

export const PROCESS_LABEL: Record<Process, string> = {
  contact_form: 'Website contact form',
  quote_request: 'Request-a-quote / estimate offer',
  online_booking: 'Online booking tool',
  booking_link: "'Book' button or link (leads to a page or form; not confirmed as live booking)",
  live_chat: 'Live chat widget',
  messaging_link: 'WhatsApp / Messenger link',
  phone_link: 'Click-to-call phone link',
  email_link: 'Email link',
};

const FB_SKIP = new Set(['sharer', 'sharer.php', 'plugins', 'tr', 'dialog', 'share.php', 'login', 'policies', 'help', 'events', 'groups', 'watch', 'profile.php']);
export function extractFacebook(html: string): string | undefined {
  for (const m of html.matchAll(/(?:www\.|m\.)?facebook\.com\/([A-Za-z0-9.\-]+)/gi)) {
    const page = m[1].replace(/\.$/, '');
    if (FB_SKIP.has(page.toLowerCase())) continue;
    return `https://facebook.com/${page}`;
  }
  return undefined;
}

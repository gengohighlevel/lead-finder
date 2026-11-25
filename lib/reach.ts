/** Can anyone actually reach this business? An email that cannot receive mail does not count. */
export function canBeReached(
  l: { email?: string; phone?: string; instagram?: string },
  r?: { facebook?: string; processes?: string[]; emailCheck?: { status: string } },
): boolean {
  const email = !!l.email && r?.emailCheck?.status !== 'bad';
  const social = !!l.instagram || !!r?.facebook;
  const onSite = !!r?.processes?.some(p => p === 'contact_form' || p === 'phone_link' || p === 'email_link');
  return email || !!l.phone || social || onSite;
}

export const MEMBERSHIP_CONTRACT_VERSION = 'DMCCA-READY-2026-09-12';
export const FIRST_REMINDER_WINDOW = '60 to 45 days before renewal';
export const FINAL_REMINDER_WINDOW = '14 to 7 days before renewal';

export function serviceHeaders(prefer = '') {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

export function money(pence) {
  return `£${(Number(pence || 0) / 100).toFixed(2)}`;
}

export function dateUK(value) {
  return value
    ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : 'the date shown in your Patient Portal';
}

export async function memberEmail(userId) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: serviceHeaders()
  });
  if (!response.ok) return '';
  return String((await response.json())?.email || '').trim();
}

export async function recordContractEvent({ membershipId, userId, eventType, details = {}, stripeReference = null }) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/membership_contract_events`, {
    method: 'POST',
    headers: serviceHeaders(stripeReference ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal'),
    body: JSON.stringify({
      membership_id: membershipId,
      user_id: userId,
      event_type: eventType,
      version: MEMBERSHIP_CONTRACT_VERSION,
      details,
      stripe_reference: stripeReference
    })
  });
  if (!response.ok) throw new Error(`Unable to record ${eventType}: ${await response.text()}`);
}

export async function sendMembershipEmail({ to, subject, text, idempotencyKey = '' }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey || !to) return { ok: false, error: 'Membership email is not configured.' };
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware <notifications@lymphaware.com>').trim(),
      to: [to],
      reply_to: ['admin@lymphaware.com'],
      subject,
      text
    })
  });
  return response.ok ? { ok: true } : { ok: false, error: await response.text() };
}

export function renewalNoticeText(membership, heading) {
  const years = Number(membership.membership_term_years || 1);
  const renewalDate = dateUK(membership.next_renewal_at);
  const renewalAmount = money(membership.renewal_price_pence);
  return `${heading}\n\nYour LymphAware digital membership is scheduled to renew on ${renewalDate}.\n\nRenewal payment: ${renewalAmount}\nRenewal period: ${years} year${years === 1 ? '' : 's'}\nMinimum renewal total: ${renewalAmount}\nWhat continues: your digital LymphAware membership and QR profile.\nNot included: new cards, lanyards, holders or postage.\n\nIf you want the membership to renew, you do not need to do anything.\n\nYou can stop this payment at any time before ${renewalDate} by selecting “Cancel automatic renewal” in your Patient Portal:\nhttps://lymphaware.com/portal/\n\nYou can also email admin@lymphaware.com. Cancelling automatic renewal does not shorten the membership term you have already paid for.\n\nAfter a renewal of 12 months or more, you will also have a 14-day renewal cooling-off period and an online cancellation option in your Patient Portal.\n\nThe LymphAware Team`;
}

import {
  FINAL_REMINDER_WINDOW,
  FIRST_REMINDER_WINDOW,
  memberEmail,
  recordContractEvent,
  renewalNoticeText,
  sendMembershipEmail,
  serviceHeaders
} from './_shared/membership-contract.mjs';

function daysUntil(value) {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}

async function dueMemberships() {
  const latest = new Date(Date.now() + (60 * 86400000)).toISOString();
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/memberships?membership_status=eq.ACTIVE&payment_status=eq.PAID&auto_renew_enabled=eq.true&next_renewal_at=not.is.null&next_renewal_at=lte.${encodeURIComponent(latest)}&select=id,user_id,membership_term_years,renewal_price_pence,next_renewal_at,renewal_reminder_first_sent_at,renewal_reminder_final_sent_at`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load memberships due for reminders: ${await response.text()}`);
  return response.json();
}

async function markSent(membership, column, eventType, window, email) {
  const sentAt = new Date().toISOString();
  const update = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders('return=minimal'),
    body: JSON.stringify({ [column]: sentAt, updated_at: sentAt })
  });
  if (!update.ok) throw new Error(`Unable to mark renewal reminder: ${await update.text()}`);
  await recordContractEvent({
    membershipId: membership.id,
    userId: membership.user_id,
    eventType,
    stripeReference: `${membership.id}:${membership.next_renewal_at}:${eventType}`,
    details: { reminder_window: window, sent_to: email, renewal_at: membership.next_renewal_at, renewal_price_pence: membership.renewal_price_pence }
  });
}

async function sendReminder(membership, kind) {
  const email = await memberEmail(membership.user_id);
  if (!email) throw new Error(`No email address for member ${membership.user_id}`);
  const first = kind === 'first';
  const result = await sendMembershipEmail({
    to: email,
    subject: first ? 'Advance notice of your LymphAware membership renewal' : 'Your LymphAware membership renews soon',
    text: renewalNoticeText(membership, first ? 'Advance automatic-renewal reminder' : 'Final automatic-renewal reminder'),
    idempotencyKey: `renewal-${kind}-${membership.id}-${new Date(membership.next_renewal_at).toISOString().slice(0, 10)}`
  });
  if (!result.ok) throw new Error(result.error);
  await markSent(
    membership,
    first ? 'renewal_reminder_first_sent_at' : 'renewal_reminder_final_sent_at',
    first ? 'RENEWAL_REMINDER_FIRST' : 'RENEWAL_REMINDER_FINAL',
    first ? FIRST_REMINDER_WINDOW : FINAL_REMINDER_WINDOW,
    email
  );
}

export default async () => {
  const failures = [];
  let sent = 0;
  for (const membership of await dueMemberships()) {
    const days = daysUntil(membership.next_renewal_at);
    try {
      if (days >= 7 && days <= 14 && !membership.renewal_reminder_final_sent_at) {
        await sendReminder(membership, 'final');
        sent += 1;
      } else if (days > 14 && days <= 60 && !membership.renewal_reminder_first_sent_at) {
        await sendReminder(membership, 'first');
        sent += 1;
      }
    } catch (error) {
      failures.push({ membership: membership.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failures.length) console.error('Membership reminder failures:', failures);
  return new Response(JSON.stringify({ sent, failures: failures.length }), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '0 9 * * *' };

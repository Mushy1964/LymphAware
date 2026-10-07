import {
  FINAL_REMINDER_WINDOW,
  FIRST_REMINDER_WINDOW,
  RENEWAL_HERO_URL,
  MEMBERSHIP_RENEWAL_URL,
  dateUK,
  manualRenewalNoticeHtmlText,
  manualRenewalNoticeText,
  memberEmail,
  money,
  projectedRenewalEnd,
  recordContractEvent,
  renewalNoticeHtmlText,
  renewalNoticeText,
  sendMembershipEmail,
  serviceHeaders
} from './_shared/membership-contract.mjs';
import { getBusinessSettings, publicPricing } from './_shared/business-settings.mjs';

async function reminderTiming() {
  const defaults = { first: 60, final: 14 };
  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/system_settings?setting_key=in.(renewal_first_reminder_days,renewal_final_reminder_days)&select=setting_key,setting_value`,
      { headers: serviceHeaders() }
    );
    if (!response.ok) return defaults;
    const values = Object.fromEntries((await response.json()).map(row => [row.setting_key, Number(row.setting_value)]));
    const first = Number.isInteger(values.renewal_first_reminder_days) ? values.renewal_first_reminder_days : defaults.first;
    const final = Number.isInteger(values.renewal_final_reminder_days) ? values.renewal_final_reminder_days : defaults.final;
    return { first, final };
  } catch {
    return defaults;
  }
}

function daysUntil(value) {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}

function reminderDate(membership) {
  return membership.auto_renew_enabled === true && membership.next_renewal_at
    ? membership.next_renewal_at
    : membership.membership_end;
}

function renewalPrice(membership, livePricing) {
  const packageType = String(membership.package_type || '').toUpperCase();
  const years = Number(membership.membership_term_years || 0);
  const currentConfigured = Number(livePricing?.renewals?.[packageType]?.[years] || 0);
  if (membership.auto_renew_enabled === true) {
    const agreed = Number(membership.renewal_price_pence || 0);
    return agreed > 0 ? agreed : currentConfigured;
  }
  return currentConfigured;
}

async function dueMemberships(maxDays = 60) {
  const now = new Date().toISOString();
  const latest = new Date(Date.now() + (Math.max(14, Number(maxDays) || 60) * 86400000)).toISOString();
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/memberships?membership_status=eq.ACTIVE&payment_status=eq.PAID&membership_end=not.is.null&membership_end=gt.${encodeURIComponent(now)}&membership_end=lte.${encodeURIComponent(latest)}&select=id,user_id,package_type,membership_term_years,renewal_price_pence,membership_end,auto_renew_enabled,next_renewal_at,renewal_reminder_first_sent_at,renewal_reminder_final_sent_at`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load memberships due for reminders: ${await response.text()}`);
  return response.json();
}

async function markSent(membership, column, eventType, window, email, dueAt, pricePence) {
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
    stripeReference: `${membership.id}:${dueAt}:${eventType}`,
    details: {
      reminder_window: window,
      sent_to: email,
      due_at: dueAt,
      renewal_price_pence: pricePence,
      automatic_renewal: membership.auto_renew_enabled === true
    }
  });
}

async function sendReminder(membership, kind, livePricing) {
  const email = await memberEmail(membership.user_id);
  if (!email) throw new Error(`No email address for member ${membership.user_id}`);

  const first = kind === 'first';
  const automatic = membership.auto_renew_enabled === true;
  const dueAt = reminderDate(membership);
  const pricePence = renewalPrice(membership, livePricing);
  const messageMembership = {
    ...membership,
    renewal_price_pence: pricePence,
    next_renewal_at: dueAt
  };

  const years = Number(messageMembership.membership_term_years || 1);
  const projectedEnd = projectedRenewalEnd(messageMembership);
  const subject = automatic
    ? (first ? 'Advance notice of your LymphAware ID membership renewal' : 'Your LymphAware ID membership renews soon')
    : (first ? 'Your LymphAware ID membership is approaching expiry' : 'Your LymphAware ID membership expires soon');
  const heading = automatic
    ? (first ? 'Advance automatic-renewal reminder' : 'Final automatic-renewal reminder')
    : (first ? 'Membership expiry reminder' : 'Final membership expiry reminder');

  const result = await sendMembershipEmail({
    to: email,
    subject,
    text: automatic
      ? renewalNoticeText(messageMembership, heading)
      : manualRenewalNoticeText(messageMembership, heading),
    htmlTitle: automatic
      ? (first ? 'Your membership renews automatically' : 'Your membership renews soon')
      : (first ? 'Your membership is approaching expiry' : 'Your membership expires soon'),
    htmlText: automatic
      ? renewalNoticeHtmlText(messageMembership)
      : manualRenewalNoticeHtmlText(messageMembership),
    preheader: automatic
      ? `Your LymphAware ID membership is due to renew on ${dateUK(dueAt)}.`
      : `Your LymphAware ID membership expires on ${dateUK(dueAt)}. Renew without losing any remaining membership time.`,
    actionUrl: MEMBERSHIP_RENEWAL_URL,
    actionLabel: automatic ? 'Review my membership' : 'Renew now',
    heroImageUrl: RENEWAL_HERO_URL,
    heroImageAlt: 'LymphAware ID card, phone and membership identity',
    heroLinkUrl: MEMBERSHIP_RENEWAL_URL,
    showHeaderLogo: false,
    detailRows: automatic
      ? [
          { label: 'Next renewal date', value: dateUK(dueAt) },
          { label: 'Renewal period', value: `${years} year${years === 1 ? '' : 's'}` },
          { label: 'Renewal amount', value: money(pricePence) },
          { label: 'Expected new expiry date', value: dateUK(projectedEnd) }
        ]
      : [
          { label: 'Membership expires on', value: dateUK(dueAt) },
          { label: 'Renewal period', value: `${years} year${years === 1 ? '' : 's'}` },
          { label: 'Renewal price', value: money(pricePence) },
          { label: 'New expiry if renewed now', value: dateUK(projectedEnd) }
        ],
    idempotencyKey: `renewal-${automatic ? 'auto' : 'manual'}-${kind}-${membership.id}-${new Date(dueAt).toISOString().slice(0, 10)}`
  });
  if (!result.ok) throw new Error(result.error);

  await markSent(
    membership,
    first ? 'renewal_reminder_first_sent_at' : 'renewal_reminder_final_sent_at',
    automatic
      ? (first ? 'RENEWAL_REMINDER_FIRST' : 'RENEWAL_REMINDER_FINAL')
      : (first ? 'EXPIRY_REMINDER_FIRST' : 'EXPIRY_REMINDER_FINAL'),
    first ? FIRST_REMINDER_WINDOW : FINAL_REMINDER_WINDOW,
    email,
    dueAt,
    pricePence
  );
}

export default async () => {
  const failures = [];
  let sent = 0;
  const livePricing = publicPricing(await getBusinessSettings({ strict: true }));
  const timing = await reminderTiming();

  for (const membership of await dueMemberships(timing.first)) {
    const dueAt = reminderDate(membership);
    const days = daysUntil(dueAt);
    try {
      if (days >= Math.max(1, timing.final - 7) && days <= timing.final && !membership.renewal_reminder_final_sent_at) {
        await sendReminder(membership, 'final', livePricing);
        sent += 1;
      } else if (days >= Math.max(timing.final + 1, timing.first - 14) && days <= timing.first && !membership.renewal_reminder_first_sent_at) {
        await sendReminder(membership, 'first', livePricing);
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

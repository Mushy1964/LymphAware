import { RENEWAL_HERO_BASE64 } from './renewal-hero-base64.mjs';
import { brandedEmailHtml } from './email-branding.mjs';
export const MEMBERSHIP_CONTRACT_VERSION = 'DMCCA-READY-2026-09-12';
export const FIRST_REMINDER_WINDOW = '60 to 45 days before renewal';
export const FINAL_REMINDER_WINDOW = '14 to 7 days before renewal';
export const MEMBERSHIP_RENEWAL_URL = 'https://lymphawareid.com/portal/#membership-panel';
export const RENEWAL_HERO_URL = 'https://lymphawareid.com/assets/email/LymphAware_Renewal_Email_Hero_Approved.jpg';

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

function addYearsClamped(value, years) {
  const source = new Date(value);
  if (!Number.isFinite(source.getTime())) return null;
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const result = new Date(source);
  result.setUTCDate(1);
  result.setUTCFullYear(result.getUTCFullYear() + Number(years || 1));
  result.setUTCMonth(month);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), month + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function projectedRenewalEnd(membership) {
  const base = membership?.membership_end || membership?.next_renewal_at;
  return base ? addYearsClamped(base, membership?.membership_term_years || 1)?.toISOString() || '' : '';
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

export async function sendMembershipEmail({
  to,
  subject,
  text,
  htmlTitle = '',
  htmlText = '',
  preheader = '',
  actionUrl = '',
  actionLabel = '',
  heroImageUrl = '',
  heroImageAlt = '',
  heroLinkUrl = '',
  showHeaderLogo = true,
  detailRows = [],
  idempotencyKey = ''
}) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey || !to) return { ok: false, error: 'Membership email is not configured.' };
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const inlineRenewalHero = heroImageUrl === RENEWAL_HERO_URL;
  const renderedHeroUrl = inlineRenewalHero ? 'cid:lymphaware-renewal-hero' : heroImageUrl;
  const payload = {
    from: String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware ID <notifications@lymphawareid.com>').trim(),
    to: [to],
    reply_to: ['admin@lymphawareid.com'],
    subject,
    text,
    html: brandedEmailHtml({
      title: htmlTitle || subject,
      text: htmlText || text,
      preheader,
      actionUrl,
      actionLabel,
      heroImageUrl: renderedHeroUrl,
      heroImageAlt,
      heroLinkUrl,
      showHeaderLogo,
      detailRows
    })
  };
  if (inlineRenewalHero) {
    payload.attachments = [{
      filename: 'LymphAware_Renewal_Email_Hero_Approved.jpg',
      content: RENEWAL_HERO_BASE64,
      content_type: 'image/jpeg',
      content_id: 'lymphaware-renewal-hero'
    }];
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  return response.ok ? { ok: true } : { ok: false, error: await response.text() };
}

export function renewalNoticeText(membership, heading) {
  const years = Number(membership.membership_term_years || 1);
  const renewalDate = dateUK(membership.next_renewal_at);
  const renewalAmount = money(membership.renewal_price_pence);
  const projectedEnd = dateUK(projectedRenewalEnd(membership));
  return `${heading}\n\nYour LymphAware ID membership is scheduled to renew automatically on ${renewalDate}.\n\nRenewal amount: ${renewalAmount}\nRenewal period: ${years} year${years === 1 ? '' : 's'}\nExpected new expiry date: ${projectedEnd}\nWhat continues: your LymphAware ID membership, Patient Portal and QR-linked profile.\nNot included: new physical cards, lanyards, holders or postage.\n\nIf you want your membership to continue, you do not need to do anything.\n\nReview or manage your membership:\n${MEMBERSHIP_RENEWAL_URL}\n\nIf the card you originally used has expired, been replaced or changed, use the “Update payment method” option in your Patient Portal before the renewal date. Your payment details are managed securely by Stripe and are not stored by LymphAware ID.\n\nYou can cancel automatic renewal at any time before ${renewalDate} in your Patient Portal or by emailing admin@lymphawareid.com. Cancelling automatic renewal does not shorten the membership term you have already paid for.\n\nAfter a renewal of 12 months or more, you will also have a 14-day renewal cooling-off period and an online cancellation option in your Patient Portal.\n\nThe LymphAware ID Team`;
}

export function renewalNoticeHtmlText(membership) {
  const renewalDate = dateUK(membership.next_renewal_at);
  return `Your LymphAware ID membership will renew automatically on ${renewalDate}. You do not need to take any action if you want your membership to continue.\n\nYour Patient Portal and QR-linked profile will continue with your renewed membership. New physical cards, lanyards, holders and postage are not included in a membership renewal.\n\nIf your payment card has expired, been replaced or changed, you can update the payment method securely from the Membership section of your Patient Portal before the renewal date.\n\nYou can also review your membership or cancel automatic renewal in the Patient Portal before the renewal date.`;
}

export function manualRenewalNoticeText(membership, heading) {
  const years = Number(membership.membership_term_years || 1);
  const expiryDate = dateUK(membership.membership_end);
  const renewalAmount = money(membership.renewal_price_pence);
  const projectedEnd = dateUK(projectedRenewalEnd(membership));
  return `${heading}\n\nYour LymphAware ID membership is due to expire on ${expiryDate}.\n\nMembership expires on: ${expiryDate}\nRenewal period: ${years} year${years === 1 ? '' : 's'}\nRenewal price: ${renewalAmount}\nIf you renew now, your new expiry date will be: ${projectedEnd}\nWhat continues: your LymphAware ID membership, Patient Portal and QR-linked profile.\nNot included: new physical cards, lanyards, holders or postage.\n\nRenew now:\n${MEMBERSHIP_RENEWAL_URL}\n\nRenewing early will not shorten your current membership. Your new term starts from your existing expiry date, so you do not lose any remaining membership time.\n\nIf you do not renew, your QR-linked profile will no longer be available after ${expiryDate}. You can renew later to restore membership access.\n\nThe LymphAware ID Team`;
}

export function manualRenewalNoticeHtmlText(membership) {
  const expiryDate = dateUK(membership.membership_end);
  return `Your LymphAware ID membership is approaching its expiry date. Renewing keeps your Patient Portal and QR-linked profile available without interruption.\n\nRenewing before ${expiryDate} will not cause you to lose any remaining membership time. Your renewed term starts from your current expiry date.\n\nThank you for being part of LymphAware ID.`;
}

export function membershipExpiredNoticeText(membership) {
  const expiryDate = dateUK(membership.membership_end);
  return `Your LymphAware ID membership expired on ${expiryDate}.\n\nYour QR-linked profile is no longer available while your membership is inactive. Your account and saved profile information have not been deleted.\n\nYou can renew your membership from your Patient Portal:\nhttps://lymphawareid.com/portal/\n\nIf you renew, your membership access will be restored using your existing LymphAware ID and profile.\n\nIf you need help, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team`;
}

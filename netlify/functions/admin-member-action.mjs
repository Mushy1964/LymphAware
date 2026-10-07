import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { recordAdminActivity } from './_shared/admin-audit.mjs';
import { getBusinessSettings, publicPricing } from './_shared/business-settings.mjs';
import {
  dateUK,
  manualRenewalNoticeHtmlText,
  manualRenewalNoticeText,
  memberEmail,
  membershipExpiredNoticeText,
  MEMBERSHIP_RENEWAL_URL,
  money,
  projectedRenewalEnd,
  recordContractEvent,
  RENEWAL_HERO_URL,
  renewalNoticeHtmlText,
  renewalNoticeText,
  sendMembershipEmail,
  serviceHeaders
} from './_shared/membership-contract.mjs';
import { sendProfileReviewEmail } from './_shared/profile-review.mjs';

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function loadMembership(userId) {
  const response = await fetch(
    env('SUPABASE_URL') + '/rest/v1/memberships?user_id=eq.' + encodeURIComponent(userId) +
    '&select=id,user_id,package_type,membership_status,payment_status,membership_start,membership_end,membership_term_years,auto_renew_enabled,next_renewal_at,renewal_price_pence,pending_renewal_price_pence,stripe_subscription_id,stripe_subscription_status&limit=1',
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('Unable to load the member membership.');
  return (await response.json())?.[0] || null;
}

async function loadProfile(userId) {
  const response = await fetch(
    env('SUPABASE_URL') + '/rest/v1/profiles?user_id=eq.' + encodeURIComponent(userId) +
    '&select=id,display_name,lymphaware_id,profile_next_review_due_at&limit=1',
    { headers: serviceHeaders() }
  );
  if (!response.ok) return null;
  return (await response.json())?.[0] || null;
}

async function patchMembership(id, values) {
  const response = await fetch(
    env('SUPABASE_URL') + '/rest/v1/memberships?id=eq.' + encodeURIComponent(id),
    {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
    }
  );
  if (!response.ok) throw new Error('Unable to update the membership record.');
}

async function stripeCancelAtPeriodEnd(subscriptionId) {
  const response = await fetch(
    'https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(subscriptionId),
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2026-07-29.dahlia'
      },
      body: new URLSearchParams({ cancel_at_period_end: 'true' }).toString()
    }
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || 'Stripe could not cancel automatic renewal.');
  return result;
}

function renewalRows(membership) {
  const years = Number(membership.membership_term_years || 1);
  const due = membership.auto_renew_enabled ? membership.next_renewal_at : membership.membership_end;
  const projected = projectedRenewalEnd(membership);
  return membership.auto_renew_enabled
    ? [
        { label: 'Next renewal date', value: dateUK(due) },
        { label: 'Renewal period', value: years + ' year' + (years === 1 ? '' : 's') },
        { label: 'Renewal amount', value: money(membership.renewal_price_pence) },
        { label: 'Expected new expiry date', value: dateUK(projected) }
      ]
    : [
        { label: 'Membership expires on', value: dateUK(due) },
        { label: 'Renewal period', value: years + ' year' + (years === 1 ? '' : 's') },
        { label: 'Renewal price', value: money(membership.renewal_price_pence) },
        { label: 'New expiry if renewed now', value: dateUK(projected) }
      ];
}

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = await verifyAdminRequest(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    const body = await request.json().catch(() => ({}));
    const userId = String(body.userId || '').trim();
    const action = String(body.action || '').trim().toUpperCase();
    if (!userId || !action) return json({ error: 'Member and action are required.' }, 400);

    const [membership, profile, email] = await Promise.all([
      loadMembership(userId),
      loadProfile(userId),
      memberEmail(userId)
    ]);
    if (!membership || !email) return json({ error: 'Member record could not be found.' }, 404);

    if (action === 'RESEND_RENEWAL') {
      const years = Number(membership.membership_term_years || 1);
      const currentPricing = publicPricing(await getBusinessSettings({ strict: true }));
      const pkg = String(membership.package_type || '').toUpperCase();
      const manualPrice = Number(currentPricing.renewals?.[pkg]?.[years] || 0);
      const messageMembership = {
        ...membership,
        renewal_price_pence: membership.auto_renew_enabled
          ? Number(membership.renewal_price_pence || 0)
          : manualPrice
      };
      if (!messageMembership.renewal_price_pence) return json({ error: 'A valid renewal price is not available.' }, 400);

      const automatic = membership.auto_renew_enabled === true;
      const expiry = new Date(membership.membership_end || 0);
      const expired = !automatic && Number.isFinite(expiry.getTime()) && expiry.getTime() <= Date.now();
      const heading = automatic ? 'Automatic-renewal reminder' : 'Membership expiry reminder';
      const result = await sendMembershipEmail({
        to: email,
        subject: automatic ? 'Your LymphAware ID membership renewal reminder' : expired ? 'Your LymphAware ID membership has expired' : 'Your LymphAware ID membership expiry reminder',
        htmlTitle: automatic ? 'Your membership renews automatically' : expired ? 'Your membership has expired' : 'Your membership is approaching expiry',
        text: automatic ? renewalNoticeText(messageMembership, heading) : expired ? membershipExpiredNoticeText(messageMembership) : manualRenewalNoticeText(messageMembership, heading),
        htmlText: automatic ? renewalNoticeHtmlText(messageMembership) : expired ? membershipExpiredNoticeText(messageMembership) : manualRenewalNoticeHtmlText(messageMembership),
        actionUrl: MEMBERSHIP_RENEWAL_URL,
        actionLabel: automatic ? 'Review my membership' : 'Renew now',
        heroImageUrl: RENEWAL_HERO_URL,
        heroImageAlt: 'LymphAware ID renewal',
        heroLinkUrl: MEMBERSHIP_RENEWAL_URL,
        showHeaderLogo: false,
        detailRows: expired ? [] : renewalRows(messageMembership),
        idempotencyKey: 'admin-renewal-' + membership.id + '-' + Date.now()
      });
      if (!result.ok) throw new Error(result.error || 'Renewal email could not be sent.');

      await recordAdminActivity({
        admin,
        actionType: 'MEMBER_RENEWAL_EMAIL_SENT',
        entityType: 'MEMBER',
        entityId: userId,
        summary: 'Renewal reminder manually sent to ' + (profile?.display_name || email) + '.',
        details: { email, automatic, expired }
      });
      return json({ ok: true, message: 'Renewal reminder sent to ' + email + '.' });
    }

    if (action === 'SEND_PROFILE_REVIEW') {
      const end = new Date(membership.membership_end || 0);
      const current = ['ACTIVE', 'PILOT', 'SPONSORED'].includes(String(membership.membership_status || '').toUpperCase()) &&
        (!membership.membership_end || (Number.isFinite(end.getTime()) && end.getTime() > Date.now()));
      if (!current) return json({ error: 'Profile Health Check reminders are only appropriate for current memberships.' }, 400);
      const dueAt = profile?.profile_next_review_due_at || new Date().toISOString();
      const result = await sendProfileReviewEmail({
        to: email,
        kind: 'first',
        dueAt,
        idempotencyKey: 'admin-profile-review-' + userId + '-' + Date.now()
      });
      if (!result.ok) throw new Error(result.error || 'Profile Health Check reminder could not be sent.');

      await recordAdminActivity({
        admin,
        actionType: 'MEMBER_PROFILE_REVIEW_EMAIL_SENT',
        entityType: 'MEMBER',
        entityId: userId,
        summary: 'Profile Health Check reminder manually sent to ' + (profile?.display_name || email) + '.',
        details: { email, due_at: dueAt }
      });
      return json({ ok: true, message: 'Profile Health Check reminder sent to ' + email + '.' });
    }

    if (action === 'SEND_PORTAL_LINK') {
      const result = await sendMembershipEmail({
        to: email,
        subject: 'Your LymphAware ID Patient Portal',
        htmlTitle: 'Your LymphAware ID Patient Portal',
        text: 'You can sign in to your LymphAware ID Patient Portal to review your membership, profile and orders.\n\nhttps://lymphawareid.com/sign-in/?returnTo=%2Fportal%2F\n\nFor security, this email does not contain your password or a password-reset link.\n\nThe LymphAware ID Team',
        actionUrl: 'https://lymphawareid.com/sign-in/?returnTo=%2Fportal%2F',
        actionLabel: 'Open Patient Portal',
        idempotencyKey: 'admin-portal-link-' + userId + '-' + Date.now()
      });
      if (!result.ok) throw new Error(result.error || 'Portal email could not be sent.');

      await recordAdminActivity({
        admin,
        actionType: 'MEMBER_PORTAL_LINK_SENT',
        entityType: 'MEMBER',
        entityId: userId,
        summary: 'Patient Portal sign-in link sent to ' + (profile?.display_name || email) + '.',
        details: { email }
      });
      return json({ ok: true, message: 'Patient Portal link sent to ' + email + '.' });
    }

    if (action === 'CANCEL_AUTO_RENEW') {
      if (!membership.auto_renew_enabled || !membership.stripe_subscription_id) {
        return json({ error: 'Automatic renewal is not currently active for this member.' }, 400);
      }
      if (String(body.confirmation || '') !== 'CANCEL_AUTO_RENEW') {
        return json({ error: 'Confirmation is required before cancelling automatic renewal.' }, 400);
      }

      const subscription = await stripeCancelAtPeriodEnd(membership.stripe_subscription_id);
      await patchMembership(membership.id, {
        auto_renew_enabled: false,
        auto_renew_cancelled_at: new Date().toISOString(),
        stripe_subscription_status: subscription.status || membership.stripe_subscription_status || 'active',
        pending_renewal_price_pence: null,
        pending_renewal_price_effective_after: null,
        pending_renewal_price_notice_sent_at: null
      });
      await recordContractEvent({
        membershipId: membership.id,
        userId,
        eventType: 'AUTO_RENEW_CANCELLED',
        stripeReference: membership.stripe_subscription_id,
        details: {
          effective_at_period_end: true,
          membership_end: membership.membership_end,
          initiated_by_admin: true,
          admin_email: admin.email
        }
      });
      const confirmation = await sendMembershipEmail({
        to: email,
        subject: 'Your LymphAware ID automatic renewal is cancelled',
        text: 'Automatic renewal has been cancelled at your request. No further automatic-renewal payment will be taken for this membership.\n\nYour current LymphAware ID membership remains active until ' + dateUK(membership.membership_end) + '.\n\nYou can review its status in your Patient Portal:\nhttps://lymphawareid.com/portal/\n\nIf you did not request this change, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team',
        actionUrl: 'https://lymphawareid.com/portal/#membership-panel',
        actionLabel: 'Review my membership',
        idempotencyKey: 'admin-renewal-cancelled-' + membership.stripe_subscription_id
      });
      if (!confirmation.ok) console.error('Unable to send admin cancellation confirmation:', confirmation.error);

      await recordAdminActivity({
        admin,
        actionType: 'MEMBER_AUTO_RENEW_CANCELLED',
        entityType: 'MEMBER',
        entityId: userId,
        summary: 'Automatic renewal cancelled for ' + (profile?.display_name || email) + '.',
        details: { email, membership_end: membership.membership_end }
      });
      return json({ ok: true, message: 'Automatic renewal cancelled. Current membership remains active until ' + dateUK(membership.membership_end) + '.' });
    }

    return json({ error: 'That member action is not supported.' }, 400);
  } catch (error) {
    console.error('Admin member action error:', error);
    return json({ error: error instanceof Error ? error.message : 'Member action could not be completed.' }, 500);
  }
};

export const config = { path: '/api/admin-member-action' };

import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { getBusinessSettings, publicPricing } from './_shared/business-settings.mjs';
import { PACKAGE_DEFINITIONS } from './_shared/initial-membership-checkout.mjs';
import {
  MEMBERSHIP_RENEWAL_URL,
  dateUK,
  memberEmail,
  money,
  recordContractEvent,
  sendMembershipEmail,
  serviceHeaders
} from './_shared/membership-contract.mjs';

const NOTICE_DAYS = 60;

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function stripeRequest(path, method = 'GET', values = null, idempotencyKey = '') {
  const headers = {
    Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`,
    'Stripe-Version': '2026-07-29.dahlia'
  };
  if (values) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
    body: values ? new URLSearchParams(values).toString() : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || 'Stripe price update failed.');
  return result;
}

async function activeAutomaticMemberships() {
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/memberships?membership_status=eq.ACTIVE&payment_status=eq.PAID&auto_renew_enabled=eq.true&stripe_subscription_item_id=not.is.null&select=id,user_id,package_type,membership_term_years,renewal_price_pence,next_renewal_at,stripe_subscription_id,stripe_subscription_item_id,pending_renewal_price_pence,pending_renewal_price_effective_after,pending_renewal_price_notice_sent_at`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load automatic-renew memberships: ${await response.text()}`);
  return response.json();
}

function targetPrice(pricing, membership) {
  const packageType = String(membership.package_type || '').toUpperCase();
  const years = Number(membership.membership_term_years || 0);
  return Number(pricing.renewals?.[packageType]?.[years] || 0);
}

function eligibleNoticeWindow(membership) {
  const next = new Date(membership.next_renewal_at || 0);
  if (!Number.isFinite(next.getTime())) return false;
  return next.getTime() - Date.now() >= NOTICE_DAYS * 86400000;
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

async function patchMembership(membershipId, values) {
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/memberships?id=eq.${encodeURIComponent(membershipId)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
    }
  );
  if (!response.ok) throw new Error(`Membership price update failed: ${await response.text()}`);
}

async function createRecurringPrice(membership, amountPence) {
  const packageType = String(membership.package_type || '').toUpperCase();
  const years = Number(membership.membership_term_years || 0);
  const productId = PACKAGE_DEFINITIONS[packageType]?.renewalProductId;
  if (!productId || ![1, 2, 3].includes(years) || amountPence <= 0) {
    throw new Error('The renewal product, term or price is invalid.');
  }

  return stripeRequest('prices', 'POST', {
    currency: 'gbp',
    unit_amount: String(amountPence),
    product: productId,
    'recurring[interval]': 'year',
    'recurring[interval_count]': String(years),
    nickname: `${packageType} ${years}-year renewal – ${new Date().toISOString().slice(0, 10)}`,
    'metadata[lymphaware_package]': packageType,
    'metadata[membership_term_years]': String(years),
    'metadata[purpose]': 'membership_renewal',
    'metadata[managed_by]': 'lymphaware_admin_business_settings'
  }, `renewal-price-${packageType}-${years}-${amountPence}`);
}

async function notifyPriceChange(membership, oldPrice, newPrice) {
  const email = await memberEmail(membership.user_id);
  if (!email) return { ok: false, error: 'No member email address is available.' };

  const years = Number(membership.membership_term_years || 1);
  return sendMembershipEmail({
    to: email,
    subject: 'Important: your future LymphAware ID renewal price is changing',
    htmlTitle: 'Your future renewal price is changing',
    preheader: `Your next LymphAware ID renewal price will be ${money(newPrice)}.`,
    actionUrl: MEMBERSHIP_RENEWAL_URL,
    actionLabel: 'Review my membership',
    text:
      `We are writing to let you know about a change to the price of your future LymphAware ID automatic renewal.\n\n` +
      `Your next renewal date: ${dateUK(membership.next_renewal_at)}\n` +
      `Renewal period: ${years} year${years === 1 ? '' : 's'}\n` +
      `Current renewal price: ${money(oldPrice)}\n` +
      `New renewal price: ${money(newPrice)}\n\n` +
      `No payment is being taken now. The new price will apply at your next automatic renewal.\n\n` +
      `You remain in control and can cancel automatic renewal before the renewal date in your Patient Portal. Cancelling automatic renewal does not shorten the membership term you have already paid for.\n\n` +
      `Review your membership:\n${MEMBERSHIP_RENEWAL_URL}\n\nThe LymphAware ID Team`,
    detailRows: [
      { label: 'Next renewal date', value: dateUK(membership.next_renewal_at) },
      { label: 'Renewal period', value: `${years} year${years === 1 ? '' : 's'}` },
      { label: 'Current renewal price', value: money(oldPrice) },
      { label: 'New renewal price', value: money(newPrice) }
    ],
    idempotencyKey: `renewal-price-change-${membership.id}-${newPrice}-${new Date(membership.next_renewal_at).toISOString().slice(0, 10)}`
  });
}

async function notifyDeferredPriceChange(membership, oldPrice, newPrice) {
  const email = await memberEmail(membership.user_id);
  if (!email) return { ok: false, error: 'No member email address is available.' };

  const years = Number(membership.membership_term_years || 1);
  const followingRenewal = addYearsClamped(membership.next_renewal_at, years);
  return sendMembershipEmail({
    to: email,
    subject: 'Advance notice of a future LymphAware ID renewal price change',
    htmlTitle: 'A future renewal price is changing',
    preheader: `Your imminent renewal stays at ${money(oldPrice)}; the new price will apply at the following renewal.`,
    actionUrl: MEMBERSHIP_RENEWAL_URL,
    actionLabel: 'Review my membership',
    text:
      `We are writing to give you advance notice of a future change to your LymphAware ID automatic-renewal price.\n\n` +
      `Your forthcoming renewal on ${dateUK(membership.next_renewal_at)} is too close to the price-change notice date, so it will remain at your current agreed price of ${money(oldPrice)}.\n\n` +
      `After that renewal succeeds, your automatic-renewal agreement will move to the new price of ${money(newPrice)} for the following renewal${followingRenewal ? `, expected on ${dateUK(followingRenewal)}` : ''}. No additional payment is being taken now.\n\n` +
      `You remain in control and can cancel automatic renewal at any time before a renewal date from your Patient Portal. Cancelling automatic renewal does not shorten the membership term you have already paid for.\n\n` +
      `Review your membership:\n${MEMBERSHIP_RENEWAL_URL}\n\nThe LymphAware ID Team`,
    detailRows: [
      { label: 'Forthcoming renewal date', value: dateUK(membership.next_renewal_at) },
      { label: 'Forthcoming renewal price', value: money(oldPrice) },
      { label: 'Following renewal', value: followingRenewal ? dateUK(followingRenewal) : 'After the forthcoming renewal' },
      { label: 'Future renewal price', value: money(newPrice) }
    ],
    idempotencyKey: `deferred-renewal-price-change-${membership.id}-${newPrice}-${new Date(membership.next_renewal_at).toISOString().slice(0, 10)}`
  });
}

async function notifyDeferredPriceWithdrawal(membership, pendingPrice) {
  const email = await memberEmail(membership.user_id);
  if (!email) return { ok: false, error: 'No member email address is available.' };

  return sendMembershipEmail({
    to: email,
    subject: 'Update: planned LymphAware ID renewal price change withdrawn',
    htmlTitle: 'Your planned future price change has been withdrawn',
    preheader: 'Your automatic-renewal price will remain at its current amount.',
    actionUrl: MEMBERSHIP_RENEWAL_URL,
    actionLabel: 'Review my membership',
    text:
      `We previously wrote to you about a planned future change to your LymphAware ID automatic-renewal price. That planned change has now been withdrawn.\n\n` +
      `Your current automatic-renewal price remains ${money(membership.renewal_price_pence)}. The previously advised future price of ${money(pendingPrice)} will not be applied.\n\n` +
      `No payment has been taken as a result of this update.\n\nReview your membership:\n${MEMBERSHIP_RENEWAL_URL}\n\nThe LymphAware ID Team`,
    idempotencyKey: `deferred-renewal-price-withdrawn-${membership.id}-${pendingPrice}-${new Date().toISOString().slice(0, 10)}`
  });
}

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = await verifyAdminRequest(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    const pricing = publicPricing(await getBusinessSettings({ strict: true }));
    const memberships = await activeAutomaticMemberships();

    let updated = 0;
    let unchanged = 0;
    let deferred = 0;
    let withdrawn = 0;
    const failures = [];

    for (const membership of memberships) {
      const nextPrice = targetPrice(pricing, membership);
      const oldPrice = Number(membership.renewal_price_pence || 0);
      const pendingPrice = Number(membership.pending_renewal_price_pence || 0);

      if (!nextPrice) {
        failures.push({ membership: membership.id, error: 'No valid configured renewal price was found.' });
        continue;
      }

      if (nextPrice === oldPrice) {
        if (!pendingPrice) {
          unchanged += 1;
          continue;
        }

        const previousPending = {
          pending_renewal_price_pence: membership.pending_renewal_price_pence,
          pending_renewal_price_effective_after: membership.pending_renewal_price_effective_after,
          pending_renewal_price_notice_sent_at: membership.pending_renewal_price_notice_sent_at
        };
        try {
          await patchMembership(membership.id, {
            pending_renewal_price_pence: null,
            pending_renewal_price_effective_after: null,
            pending_renewal_price_notice_sent_at: null
          });
          const notice = await notifyDeferredPriceWithdrawal(membership, pendingPrice);
          if (!notice.ok) {
            await patchMembership(membership.id, previousPending);
            throw new Error(`The planned price change was restored because the withdrawal email could not be sent: ${notice.error}`);
          }
          try {
            await recordContractEvent({
              membershipId: membership.id,
              userId: membership.user_id,
              eventType: 'AUTO_RENEW_DEFERRED_PRICE_WITHDRAWN',
              details: {
                current_price_pence: oldPrice,
                withdrawn_price_pence: pendingPrice,
                notice_sent: true
              }
            });
          } catch (auditError) {
            console.error('Unable to record deferred price withdrawal audit event:', auditError);
          }
          withdrawn += 1;
        } catch (error) {
          failures.push({ membership: membership.id, error: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }

      if (!eligibleNoticeWindow(membership)) {
        if (
          pendingPrice === nextPrice &&
          membership.pending_renewal_price_effective_after === membership.next_renewal_at &&
          membership.pending_renewal_price_notice_sent_at
        ) {
          deferred += 1;
          continue;
        }

        const previousPending = {
          pending_renewal_price_pence: membership.pending_renewal_price_pence,
          pending_renewal_price_effective_after: membership.pending_renewal_price_effective_after,
          pending_renewal_price_notice_sent_at: membership.pending_renewal_price_notice_sent_at
        };
        const noticeSentAt = new Date().toISOString();

        try {
          await patchMembership(membership.id, {
            pending_renewal_price_pence: nextPrice,
            pending_renewal_price_effective_after: membership.next_renewal_at,
            pending_renewal_price_notice_sent_at: noticeSentAt
          });

          const notice = await notifyDeferredPriceChange(membership, oldPrice, nextPrice);
          if (!notice.ok) {
            await patchMembership(membership.id, previousPending);
            throw new Error(`The deferred price change was rolled back because the member notice could not be sent: ${notice.error}`);
          }

          try {
            await recordContractEvent({
              membershipId: membership.id,
              userId: membership.user_id,
              eventType: 'AUTO_RENEW_PRICE_CHANGE_DEFERRED',
              details: {
                current_price_pence: oldPrice,
                future_price_pence: nextPrice,
                protected_renewal_at: membership.next_renewal_at,
                applies_after_successful_renewal: true,
                notice_days_required: NOTICE_DAYS,
                notice_sent: true
              }
            });
          } catch (auditError) {
            console.error('Unable to record deferred renewal price audit event:', auditError);
          }

          deferred += 1;
        } catch (error) {
          failures.push({ membership: membership.id, error: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }

      let previousStripePrice = '';
      let newStripePrice = '';
      const previousPending = {
        pending_renewal_price_pence: membership.pending_renewal_price_pence,
        pending_renewal_price_effective_after: membership.pending_renewal_price_effective_after,
        pending_renewal_price_notice_sent_at: membership.pending_renewal_price_notice_sent_at
      };

      try {
        const item = await stripeRequest(`subscription_items/${encodeURIComponent(membership.stripe_subscription_item_id)}`);
        previousStripePrice = typeof item.price === 'string' ? item.price : item.price?.id || '';
        if (!previousStripePrice) throw new Error('The current Stripe renewal price could not be identified.');

        const price = await createRecurringPrice(membership, nextPrice);
        newStripePrice = price.id;

        await stripeRequest(
          `subscription_items/${encodeURIComponent(membership.stripe_subscription_item_id)}`,
          'POST',
          { price: newStripePrice, proration_behavior: 'none' },
          `renewal-item-price-${membership.id}-${nextPrice}`
        );

        try {
          await patchMembership(membership.id, {
            renewal_price_pence: nextPrice,
            pending_renewal_price_pence: null,
            pending_renewal_price_effective_after: null,
            pending_renewal_price_notice_sent_at: null
          });
        } catch (databaseError) {
          try {
            await stripeRequest(
              `subscription_items/${encodeURIComponent(membership.stripe_subscription_item_id)}`,
              'POST',
              { price: previousStripePrice, proration_behavior: 'none' },
              `renewal-item-db-rollback-${membership.id}-${oldPrice}`
            );
            await stripeRequest(
              `prices/${encodeURIComponent(newStripePrice)}`,
              'POST',
              { active: 'false' },
              `renewal-price-db-deactivate-${newStripePrice}`
            );
          } catch (rollbackError) {
            console.error('Unable to roll back Stripe after the membership price update failed:', rollbackError);
          }
          throw databaseError;
        }

        const notice = await notifyPriceChange(membership, oldPrice, nextPrice);
        if (!notice.ok) {
          try {
            await stripeRequest(
              `subscription_items/${encodeURIComponent(membership.stripe_subscription_item_id)}`,
              'POST',
              { price: previousStripePrice, proration_behavior: 'none' },
              `renewal-item-notice-rollback-${membership.id}-${oldPrice}`
            );
            await patchMembership(membership.id, {
              renewal_price_pence: oldPrice,
              ...previousPending
            });
            await stripeRequest(
              `prices/${encodeURIComponent(newStripePrice)}`,
              'POST',
              { active: 'false' },
              `renewal-price-notice-deactivate-${newStripePrice}`
            );
          } catch (rollbackError) {
            console.error('Unable to roll back unnotified renewal price change:', rollbackError);
          }
          throw new Error(`Member notification failed, so the price change was rolled back: ${notice.error}`);
        }

        try {
          await recordContractEvent({
            membershipId: membership.id,
            userId: membership.user_id,
            eventType: 'AUTO_RENEW_PRICE_CHANGED',
            stripeReference: newStripePrice,
            details: {
              old_price_pence: oldPrice,
              new_price_pence: nextPrice,
              next_renewal_at: membership.next_renewal_at,
              notice_days_required: NOTICE_DAYS,
              notice_sent: true
            }
          });
        } catch (auditError) {
          console.error('Unable to record automatic-renew price-change audit event:', auditError);
        }
        updated += 1;
      } catch (error) {
        failures.push({
          membership: membership.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (failures.length) console.error('Automatic-renew price sync failures:', failures);
    return json({
      updated,
      unchanged,
      deferred,
      withdrawn,
      failed: failures.length
    });
  } catch (error) {
    console.error('Admin automatic-renew price sync error:', error);
    return json({ error: error instanceof Error ? error.message : 'Automatic-renewal prices could not be applied.' }, 500);
  }
};

export const config = { path: '/api/admin-sync-renewal-prices' };

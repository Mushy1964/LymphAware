import crypto from 'node:crypto';
import { brandedEmailHtml } from './_shared/email-branding.mjs';
import { getBusinessSettings, publicPricing } from './_shared/business-settings.mjs';
import { PACKAGE_DEFINITIONS } from './_shared/initial-membership-checkout.mjs';
import { getControlSettings, communicationControls } from './_shared/system-controls.mjs';
import { buildInitialMembershipWelcome } from './_shared/customer-communication-content.mjs';
import {
  MEMBERSHIP_CONTRACT_VERSION,
  dateUK,
  memberEmail,
  money,
  recordContractEvent,
  renewalNoticeText,
  sendMembershipEmail
} from './_shared/membership-contract.mjs';

const INITIAL_PACKAGE_PRICES = {
  STANDARD: { 1: 2499, 2: 3499, 3: 4499 },
  PLUS: { 1: 3499, 2: 4499, 3: 5499 },
  MULTILINGUAL: { 1: 5499, 2: 6999, 3: 8499 }
};

const ADDITIONAL_CARD_PRICE_PENCE = 699;
const LANYARD_HOLDER_PRICE_PENCE = 799;
const ADDITIONAL_LANGUAGE_PRICE_PENCE = 2499;
const TRIAL_RENEWAL_PROTECTION_COUPON = 'LYMPHAWARE_TRIAL_RENEWAL_FREE_V1';

function verifyStripeSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(',');
  let timestamp = '';
  const signatures = [];
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const expectedSignature = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  return signatures.some((signature) => {
    try {
      const receivedBuffer = Buffer.from(signature, 'hex');
      return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  });
}

function supabaseHeaders(prefer = '') {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function stripeRequest(path, method = 'GET', values = null, idempotencyKey = '') {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': '2026-07-29.dahlia',
      ...(values ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: values ? new URLSearchParams(values).toString() : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || 'Stripe request failed');
  return result;
}

async function liveRenewalPrice(packageType, years) {
  const pricing = publicPricing(await getBusinessSettings({ strict: true }));
  return Number(pricing.renewals?.[packageType]?.[years] || 0);
}

async function createRenewalStripePrice(packageType, years, amountPence) {
  const productId = PACKAGE_DEFINITIONS[packageType]?.renewalProductId;
  if (!productId || ![1, 2, 3].includes(Number(years)) || Number(amountPence) <= 0) {
    throw new Error('Unable to create the required Stripe renewal price.');
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
    'metadata[managed_by]': 'lymphaware_system'
  }, `renewal-price-${packageType}-${years}-${amountPence}`);
}

async function applyDeferredRenewalPriceAfterPaidCycle(membership, nextRenewalAt) {
  const pendingPrice = Number(membership?.pending_renewal_price_pence || 0);
  if (!pendingPrice) return null;

  const protectedRenewal = new Date(membership?.pending_renewal_price_effective_after || 0);
  const recordedRenewal = new Date(membership?.next_renewal_at || 0);
  if (
    Number.isFinite(protectedRenewal.getTime()) &&
    Number.isFinite(recordedRenewal.getTime()) &&
    Math.abs(protectedRenewal.getTime() - recordedRenewal.getTime()) > 36 * 3600000
  ) {
    return null;
  }

  const packageType = String(membership.package_type || '').toUpperCase();
  const years = Number(membership.membership_term_years || 0);
  if (!membership.stripe_subscription_item_id || !PACKAGE_DEFINITIONS[packageType] || ![1, 2, 3].includes(years)) {
    throw new Error('Deferred renewal price could not be activated because the membership renewal configuration is incomplete.');
  }

  const price = await createRenewalStripePrice(packageType, years, pendingPrice);
  await stripeRequest(
    `subscription_items/${encodeURIComponent(membership.stripe_subscription_item_id)}`,
    'POST',
    { price: price.id, proration_behavior: 'none' },
    `activate-deferred-renewal-price-${membership.id}-${pendingPrice}`
  );

  await patchMembershipBySubscription(membership.stripe_subscription_id, {
    renewal_price_pence: pendingPrice,
    pending_renewal_price_pence: null,
    pending_renewal_price_effective_after: null,
    pending_renewal_price_notice_sent_at: null
  });

  try {
    await recordContractEvent({
      membershipId: membership.id,
      userId: membership.user_id,
      eventType: 'AUTO_RENEW_DEFERRED_PRICE_ACTIVATED',
      stripeReference: price.id,
      details: {
        old_price_pence: Number(membership.renewal_price_pence || 0),
        new_price_pence: pendingPrice,
        next_renewal_at: nextRenewalAt || null,
        prior_notice_sent_at: membership.pending_renewal_price_notice_sent_at || null
      }
    });
  } catch (auditError) {
    console.error('Unable to record deferred renewal price activation event:', auditError);
  }

  return {
    newPricePence: pendingPrice,
    nextRenewalAt: nextRenewalAt || null
  };
}

async function patchMembershipBySubscription(subscriptionId, values) {
  if (!subscriptionId) return;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Membership renewal update failed: ${await response.text()}`);
}

async function membershipBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/memberships?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load renewed membership: ${await response.text()}`);
  return (await response.json())?.[0] || null;
}

async function membershipForManualRenewal(membershipId, userId) {
  if (!membershipId || !userId) return null;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membershipId)}&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load membership for manual renewal: ${await response.text()}`);
  return (await response.json())?.[0] || null;
}

function addYearsClamped(value, years) {
  const source = new Date(value);
  if (!Number.isFinite(source.getTime())) return null;
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const result = new Date(source);
  result.setUTCDate(1);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  result.setUTCMonth(month);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), month + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function invoiceSubscriptionId(invoice) {
  const value = invoice?.subscription || invoice?.parent?.subscription_details?.subscription;
  return typeof value === 'string' ? value : value?.id || null;
}

async function handleRecurringEvent(event) {
  const object = event.data?.object || {};
  if (event.type === 'invoice.upcoming') {
    const upcomingSubscriptionId = invoiceSubscriptionId(object);
    const membership = await membershipBySubscription(upcomingSubscriptionId);
    if (membership) {
      if (membership.membership_status === 'PILOT') return true;
      const email = String(object?.customer_email || '').trim() || await memberEmail(membership.user_id);
      const result = await sendMembershipEmail({
        to: email,
        subject: 'Your LymphAware ID automatic-renewal payment is approaching',
        text: renewalNoticeText(membership, 'Additional automatic-renewal payment reminder'),
        idempotencyKey: `stripe-upcoming-${upcomingSubscriptionId}-${new Date(membership.next_renewal_at).toISOString().slice(0, 10)}`
      });
      if (!result.ok) console.error('Unable to send Stripe upcoming reminder:', result.error);
    }
    return true;
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const active = event.type !== 'customer.subscription.deleted' && !object.cancel_at_period_end && !['canceled', 'unpaid', 'incomplete_expired'].includes(object.status);
    await patchMembershipBySubscription(object.id, {
      auto_renew_enabled: active,
      stripe_subscription_status: object.status || (active ? 'active' : 'canceled'),
      next_renewal_at: object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null,
      ...(!active ? {
        pending_renewal_price_pence: null,
        pending_renewal_price_effective_after: null,
        pending_renewal_price_notice_sent_at: null
      } : {})
    });
    return true;
  }
  if (event.type === 'invoice.payment_failed') {
    const subscriptionId = invoiceSubscriptionId(object);
    await patchMembershipBySubscription(subscriptionId, { stripe_subscription_status: 'past_due' });
    const membership = await membershipBySubscription(subscriptionId);
    if (membership && membership.membership_status !== 'PILOT') {
      const email = String(object?.customer_email || '').trim() || await memberEmail(membership.user_id);
      const actionUrl = String(object?.hosted_invoice_url || '').trim() || 'https://lymphawareid.com/portal/#membership-panel';
      const amountDue = money(object.amount_due || membership.renewal_price_pence);
      const result = await sendMembershipEmail({
        to: email,
        subject: 'Action needed: your LymphAware ID renewal payment was not completed',
        htmlTitle: 'Your renewal payment needs attention',
        preheader: 'We could not complete your LymphAware ID automatic-renewal payment.',
        actionUrl,
        actionLabel: object?.hosted_invoice_url ? 'Complete renewal payment' : 'Review my membership',
        text: `We could not complete the automatic-renewal payment for your LymphAware ID membership.\n\nAmount due: ${amountDue}\nRenewal date: ${dateUK(membership.next_renewal_at || membership.membership_end)}\n\nNo duplicate payment has been taken. Stripe may retry the payment automatically. You can also use the secure payment link below to complete the renewal or update the payment method offered by Stripe:\n\n${actionUrl}\n\nIf the renewal is not completed by the end of your paid membership term, your QR-linked profile will become unavailable until the membership is renewed.\n\nIf you need help, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team`,
        detailRows: [
          { label: 'Amount due', value: amountDue },
          { label: 'Renewal date', value: dateUK(membership.next_renewal_at || membership.membership_end) }
        ],
        idempotencyKey: `renewal-payment-failed-${object.id}-${object.attempt_count || 1}`
      });
      if (!result.ok) console.error('Unable to send failed renewal payment email:', result.error);
      await recordContractEvent({
        membershipId: membership.id,
        userId: membership.user_id,
        eventType: 'RENEWAL_PAYMENT_FAILED',
        stripeReference: object.id,
        details: {
          attempt_count: object.attempt_count || null,
          amount_due_pence: object.amount_due || membership.renewal_price_pence,
          hosted_invoice_available: Boolean(object?.hosted_invoice_url),
          notice_sent: result.ok
        }
      });
    }
    return true;
  }
  if (event.type === 'invoice.paid') {
    const subscriptionId = invoiceSubscriptionId(object);
    if (!subscriptionId || object.billing_reason !== 'subscription_cycle') return true;
    const membership = await membershipBySubscription(subscriptionId);
    if (!membership) return true;
    if (membership.membership_status === 'PILOT') {
      const periodEnd = object.lines?.data?.map(line => line.period?.end).filter(Boolean).sort((a, b) => b - a)[0];
      await patchMembershipBySubscription(subscriptionId, {
        stripe_subscription_status: 'active',
        ...(periodEnd ? { membership_end: new Date(periodEnd * 1000).toISOString(), next_renewal_at: new Date(periodEnd * 1000).toISOString() } : {})
      });
      return true;
    }
    const periodEnd = object.lines?.data?.map(line => line.period?.end).filter(Boolean).sort((a, b) => b - a)[0];
    const renewalPaidAt = new Date((object.status_transitions?.paid_at || event.created) * 1000);
    const renewalCoolingEnds = new Date(renewalPaidAt.getTime() + (14 * 86400000));
    await patchMembershipBySubscription(subscriptionId, {
      membership_status: 'ACTIVE',
      payment_status: 'PAID',
      stripe_subscription_status: 'active',
      paid_at: renewalPaidAt.toISOString(),
      latest_renewal_paid_at: renewalPaidAt.toISOString(),
      latest_renewal_mode: 'AUTO',
      latest_renewal_payment_intent_id: typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id || null,
      latest_renewal_checkout_session_id: null,
      renewal_previous_membership_end: membership.membership_end,
      renewal_cooling_off_ends_at: renewalCoolingEnds.toISOString(),
      cooling_off_cancellation_requested_at: null,
      renewal_cooling_notice_sent_at: renewalPaidAt.toISOString(),
      renewal_reminder_first_sent_at: null,
      renewal_reminder_final_sent_at: null,
      ...(periodEnd ? { membership_end: new Date(periodEnd * 1000).toISOString(), next_renewal_at: new Date(periodEnd * 1000).toISOString() } : {})
    });
    const nextRenewalAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
    const deferredPrice = await applyDeferredRenewalPriceAfterPaidCycle(membership, nextRenewalAt);
    const email = String(object?.customer_email || '').trim() || await memberEmail(membership.user_id);
    const amountPaid = money(object.amount_paid || membership.renewal_price_pence);
    const futurePriceNote = deferredPrice
      ? `\n\nAs previously notified, your future automatic-renewal price has now been updated to ${money(deferredPrice.newPricePence)}. This new price will apply at your next renewal${deferredPrice.nextRenewalAt ? ` on ${dateUK(deferredPrice.nextRenewalAt)}` : ''}. No additional payment has been taken now.`
      : '';
    const emailResult = await sendMembershipEmail({
      to: email,
      subject: 'Your LymphAware ID membership has renewed',
      idempotencyKey: `renewal-cooling-${object.id}`,
      text: `Your LymphAware ID digital membership has renewed and ${amountPaid} has been paid. Your new membership end date is ${dateUK(periodEnd ? new Date(periodEnd * 1000) : null)}.${futurePriceNote}\n\nRENEWAL COOLING-OFF PERIOD\n\nYou may cancel this renewed membership until ${dateUK(renewalCoolingEnds)}. Use the “Cancel this renewal” option in your Patient Portal:\nhttps://lymphawareid.com/portal/\n\nIf you cancel during this period, the renewal payment will be refunded and renewed access will end. You can also email admin@lymphawareid.com.\n\nThe LymphAware ID Team`
    });
    if (!emailResult.ok) console.error('Unable to send renewal cooling-off notice:', emailResult.error);
    await recordContractEvent({
      membershipId: membership.id,
      userId: membership.user_id,
      eventType: 'RENEWAL_COOLING_NOTICE',
      stripeReference: object.id,
      details: { renewal_paid_at: renewalPaidAt.toISOString(), cooling_off_ends_at: renewalCoolingEnds.toISOString(), amount_paid_pence: object.amount_paid || membership.renewal_price_pence, notice_sent: emailResult.ok }
    });
    return true;
  }
  return false;
}

async function moveRenewalToMultilingual(userId) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&auto_renew_enabled=eq.true&select=id,package_type,membership_term_years,stripe_subscription_item_id,renewal_price_pence&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to read membership renewal: ${await response.text()}`);
  const membership = (await response.json())?.[0];
  const term = Number(membership?.membership_term_years);
  if (!membership?.stripe_subscription_item_id || ![1, 2, 3].includes(term)) return;

  const renewalPricePence = await liveRenewalPrice('MULTILINGUAL', term);
  if (renewalPricePence <= 0) throw new Error('Unable to determine the current Multilingual renewal price.');
  if (String(membership.package_type || '').toUpperCase() === 'MULTILINGUAL' && Number(membership.renewal_price_pence || 0) === renewalPricePence) return;
  const price = await createRenewalStripePrice('MULTILINGUAL', term, renewalPricePence);

  await stripeRequest(`subscription_items/${encodeURIComponent(membership.stripe_subscription_item_id)}`, 'POST', {
    price: price.id,
    proration_behavior: 'none'
  }, `multilingual-renewal-price-${membership.id}-${renewalPricePence}`);
  const update = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`, {
    method: 'PATCH',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify({ package_type: 'MULTILINGUAL', renewal_price_pence: renewalPricePence, updated_at: new Date().toISOString() })
  });
  if (!update.ok) throw new Error(`Unable to update multilingual renewal: ${await update.text()}`);
}

function normaliseItem(item) {
  return {
    item_type: item.item_type,
    description: item.description,
    quantity: item.quantity,
    unit_price_pence: item.unit_price_pence,
    line_total_pence: item.line_total_pence,
    language_code: item.language_code || null,
    language_name: item.language_name || null
  };
}

function parseCardSelectionsMetadata(value, fallbackQuantity = 0) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) throw new Error('Invalid card selections');
    const selections = parsed.map(item => ({
      languageCode: String(item?.[0] || '').trim().toUpperCase(),
      languageName: String(item?.[1] || '').trim(),
      quantity: Number(item?.[2] || 0)
    })).filter(item => item.languageCode && item.languageName && Number.isInteger(item.quantity) && item.quantity > 0);
    if (selections.length) return selections;
  } catch {
    // Older checkout sessions used one unlabelled card quantity, which represented English cards.
  }
  return fallbackQuantity > 0 ? [{ languageCode: 'EN', languageName: 'English', quantity: fallbackQuantity }] : [];
}

async function patchOrder(orderId, values) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
    method: 'PATCH',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  if (!response.ok) console.error('Unable to update LymphAware ID order:', await response.text());
}

async function sendOrderNotification(order, session, items) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const orderRef = `ORD-${String(order.order_number).padStart(6, '0')}`;
  if (!apiKey) {
    const error = 'RESEND_API_KEY is not configured.';
    await patchOrder(order.id, { notification_status: 'FAILED', notification_error: error, notification_sent_at: null });
    return { ok: false, error };
  }

  const to = communicationControls(await getControlSettings()).adminNotificationEmail || String(process.env.ORDER_NOTIFICATION_EMAIL || 'admin@lymphawareid.com').trim();
  const from = String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware ID <notifications@lymphawareid.com>').trim();
  const itemLines = items.map((item) => {
    const language = item.language_name ? ` – ${item.language_name}` : '';
    return `${item.quantity} × ${item.description}${language}`;
  }).join('\n');
  const customerName = session.customer_details?.name || session.customer_email || 'Customer';
  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const totalPaid = `£${((session.amount_total || 0) / 100).toFixed(2)}`;
  const postageChargePence = Number(session.metadata?.shipping_pence || session.total_details?.amount_shipping || 0);
  const postagePaid = `£${(postageChargePence / 100).toFixed(2)}`;
  const isTrial = String(session.metadata?.trial_discount_applied || '') === '1';
  const subject = isTrial ? `New LymphAware ID PRIVATE TRIAL order – ${orderRef}` : `New LymphAware ID order – ${orderRef}`;
  const emailText =
    `${isTrial ? 'A new LymphAware ID private-trial order' : 'A new LymphAware ID order'} has been paid and requires attention.\n\n` +
    `Order: ${orderRef}\nCustomer: ${customerName}\nEmail: ${customerEmail}\n${isTrial ? 'Private trial: Yes – customer charge £0.00\n' : ''}Postage & packing (before any promotion discount): ${postagePaid}\nTotal paid: ${totalPaid}\n\n` +
    `Items:\n${itemLines || 'No item detail recorded'}\n\n` +
    `Open LymphAware ID Administration to manage fulfilment:\nhttps://lymphawareid.com/admin/orders/`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: ['admin@lymphawareid.com'],
        subject,
        text: emailText,
        html: brandedEmailHtml({ title: subject, text: emailText })
      })
    });
    if (!response.ok) {
      const error = await response.text();
      await patchOrder(order.id, { notification_status: 'FAILED', notification_error: error, notification_sent_at: null });
      return { ok: false, error };
    }
    const result = await response.json();
    await patchOrder(order.id, { notification_status: 'SENT', notification_error: null, notification_sent_at: new Date().toISOString() });
    return { ok: true, id: result?.id || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchOrder(order.id, { notification_status: 'FAILED', notification_error: message, notification_sent_at: null });
    return { ok: false, error: message };
  }
}

async function sendCustomerConfirmation(order, session, items, paymentType, languageName, accountSetupLink = '') {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const customerEmail = String(session.customer_details?.email || session.customer_email || '').trim();
  if (!apiKey || !customerEmail) return { ok: false, error: 'Customer email notification is not configured.' };

  const from = String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware ID <notifications@lymphawareid.com>').trim();
  const isTrial = String(session.metadata?.trial_discount_applied || '') === '1';
  const orderRef = `ORD-${String(order.order_number).padStart(6, '0')}`;
  const itemLines = items.map((item) => `• ${item.quantity} × ${item.description}${item.language_name ? ` – ${item.language_name}` : ''}`).join('\n');
  const postageChargePence = Number(session.metadata?.shipping_pence || session.total_details?.amount_shipping || 0);
  const postagePaid = `£${(postageChargePence / 100).toFixed(2)}`;
  const totalPaid = `£${((session.amount_total || 0) / 100).toFixed(2)}`;
  const membershipTermYears = [1, 2, 3].includes(Number(session.metadata?.membership_term_years))
    ? Number(session.metadata.membership_term_years)
    : 3;
  let subject = `Your LymphAware ID order is confirmed – ${orderRef}`;
  let nextSteps =
    `Your order has been received. We will use the current name and photograph in your LymphAware ID profile for any ID card included in this order.\n\n` +
    `You can review your profile and delivery progress from your Patient Portal:\nhttps://lymphawareid.com/portal/`;

  if (paymentType === 'initial_membership') {
    const welcome = buildInitialMembershipWelcome({
      membershipTermYears,
      isTrial,
      accountSetupLink,
      languageName,
      autoRenew: String(session.metadata?.auto_renew || '') === '1',
      renewalPricePence: Number(session.metadata?.renewal_price_pence || 0)
    });
    subject = welcome.subject;
    nextSteps = welcome.nextSteps;
  } else if (paymentType === 'additional_items') {
    subject = `Your LymphAware ID additional order is confirmed – ${orderRef}`;
    if (languageName) {
      nextSteps +=
        `\n\nYour order includes a ${languageName} language package. You do not need to translate your profile yourself. LymphAware ID will prepare the ${languageName} version from your main English profile and automatically keep it updated when your English profile changes. Any English sections left empty will also be empty in the translated profile.`;
    }
  } else if (paymentType === 'additional_language') {
    subject = `Your ${languageName || 'additional-language'} LymphAware ID package is confirmed`;
    nextSteps =
      `You do not need to translate your profile yourself. LymphAware ID will prepare the ${languageName || 'selected-language'} version for you from the information in your main English profile and automatically keep it updated when your English profile changes.\n\n` +
      `Please make sure your main English profile is accurate and complete. Any English sections left empty will also be empty in the translated profile.\n\n` +
      `Review your main profile:\nhttps://lymphawareid.com/profile/`;
  }

  const emailText =
    `${isTrial && paymentType === 'initial_membership' ? 'Thank you for joining the LymphAware ID private trial.' : 'Thank you for your LymphAware ID purchase.'}\n\nOrder: ${orderRef}\n\nItems:\n${itemLines || 'Your selected LymphAware ID package'}\n\nPostage & packing (before any promotion discount): ${postagePaid}\nTotal paid: ${totalPaid}\n\n` +
    `${nextSteps}\n\nIf you need help, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `lymphaware-customer-${session.id}`
      },
      body: JSON.stringify({
        from,
        to: [customerEmail],
        reply_to: ['admin@lymphawareid.com'],
        subject,
        text: emailText,
        html: brandedEmailHtml({ title: subject, text: emailText, actionUrl: accountSetupLink, actionLabel: 'Confirm email' })
      })
    });
    if (!response.ok) return { ok: false, error: await response.text() };
    const result = await response.json();
    return { ok: true, id: result?.id || null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getExistingOrder(sessionId) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/orders?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

async function ensureOrderItems(orderId, items) {
  const existingResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/order_items?order_id=eq.${orderId}&select=item_type,language_name`,
    { headers: supabaseHeaders() }
  );
  if (!existingResponse.ok) return { ok: false, error: await existingResponse.text() };
  const existing = await existingResponse.json();
  const existingKeys = new Set(existing.map((item) => `${item.item_type}|${item.language_name || ''}`));
  const missing = items.map(normaliseItem)
    .filter((item) => !existingKeys.has(`${item.item_type}|${item.language_name || ''}`))
    .map((item) => ({ ...item, order_id: orderId }));
  if (!missing.length) return { ok: true };
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/order_items`, {
    method: 'POST',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify(missing)
  });
  if (!response.ok) return { ok: false, error: await response.text() };
  return { ok: true };
}

function buildInitialItems(packageType, languageCode, languageName, membershipTermYears, packagePricePence) {
  const termLabel = `${membershipTermYears}-Year`;
  if (packageType === 'PLUS') {
    return [
      normaliseItem({ item_type: 'MEMBERSHIP', description: `LymphAware ID ${termLabel} Plus`, quantity: 1, unit_price_pence: packagePricePence, line_total_pence: packagePricePence }),
      normaliseItem({ item_type: 'EXTRA_CARD', description: 'Additional English ID Card – included in Plus package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 }),
      normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Additional Lanyard & Holder – included in Plus package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 })
    ];
  }
  if (packageType === 'MULTILINGUAL') {
    return [
      normaliseItem({ item_type: 'MEMBERSHIP', description: `LymphAware ID ${termLabel} Multilingual`, quantity: 1, unit_price_pence: packagePricePence, line_total_pence: packagePricePence }),
      normaliseItem({ item_type: 'EXTRA_CARD', description: 'Second English ID Card – included in Multilingual package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 }),
      normaliseItem({ item_type: 'LANGUAGE_PACKAGE', description: 'Multilingual translated ID Cards & QR Profile', quantity: 2, unit_price_pence: 0, line_total_pence: 0, language_code: languageCode, language_name: languageName }),
      normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Translated-language Lanyard & Holder – included in Multilingual package', quantity: 1, unit_price_pence: 0, line_total_pence: 0, language_code: languageCode, language_name: languageName })
    ];
  }
  return [normaliseItem({ item_type: 'MEMBERSHIP', description: `LymphAware ID ${termLabel} Membership`, quantity: 1, unit_price_pence: packagePricePence, line_total_pence: packagePricePence })];
}

function buildAdditionalLanguageItems(languageCode, languageName, languagePricePence = ADDITIONAL_LANGUAGE_PRICE_PENCE) {
  return [
    normaliseItem({ item_type: 'LANGUAGE_PACKAGE', description: 'Additional Language Package', quantity: 1, unit_price_pence: languagePricePence, line_total_pence: languagePricePence, language_code: languageCode, language_name: languageName }),
    normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Lanyard & Holder – included in Additional Language Package', quantity: 1, unit_price_pence: 0, line_total_pence: 0, language_code: languageCode, language_name: languageName })
  ];
}

function buildReplacementItems(cardSelected, lanyardSelected, cardPricePence = ADDITIONAL_CARD_PRICE_PENCE, lanyardPricePence = LANYARD_HOLDER_PRICE_PENCE) {
  const items = [];
  if (cardSelected) {
    items.push(normaliseItem({ item_type: 'EXTRA_CARD', description: 'Replacement LymphAware ID Card', quantity: 1, unit_price_pence: cardPricePence, line_total_pence: cardPricePence }));
  }
  if (lanyardSelected) {
    items.push(normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Replacement Lanyard & Holder', quantity: 1, unit_price_pence: lanyardPricePence, line_total_pence: lanyardPricePence }));
  }
  return items;
}

function buildAdditionalPurchaseItems(cardSelections, lanyardQuantity, languageCode, languageName, cardPricePence = ADDITIONAL_CARD_PRICE_PENCE, lanyardPricePence = LANYARD_HOLDER_PRICE_PENCE, languagePricePence = ADDITIONAL_LANGUAGE_PRICE_PENCE) {
  const items = [];
  for (const selection of cardSelections) {
    items.push(normaliseItem({
      item_type: 'EXTRA_CARD',
      description: 'Additional or Replacement LymphAware ID Card',
      quantity: selection.quantity,
      unit_price_pence: cardPricePence,
      line_total_pence: selection.quantity * cardPricePence,
      language_code: selection.languageCode,
      language_name: selection.languageName
    }));
  }
  if (lanyardQuantity > 0) {
    items.push(normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Additional or Replacement Lanyard & Holder', quantity: lanyardQuantity, unit_price_pence: lanyardPricePence, line_total_pence: lanyardQuantity * lanyardPricePence }));
  }
  if (languageName) items.push(...buildAdditionalLanguageItems(languageCode, languageName, languagePricePence));
  return items;
}

async function recordLanguageTranslationConsent(orderId, consentAt) {
  if (!consentAt) return;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/language_profiles?order_id=eq.${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders('return=minimal'),
      body: JSON.stringify({ translation_consent_at: consentAt, updated_at: consentAt })
    }
  );
  if (!response.ok) console.error('Unable to record language translation consent:', await response.text());
}

async function reopenPrimaryCardForReplacement(userId) {
  const profileResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=id,display_name,photo_path,qr_token,qr_profile_active&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!profileResponse.ok) return;
  const rows = await profileResponse.json();
  const profile = rows?.[0];
  if (!profile?.id || !profile.display_name?.trim() || !profile.photo_path?.trim() || !profile.qr_token || profile.qr_profile_active !== true) return;

  const now = new Date().toISOString();
  const updateResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders('return=minimal'),
      body: JSON.stringify({
        card_production_status: 'READY',
        card_ready_at: now,
        card_prepared_at: null,
        card_printed_at: null,
        updated_at: now
      })
    }
  );
  if (!updateResponse.ok) console.error('Unable to reopen replacement card job:', await updateResponse.text());
}

async function reopenLanguageCardsForReplacement(userId, cardSelections) {
  const now = new Date().toISOString();
  for (const selection of cardSelections.filter(item => item.languageCode !== 'EN')) {
    const updateResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/language_profiles?user_id=eq.${encodeURIComponent(userId)}&language_code=eq.${encodeURIComponent(selection.languageCode)}&qr_profile_active=eq.true`,
      {
        method: 'PATCH',
        headers: supabaseHeaders('return=minimal'),
        body: JSON.stringify({
          card_production_status: 'READY',
          card_ready_at: now,
          card_prepared_at: null,
          card_printed_at: null,
          updated_at: now
        })
      }
    );
    if (!updateResponse.ok) console.error(`Unable to reopen ${selection.languageName} replacement card job:`, await updateResponse.text());
  }
}


async function lookupAuthUserByEmail(email) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/lookup_auth_user_by_email`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({ p_email: email })
  });
  if (!response.ok) throw new Error(`Unable to look up paid signup account: ${await response.text()}`);
  const rows = await response.json();
  return Array.isArray(rows) ? (rows[0] || null) : null;
}

async function waitForMembership(userId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      { headers: supabaseHeaders() }
    );
    if (response.ok) {
      const membership = (await response.json())?.[0];
      if (membership) return membership;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return null;
}

async function generateAccountActionLink({ email, session, existingUser = false }) {
  const data = {
    selected_package: String(session.metadata?.package_type || 'STANDARD').trim().toUpperCase(),
    selected_membership_term_years: Number(session.metadata?.membership_term_years || 0),
    membership_contract_version: String(session.metadata?.contract_version || MEMBERSHIP_CONTRACT_VERSION),
    registration_invite_code: String(session.metadata?.registration_invite_code || '').trim().toUpperCase(),
    trial_participant: String(session.metadata?.trial_discount_applied || '') === '1',
    stripe_checkout_session_id: session.id
  };
  const body = existingUser
    ? { type: 'recovery', email, redirect_to: 'https://lymphawareid.com/complete-account/' }
    : { type: 'invite', email, data, redirect_to: 'https://lymphawareid.com/complete-account/' };

  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.msg || result?.message || result?.error_description || 'Unable to prepare the account setup link.');

  const actionLink = String(result?.properties?.action_link || result?.action_link || '').trim();
  const generatedUser = result?.user || result?.properties?.user || null;
  return { actionLink, generatedUser };
}

async function provisionPaidSignup(session) {
  const email = String(
    session.metadata?.registration_email ||
    session.customer_details?.email ||
    session.customer_email ||
    ''
  ).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Paid signup email is missing or invalid.');

  let existing = await lookupAuthUserByEmail(email);
  let actionLink = '';

  if (!existing?.user_id) {
    const generated = await generateAccountActionLink({ email, session, existingUser: false });
    actionLink = generated.actionLink;
    existing = generated.generatedUser?.id
      ? { user_id: generated.generatedUser.id, email: generated.generatedUser.email || email, email_confirmed_at: generated.generatedUser.email_confirmed_at || null }
      : await lookupAuthUserByEmail(email);
  } else if (!existing.email_confirmed_at) {
    const generated = await generateAccountActionLink({ email, session, existingUser: true });
    actionLink = generated.actionLink;
  }

  if (!existing?.user_id) throw new Error('The paid member account could not be created.');
  const membership = await waitForMembership(existing.user_id);
  if (!membership?.id) throw new Error('The paid member membership record could not be created.');

  return {
    userId: existing.user_id,
    membershipId: membership.id,
    email,
    accountSetupLink: actionLink
  };
}

export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const payload = await request.text();
    const stripeSignature = request.headers.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!verifyStripeSignature(payload, stripeSignature, webhookSecret)) return new Response('Invalid signature', { status: 400 });

    const event = JSON.parse(payload);
    if (await handleRecurringEvent(event)) {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (event.type !== 'checkout.session.completed') {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const session = event.data?.object;
    let userId = session?.metadata?.lymphaware_user_id || '';
    let membershipId = session?.metadata?.membership_id || null;
    let accountSetupLink = '';
    const paymentType = String(session?.metadata?.payment_type || '').trim();
    if (!['initial_membership', 'additional_language', 'replacement_items', 'additional_items', 'manual_membership_renewal'].includes(paymentType)) {
      return new Response('Invalid payment metadata', { status: 400 });
    }
    if (paymentType !== 'initial_membership' && !userId) {
      return new Response('Invalid payment metadata', { status: 400 });
    }

    const completedPayment = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (!completedPayment) {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const paidAt = new Date();
    const packageType = String(session.metadata?.package_type || 'STANDARD').trim().toUpperCase();
    const membershipTermYears = [1, 2, 3].includes(Number(session.metadata?.membership_term_years))
      ? Number(session.metadata.membership_term_years)
      : 3;
    const metadataPackagePricePence = Number(session.metadata?.package_price_pence);
    const packagePricePence = Number.isInteger(metadataPackagePricePence) && metadataPackagePricePence > 0
      ? metadataPackagePricePence
      : INITIAL_PACKAGE_PRICES[packageType]?.[membershipTermYears];
    if (paymentType === 'initial_membership' && !packagePricePence) return new Response('Invalid membership package metadata', { status: 400 });
    const languageName = String(session.metadata?.language_name || '').trim();
    const languageCode = String(session.metadata?.language_code || '').trim().toUpperCase();
    const replacementCard = String(session.metadata?.replacement_card || '') === '1';
    const replacementLanyard = String(session.metadata?.replacement_lanyard || '') === '1';
    const metadataCardQuantity = Number(session.metadata?.card_quantity || 0);
    const metadataLanyardQuantity = Number(session.metadata?.lanyard_quantity || 0);
    const cardQuantity = Number.isInteger(metadataCardQuantity) && metadataCardQuantity >= 0 ? metadataCardQuantity : (replacementCard ? 1 : 0);
    const cardSelections = parseCardSelectionsMetadata(session.metadata?.card_selections, cardQuantity);
    const lanyardQuantity = Number.isInteger(metadataLanyardQuantity) && metadataLanyardQuantity >= 0 ? metadataLanyardQuantity : (replacementLanyard ? 1 : 0);
    const metadataCardUnitPricePence = Number(session.metadata?.card_unit_price_pence);
    const metadataLanyardUnitPricePence = Number(session.metadata?.lanyard_unit_price_pence);
    const metadataLanguagePricePence = Number(session.metadata?.language_price_pence);
    const cardUnitPricePence = Number.isInteger(metadataCardUnitPricePence) && metadataCardUnitPricePence >= 0 ? metadataCardUnitPricePence : ADDITIONAL_CARD_PRICE_PENCE;
    const lanyardUnitPricePence = Number.isInteger(metadataLanyardUnitPricePence) && metadataLanyardUnitPricePence >= 0 ? metadataLanyardUnitPricePence : LANYARD_HOLDER_PRICE_PENCE;
    const languagePricePence = Number.isInteger(metadataLanguagePricePence) && metadataLanguagePricePence >= 0 ? metadataLanguagePricePence : ADDITIONAL_LANGUAGE_PRICE_PENCE;
    const translationConsent = String(session.metadata?.translation_consent || '') === '1';
    const autoRenew = String(session.metadata?.auto_renew || '') === '1' && typeof session.subscription === 'string';
    const isTrial = String(session.metadata?.trial_discount_applied || '') === '1';
    const metadataRenewalPricePence = Number(session.metadata?.renewal_price_pence || 0);
    const renewalPricePence = autoRenew
      ? (metadataRenewalPricePence > 0 ? metadataRenewalPricePence : await liveRenewalPrice(packageType, membershipTermYears))
      : null;

    if (paymentType === 'manual_membership_renewal') {
      const membership = await membershipForManualRenewal(membershipId, userId);
      if (!membership) return new Response('Renewal membership not found', { status: 404 });

      if (String(membership.payment_reference || '') === String(session.id)) {
        return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const currentPackageType = String(membership.package_type || '').toUpperCase();
      const currentTermYears = Number(membership.membership_term_years || 0);
      if (!PACKAGE_DEFINITIONS[currentPackageType] || ![1, 2, 3].includes(currentTermYears)) {
        return new Response('Invalid renewal membership configuration', { status: 400 });
      }
      if (
        currentPackageType !== packageType ||
        currentTermYears !== membershipTermYears
      ) {
        return new Response('Renewal membership metadata mismatch', { status: 400 });
      }

      const recordedEnd = new Date(membership.membership_end || 0);
      const renewalBase = Number.isFinite(recordedEnd.getTime()) && recordedEnd.getTime() > paidAt.getTime()
        ? recordedEnd
        : paidAt;
      const newMembershipEnd = addYearsClamped(renewalBase, currentTermYears);
      if (!newMembershipEnd) return new Response('Unable to calculate renewal expiry date', { status: 500 });

      const manualRenewalPricePence = Number(session.metadata?.renewal_price_pence || 0) || await liveRenewalPrice(currentPackageType, currentTermYears);
      const trialRenewal = String(membership.membership_status || '').toUpperCase() === 'PILOT';
      const renewalCoolingEnds = new Date(paidAt.getTime() + (14 * 86400000));
      const renewalPaymentIntent = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null;

      const updateResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`,
        {
          method: 'PATCH',
          headers: supabaseHeaders('return=minimal'),
          body: JSON.stringify({
            membership_status: trialRenewal ? 'PILOT' : 'ACTIVE',
            payment_status: 'PAID',
            payment_provider: 'STRIPE',
            payment_reference: session.id,
            paid_at: paidAt.toISOString(),
            latest_renewal_paid_at: paidAt.toISOString(),
            latest_renewal_mode: 'MANUAL',
            latest_renewal_payment_intent_id: renewalPaymentIntent,
            latest_renewal_checkout_session_id: session.id,
            renewal_previous_membership_end: membership.membership_end,
            renewal_cooling_off_ends_at: renewalCoolingEnds.toISOString(),
            renewal_cooling_notice_sent_at: paidAt.toISOString(),
            cooling_off_cancellation_requested_at: null,
            membership_end: newMembershipEnd.toISOString(),
            renewal_price_pence: manualRenewalPricePence,
            auto_renew_requested: false,
            auto_renew_enabled: false,
            next_renewal_at: null,
            renewal_reminder_first_sent_at: null,
            renewal_reminder_final_sent_at: null,
            stripe_customer_id: typeof session.customer === 'string' ? session.customer : membership.stripe_customer_id,
            updated_at: paidAt.toISOString()
          })
        }
      );
      if (!updateResponse.ok) {
        console.error('Unable to update manual membership renewal:', await updateResponse.text());
        return new Response('Membership renewal update failed', { status: 500 });
      }

      await recordContractEvent({
        membershipId: membership.id,
        userId,
        eventType: 'MANUAL_RENEWAL_PAID',
        stripeReference: session.id,
        details: {
          paid_at: paidAt.toISOString(),
          previous_membership_end: membership.membership_end,
          renewal_base_date: renewalBase.toISOString(),
          new_membership_end: newMembershipEnd.toISOString(),
          package_type: currentPackageType,
          membership_term_years: currentTermYears,
          renewal_price_pence: manualRenewalPricePence,
          cooling_off_ends_at: renewalCoolingEnds.toISOString(),
          payment_intent_id: renewalPaymentIntent
        }
      });

      const email = String(session.customer_details?.email || session.customer_email || '').trim() || await memberEmail(userId);
      const emailResult = await sendMembershipEmail({
        to: email,
        subject: 'Your LymphAware ID membership has been renewed',
        idempotencyKey: `manual-renewal-confirmation-${session.id}`,
        text: `Your LymphAware ID membership renewal has been completed.\n\nYour previous membership expiry date was ${dateUK(membership.membership_end)}.\nYour renewed membership is now active until ${dateUK(newMembershipEnd.toISOString())}.\n\n${Number.isFinite(recordedEnd.getTime()) && recordedEnd.getTime() > paidAt.getTime() ? 'Because your renewal was completed before the previous expiry date, the new term has been added from that existing expiry date. You have not lost any remaining membership time.\n\n' : ''}Your existing LymphAware ID, Patient Portal and QR profile continue as normal. No new physical cards, lanyards, holders or postage are included with a membership renewal.\n\nRENEWAL COOLING-OFF PERIOD\n\nYou may cancel this renewed membership until ${dateUK(renewalCoolingEnds)} from your Patient Portal. The renewal payment will be refunded. If your previous paid membership term is still running, it will continue until its original expiry date.\n\nhttps://lymphawareid.com/portal/\n\nThe LymphAware ID Team`
      });
      if (!emailResult.ok) console.error('Unable to send manual renewal confirmation:', emailResult.error);

      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (paymentType === 'initial_membership') {
      const existingOrder = await getExistingOrder(session.id);
      if (existingOrder?.user_id) {
        userId = existingOrder.user_id;
        membershipId = existingOrder.membership_id || membershipId;
      } else if (!userId || !membershipId) {
        const provisioned = await provisionPaidSignup(session);
        userId = provisioned.userId;
        membershipId = provisioned.membershipId;
        accountSetupLink = provisioned.accountSetupLink;
      }
      const membershipEnd = new Date(paidAt);
      membershipEnd.setUTCFullYear(membershipEnd.getUTCFullYear() + membershipTermYears);
      let subscription = null;
      if (autoRenew) {
        if (isTrial) {
          await stripeRequest(`subscriptions/${encodeURIComponent(session.subscription)}`, 'POST', {
            'discounts[0][coupon]': TRIAL_RENEWAL_PROTECTION_COUPON,
            'metadata[trial_no_charge]': '1',
            proration_behavior: 'none'
          });
        }
        subscription = await stripeRequest(`subscriptions/${encodeURIComponent(session.subscription)}`);
      }
      const membershipResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: supabaseHeaders('return=minimal'),
          body: JSON.stringify({
            membership_status: isTrial ? 'PILOT' : 'ACTIVE', payment_status: 'PAID', payment_provider: 'STRIPE', payment_reference: session.id,
            paid_at: paidAt.toISOString(), membership_start: paidAt.toISOString(), membership_end: membershipEnd.toISOString(), initial_fee_pence: packagePricePence,
            package_type: packageType, membership_term_years: membershipTermYears, auto_renew_enabled: autoRenew,
            auto_renew_requested: autoRenew,
            renewal_price_pence: renewalPricePence,
            subscription_terms_version: String(session.metadata?.contract_version || MEMBERSHIP_CONTRACT_VERSION),
            precontract_accepted_at: String(session.metadata?.precontract_accepted_at || paidAt.toISOString()),
            auto_renew_consent_at: autoRenew ? String(session.metadata?.precontract_accepted_at || paidAt.toISOString()) : null,
            auto_renew_cancelled_at: null,
            stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
            stripe_subscription_id: autoRenew ? session.subscription : null,
            stripe_subscription_item_id: subscription?.items?.data?.[0]?.id || null,
            stripe_subscription_status: subscription?.status || null,
            next_renewal_at: subscription?.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : (autoRenew ? membershipEnd.toISOString() : null),
            updated_at: paidAt.toISOString()
          })
        }
      );
      if (!membershipResponse.ok) {
        console.error('Unable to update LymphAware ID membership:', await membershipResponse.text());
        return new Response('Membership update failed', { status: 500 });
      }
      if (membershipId) {
        await recordContractEvent({
          membershipId,
          userId,
          eventType: 'PRECONTRACT_ACCEPTED',
          stripeReference: session.id,
          details: {
            accepted_at: String(session.metadata?.precontract_accepted_at || paidAt.toISOString()),
            paid_at: paidAt.toISOString(),
            package_type: packageType,
            membership_term_years: membershipTermYears,
            amount_total_pence: session.amount_total,
            auto_renew_selected: autoRenew,
            renewal_price_pence: renewalPricePence
          }
        });
      }
    }

    const items = paymentType === 'initial_membership'
      ? buildInitialItems(packageType, languageCode, languageName, membershipTermYears, packagePricePence)
      : paymentType === 'additional_language'
        ? buildAdditionalLanguageItems(languageCode, languageName, languagePricePence)
        : paymentType === 'additional_items'
          ? buildAdditionalPurchaseItems(cardSelections, lanyardQuantity, languageCode, languageName, cardUnitPricePence, lanyardUnitPricePence, languagePricePence)
          : buildReplacementItems(replacementCard, replacementLanyard, cardUnitPricePence, lanyardUnitPricePence);

    const expectedSubtotal = items.reduce((sum, item) => sum + item.line_total_pence, 0);
    const shipping = session.collected_information?.shipping_details || session.shipping_details || null;
    const address = shipping?.address || session.customer_details?.address || {};
    const deliveryName = shipping?.name || session.customer_details?.name || null;
    const selectedDeliveryCountry = String(session.metadata?.delivery_country_selected || '').trim().toUpperCase();
    const checkoutDeliveryCountry = String(address.country || '').trim().toUpperCase();
    const deliveryCountryMismatch = Boolean(
      selectedDeliveryCountry &&
      checkoutDeliveryCountry &&
      selectedDeliveryCountry !== checkoutDeliveryCountry
    );
    if (deliveryCountryMismatch) {
      console.error('Checkout delivery country does not match the country used to calculate postage.', {
        checkoutSessionId: session.id,
        selectedDeliveryCountry,
        checkoutDeliveryCountry
      });
    }
    const orderType = paymentType === 'initial_membership'
      ? 'INITIAL_MEMBERSHIP'
      : paymentType === 'additional_language' || (paymentType === 'additional_items' && languageName && !cardQuantity && !lanyardQuantity)
        ? 'LANGUAGE_PACKAGE'
        : 'REPLACEMENT';

    const orderPayload = {
      user_id: userId,
      membership_id: membershipId,
      order_type: orderType,
      order_status: deliveryCountryMismatch ? 'ADDRESS_REVIEW_REQUIRED' : 'PAID_AWAITING_PROFILE',
      payment_status: 'PAID',
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      customer_email: session.customer_details?.email || session.customer_email || null,
      delivery_name: deliveryName,
      delivery_line1: address.line1 || null,
      delivery_line2: address.line2 || null,
      delivery_city: address.city || null,
      delivery_county: address.state || null,
      delivery_postcode: address.postal_code || null,
      delivery_country: address.country || null,
      subtotal_pence: session.amount_subtotal ?? expectedSubtotal,
      discount_pence: session.total_details?.amount_discount || 0,
      total_pence: session.amount_total ?? expectedSubtotal,
      currency: session.currency || 'gbp',
      paid_at: paidAt.toISOString(),
      translation_consent_at: translationConsent ? paidAt.toISOString() : null,
      updated_at: paidAt.toISOString()
    };

    let order = null;
    const orderResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: supabaseHeaders('return=representation'),
      body: JSON.stringify(orderPayload)
    });
    if (orderResponse.ok) {
      const createdOrders = await orderResponse.json();
      order = createdOrders?.[0] || null;
    } else {
      const errorText = await orderResponse.text();
      if (!errorText.includes('duplicate key')) {
        console.error('Unable to create LymphAware ID order:', errorText);
        return new Response('Order creation failed', { status: 500 });
      }
      order = await getExistingOrder(session.id);
    }
    if (!order?.id) return new Response('Order could not be resolved', { status: 500 });

    const itemResult = await ensureOrderItems(order.id, items);
    if (!itemResult.ok) {
      console.error('Unable to create LymphAware ID order items:', itemResult.error);
      return new Response('Order item creation failed', { status: 500 });
    }

    if (translationConsent && (paymentType === 'initial_membership' || paymentType === 'additional_language' || paymentType === 'additional_items')) {
      await recordLanguageTranslationConsent(order.id, paidAt.toISOString());
      if (paymentType === 'additional_language' || paymentType === 'additional_items') await moveRenewalToMultilingual(userId);
    }

    if ((paymentType === 'replacement_items' && replacementCard) || (paymentType === 'additional_items' && cardSelections.some(item => item.languageCode === 'EN'))) {
      await reopenPrimaryCardForReplacement(userId);
    }
    if (paymentType === 'additional_items') {
      await reopenLanguageCardsForReplacement(userId, cardSelections);
    }

    if (order.notification_status !== 'SENT') await sendOrderNotification(order, session, items);
    if (order.customer_confirmation_status !== 'SENT') {
      const customerNotification = await sendCustomerConfirmation(order, session, items, paymentType, languageName, accountSetupLink);
      await patchOrder(order.id, customerNotification.ok
        ? { customer_confirmation_status: 'SENT', customer_confirmation_error: null, customer_confirmation_sent_at: new Date().toISOString() }
        : { customer_confirmation_status: 'FAILED', customer_confirmation_error: customerNotification.error, customer_confirmation_sent_at: null });
      if (!customerNotification.ok) console.error('Unable to send customer order confirmation:', customerNotification.error);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return new Response('Webhook processing failed', { status: 500 });
  }
};

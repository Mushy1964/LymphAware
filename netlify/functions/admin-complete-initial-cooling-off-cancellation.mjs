import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { brandedEmailHtml } from './_shared/email-branding.mjs';

function env(name) {
  return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || '').trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders(prefer = '') {
  const secret = env('SUPABASE_SECRET_KEY');
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function sendEmail({ to, subject, text }) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey || !to) return { ok: false };
  const from = env('ORDER_NOTIFICATION_FROM') || 'LymphAware ID <notifications@lymphawareid.com>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html: brandedEmailHtml({ title: subject, text })
    })
  });
  return { ok: response.ok };
}

async function createStripeRefund({ paymentIntentId, amountPence, orderId, membershipId }) {
  if (!paymentIntentId || amountPence <= 0) return null;
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Stripe refunds are not configured.');

  const body = new URLSearchParams({
    payment_intent: paymentIntentId,
    amount: String(amountPence),
    reason: 'requested_by_customer',
    'metadata[order_id]': orderId,
    'metadata[membership_id]': membershipId,
    'metadata[reason]': 'initial_cooling_off_cancellation'
  });

  const response = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2026-07-29.dahlia',
      'Idempotency-Key': `initial-cooling-off-${membershipId}-${orderId}-${amountPence}`
    },
    body: body.toString()
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Stripe cooling-off refund failed:', result);
    throw new Error(result?.error?.message || 'Stripe could not process the refund.');
  }
  return result;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const admin = await verifyAdminRequest(request);
  if (!admin) return json({ error: 'Administrator access required.' }, 403);

  try {
    const body = await request.json().catch(() => ({}));
    const orderId = String(body?.order_id || '').trim();
    const refundType = String(body?.refund_type || 'NONE').trim().toUpperCase();
    const adminNote = String(body?.admin_note || '').trim().slice(0, 2000);
    if (!orderId) return json({ error: 'Order ID required.' }, 400);
    if (!['NONE','FULL','PARTIAL'].includes(refundType)) return json({ error: 'Choose no refund, full refund or partial refund.' }, 400);

    const base = env('SUPABASE_URL');
    const orderResponse = await fetch(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,user_id,membership_id,order_type,order_status,payment_status,total_pence,stripe_payment_intent_id,customer_email,completed_at&limit=1`,
      { headers: serviceHeaders() }
    );
    if (!orderResponse.ok) return json({ error: 'The order could not be checked.' }, 500);
    const order = (await orderResponse.json())?.[0];
    if (!order) return json({ error: 'Order not found.' }, 404);
    if (order.order_type !== 'INITIAL_MEMBERSHIP') return json({ error: 'This action is only for an initial membership cancellation.' }, 400);
    if (!order.membership_id) return json({ error: 'The membership could not be identified.' }, 400);

    const membershipResponse = await fetch(
      `${base}/rest/v1/memberships?id=eq.${encodeURIComponent(order.membership_id)}&select=id,user_id,membership_status,payment_status,initial_cooling_off_cancellation_requested_at,initial_cooling_off_cancellation_status&limit=1`,
      { headers: serviceHeaders() }
    );
    if (!membershipResponse.ok) return json({ error: 'The membership could not be checked.' }, 500);
    const membership = (await membershipResponse.json())?.[0];
    if (!membership?.initial_cooling_off_cancellation_requested_at) {
      return json({ error: 'No initial cooling-off cancellation request is recorded for this membership.' }, 400);
    }
    if (String(membership.initial_cooling_off_cancellation_status || '').toUpperCase() === 'COMPLETED') {
      return json({ error: 'This cancellation has already been completed.' }, 409);
    }

    const totalPence = Math.max(0, Number(order.total_pence || 0));
    let refundAmountPence = 0;
    if (refundType === 'FULL') refundAmountPence = totalPence;
    if (refundType === 'PARTIAL') {
      refundAmountPence = Math.round(Number(body?.refund_amount_pence || 0));
      if (!Number.isFinite(refundAmountPence) || refundAmountPence <= 0) return json({ error: 'Enter a valid partial refund amount.' }, 400);
      if (refundAmountPence >= totalPence) return json({ error: 'For the full order amount, choose Full refund.' }, 400);
    }
    if (totalPence === 0 && refundType !== 'NONE') return json({ error: 'This was a £0 order, so no Stripe refund is required.' }, 400);
    if (refundAmountPence > totalPence) return json({ error: 'The refund cannot exceed the amount originally paid.' }, 400);

    const stripeRefund = refundAmountPence > 0
      ? await createStripeRefund({
          paymentIntentId: order.stripe_payment_intent_id,
          amountPence: refundAmountPence,
          orderId: order.id,
          membershipId: membership.id
        })
      : null;

    const now = new Date().toISOString();
    const refundReference = stripeRefund?.id || null;

    const [profileUpdate, languageUpdate] = await Promise.all([
      fetch(`${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(order.user_id)}`, {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({ qr_profile_active: false, updated_at: now })
      }),
      fetch(`${base}/rest/v1/language_profiles?user_id=eq.${encodeURIComponent(order.user_id)}`, {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({ qr_profile_active: false, updated_at: now })
      })
    ]);
    if (!profileUpdate.ok || !languageUpdate.ok) throw new Error('The QR profiles could not be safely disabled.');

    const membershipPatch = {
      membership_status: 'LAPSED',
      membership_end: now,
      auto_renew_enabled: false,
      initial_cooling_off_cancellation_status: 'COMPLETED',
      initial_cooling_off_cancellation_completed_at: now,
      initial_cooling_off_refund_type: refundType,
      initial_cooling_off_refund_amount_pence: refundAmountPence,
      initial_cooling_off_refund_reference: refundReference,
      initial_cooling_off_admin_note: adminNote || null,
      initial_cooling_off_completed_by: admin.email || null,
      updated_at: now
    };
    if (refundType === 'FULL' && totalPence > 0) membershipPatch.payment_status = 'REFUNDED';

    const membershipUpdate = await fetch(
      `${base}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify(membershipPatch)
      }
    );
    if (!membershipUpdate.ok) throw new Error('The membership cancellation could not be completed.');

    const originalOrderStatus = String(order.order_status || '').toUpperCase();
    const keepCompletedOrder = originalOrderStatus === 'COMPLETED';
    const closedOrderStatus = refundType === 'FULL' && totalPence > 0 ? 'REFUNDED' : 'CANCELLED';
    const orderPatch = {
      cancellation_reason: 'Initial membership cancelled during cooling-off period',
      cancelled_at: now,
      cancelled_by: admin.email || null,
      updated_at: now
    };
    if (!keepCompletedOrder) orderPatch.order_status = closedOrderStatus;

    const orderUpdate = await fetch(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify(orderPatch)
      }
    );
    if (!orderUpdate.ok) throw new Error('The order record could not be closed.');

    const orderRef = order.order_number ? `ORD-${String(order.order_number).padStart(6, '0')}` : 'Initial membership order';
    const refundText = refundAmountPence > 0
      ? `A refund of £${(refundAmountPence / 100).toFixed(2)} has been submitted to the original payment method through Stripe${refundReference ? ` (reference ${refundReference})` : ''}.`
      : 'No Stripe refund was required or recorded for this cancellation.';

    await sendEmail({
      to: order.customer_email,
      subject: 'Your LymphAware ID membership has been cancelled',
      text:
        `Your LymphAware ID membership cancellation has now been completed.\n\n` +
        `Order: ${orderRef}\n${refundText}\n\n` +
        `Your public QR profiles remain switched off and your membership is no longer active.\n\n` +
        `If you have any questions, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team`
    });

    return json({
      success: true,
      order_number: order.order_number,
      refund_type: refundType,
      refund_amount_pence: refundAmountPence,
      refund_reference: refundReference,
      membership_status: 'LAPSED',
      completed_at: now
    });
  } catch (error) {
    console.error('Complete cooling-off cancellation error:', error);
    return json({ error: error instanceof Error ? error.message : 'The cancellation could not be completed.' }, 500);
  }
};

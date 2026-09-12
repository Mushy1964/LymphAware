import { dateUK, money, recordContractEvent, sendMembershipEmail, serviceHeaders } from './_shared/membership-contract.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function stripeRequest(path, method = 'GET', values = null, idempotencyKey = '') {
  const headers = { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-07-29.dahlia' };
  if (values) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers,
    body: values ? new URLSearchParams(values).toString() : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || 'Stripe could not process the cancellation.');
  return result;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const token = authHeader.slice(7).trim();
    const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
    });
    if (!userResponse.ok) return json({ error: 'Unable to verify your LymphAware account.' }, 401);
    const user = await userResponse.json();

    const membershipResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}&select=id,stripe_subscription_id,renewal_price_pence,renewal_cooling_off_ends_at,cooling_off_cancellation_requested_at&limit=1`,
      { headers: serviceHeaders() }
    );
    const membership = (await membershipResponse.json())?.[0];
    if (!membershipResponse.ok || !membership?.stripe_subscription_id) return json({ error: 'A renewed membership could not be found.' }, 400);
    if (membership.cooling_off_cancellation_requested_at) return json({ error: 'This renewal cancellation has already been requested.' }, 409);
    const coolingEnd = new Date(membership.renewal_cooling_off_ends_at || 0);
    if (!Number.isFinite(coolingEnd.getTime()) || coolingEnd.getTime() < Date.now()) return json({ error: 'The renewal cooling-off period has ended.' }, 400);

    const subscription = await stripeRequest(`subscriptions/${encodeURIComponent(membership.stripe_subscription_id)}?expand[]=latest_invoice.payment_intent`);
    const invoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null;
    const paymentIntent = typeof invoice?.payment_intent === 'string' ? invoice.payment_intent : invoice?.payment_intent?.id;
    if (!paymentIntent) return json({ error: 'The renewal payment could not be located. Please contact admin@lymphaware.com.' }, 500);

    const refund = await stripeRequest('refunds', 'POST', { payment_intent: paymentIntent, reason: 'requested_by_customer', 'metadata[lymphaware_membership_id]': membership.id, 'metadata[reason]': 'renewal_cooling_off' }, `cooling-off-refund-${invoice.id}`);
    await stripeRequest(`subscriptions/${encodeURIComponent(membership.stripe_subscription_id)}`, 'DELETE', null, `cooling-off-cancel-${membership.stripe_subscription_id}`);

    const now = new Date().toISOString();
    const update = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`, {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({
        membership_status: 'LAPSED',
        payment_status: 'REFUNDED',
        membership_end: now,
        auto_renew_enabled: false,
        auto_renew_cancelled_at: now,
        cooling_off_cancellation_requested_at: now,
        stripe_subscription_status: 'canceled',
        updated_at: now
      })
    });
    if (!update.ok) throw new Error(`The refund succeeded but the membership record needs attention: ${await update.text()}`);
    await recordContractEvent({
      membershipId: membership.id,
      userId: user.id,
      eventType: 'RENEWAL_COOLING_CANCELLATION_REQUESTED',
      stripeReference: refund.id,
      details: { refund_id: refund.id, payment_intent_id: paymentIntent, refund_status: refund.status, requested_at: now }
    });

    const amount = money(refund.amount || membership.renewal_price_pence);
    const customerText = `Your renewed LymphAware membership has been cancelled during its renewal cooling-off period.\n\nA ${amount} refund has been submitted to your original payment method. Your bank may take several working days to show it. Renewed membership access has now ended.\n\nReference: ${refund.id}\n\nIf you need help, contact admin@lymphaware.com.\n\nThe LymphAware Team`;
    const customerEmail = await sendMembershipEmail({ to: user.email, subject: 'Your renewed LymphAware membership has been cancelled', text: customerText, idempotencyKey: `cooling-off-customer-${refund.id}` });
    if (!customerEmail.ok) console.error('Unable to send renewal cancellation email:', customerEmail.error);
    const adminEmail = await sendMembershipEmail({
      to: 'admin@lymphaware.com',
      subject: 'Renewal cooling-off cancellation completed',
      text: `A member used the online renewal cooling-off cancellation.\n\nMember: ${user.email}\nMembership: ${membership.id}\nRefund: ${refund.id}\nAmount: ${amount}\nCooling-off deadline: ${dateUK(coolingEnd)}\n\nThe Stripe refund was submitted and renewed portal access was ended.`,
      idempotencyKey: `cooling-off-admin-${refund.id}`
    });
    if (!adminEmail.ok) console.error('Unable to send renewal cancellation admin email:', adminEmail.error);
    return json({ cancelled: true, refundAmount: amount });
  } catch (error) {
    console.error('Unable to cancel renewed membership:', error);
    return json({ error: error instanceof Error ? error.message : 'Unable to cancel the renewed membership.' }, 500);
  }
};

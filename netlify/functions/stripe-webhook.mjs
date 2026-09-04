import crypto from 'node:crypto';

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

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  return signatures.some((signature) => {
    try {
      const receivedBuffer = Buffer.from(signature, 'hex');
      return (
        receivedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
      );
    } catch {
      return false;
    }
  });
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await request.text();
    const stripeSignature = request.headers.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!verifyStripeSignature(payload, stripeSignature, webhookSecret)) {
      console.error('Invalid Stripe webhook signature.');
      return new Response('Invalid signature', { status: 400 });
    }

    const event = JSON.parse(payload);

    if (event.type !== 'checkout.session.completed') {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const session = event.data?.object;
    const userId = session?.metadata?.lymphaware_user_id;
    const paymentType = session?.metadata?.payment_type;

    if (!userId || paymentType !== 'initial_membership') {
      console.error('Stripe webhook is missing expected LymphAware metadata.');
      return new Response('Invalid payment metadata', { status: 400 });
    }

    const completedPayment =
      session.payment_status === 'paid' ||
      session.payment_status === 'no_payment_required';

    if (!completedPayment) {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const membershipStart = new Date();
    const membershipEnd = new Date(membershipStart);
    membershipEnd.setUTCFullYear(membershipEnd.getUTCFullYear() + 5);

    const membershipResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: process.env.SUPABASE_SECRET_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          membership_status: 'ACTIVE',
          payment_status: 'PAID',
          payment_provider: 'STRIPE',
          payment_reference: session.id,
          paid_at: membershipStart.toISOString(),
          membership_start: membershipStart.toISOString(),
          membership_end: membershipEnd.toISOString(),
          updated_at: membershipStart.toISOString()
        })
      }
    );

    if (!membershipResponse.ok) {
      const errorText = await membershipResponse.text();
      console.error('Unable to update LymphAware membership:', errorText);
      return new Response('Membership update failed', { status: 500 });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return new Response('Webhook processing failed', { status: 500 });
  }
};

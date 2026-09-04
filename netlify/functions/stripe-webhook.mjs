import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

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
      return receivedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
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

async function sendOrderNotification(orderNumber, session, items) {
  const host = String(process.env.TITAN_SMTP_HOST || '').trim();
  const port = Number(process.env.TITAN_SMTP_PORT || '465');
  const user = String(process.env.TITAN_SMTP_USER || '').trim();
  const password = String(process.env.TITAN_SMTP_PASSWORD || '');

  if (!host || !user || !password) {
    console.log(`New LymphAware order ${orderNumber} created. Titan email notification is not configured yet.`);
    return;
  }

  const to = String(process.env.ORDER_NOTIFICATION_EMAIL || 'admin@lymphaware.com').trim();
  const from = String(process.env.ORDER_NOTIFICATION_FROM || `LymphAware Orders <${user}>`).trim();
  const itemLines = items.map((item) => `${item.quantity} × ${item.description}`).join('\n');
  const orderRef = `LA-${String(orderNumber).padStart(6, '0')}`;
  const customerName = session.customer_details?.name || session.customer_email || 'Customer';
  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const totalPaid = `£${((session.amount_total || 0) / 100).toFixed(2)}`;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: {
      user,
      pass: password
    }
  });

  try {
    await transporter.sendMail({
      from,
      to,
      subject: `New LymphAware order – ${orderRef}`,
      text:
        `A new LymphAware membership order has been paid and requires attention.\n\n` +
        `Order: ${orderRef}\n` +
        `Customer: ${customerName}\n` +
        `Email: ${customerEmail}\n` +
        `Total paid: ${totalPaid}\n\n` +
        `Items:\n${itemLines}\n\n` +
        `Open LymphAware Administration to manage fulfilment:\n` +
        `https://lymphaware.com/admin/orders/`
    });
  } catch (error) {
    console.error('Titan order notification email error:', error);
  }
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
    const membershipId = session?.metadata?.membership_id || null;
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
        headers: supabaseHeaders('return=minimal'),
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
      console.error('Unable to update LymphAware membership:', await membershipResponse.text());
      return new Response('Membership update failed', { status: 500 });
    }

    const extraCard = session.metadata?.extra_card === '1';
    const extraLanyard = session.metadata?.extra_lanyard === '1';
    const languagePackage = session.metadata?.language_package === '1';
    const languageName = String(session.metadata?.language_name || '').trim();

    const items = [
      {
        item_type: 'MEMBERSHIP',
        description: 'LymphAware 5-Year Membership',
        quantity: 1,
        unit_price_pence: 2999,
        line_total_pence: 2999
      }
    ];

    if (extraCard) {
      items.push({
        item_type: 'EXTRA_CARD',
        description: 'Extra LymphAware ID Card',
        quantity: 1,
        unit_price_pence: 650,
        line_total_pence: 650
      });
    }

    if (extraLanyard) {
      items.push({
        item_type: 'LANYARD_HOLDER',
        description: 'Extra LymphAware Lanyard & Holder',
        quantity: 1,
        unit_price_pence: 650,
        line_total_pence: 650
      });
    }

    if (languagePackage) {
      items.push({
        item_type: 'LANGUAGE_PACKAGE',
        description: `Additional Language Package${languageName ? ` – ${languageName}` : ''}`,
        quantity: 1,
        unit_price_pence: 1999,
        line_total_pence: 1999,
        language_name: languageName || null
      });
    }

    const expectedSubtotal = items.reduce((sum, item) => sum + item.line_total_pence, 0);
    const shipping =
      session.collected_information?.shipping_details ||
      session.shipping_details ||
      null;
    const address = shipping?.address || session.customer_details?.address || {};
    const deliveryName = shipping?.name || session.customer_details?.name || null;

    const orderPayload = {
      user_id: userId,
      membership_id: membershipId,
      order_type: 'INITIAL_MEMBERSHIP',
      order_status: 'PAID_AWAITING_PROFILE',
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
      paid_at: membershipStart.toISOString(),
      updated_at: membershipStart.toISOString()
    };

    const orderResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: supabaseHeaders('return=representation'),
      body: JSON.stringify(orderPayload)
    });

    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();

      if (!errorText.includes('duplicate key')) {
        console.error('Unable to create LymphAware order:', errorText);
        return new Response('Order creation failed', { status: 500 });
      }
    } else {
      const createdOrders = await orderResponse.json();
      const order = createdOrders?.[0];

      if (order?.id) {
        const orderItems = items.map((item) => ({ ...item, order_id: order.id }));
        const itemsResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/order_items`, {
          method: 'POST',
          headers: supabaseHeaders('return=minimal'),
          body: JSON.stringify(orderItems)
        });

        if (!itemsResponse.ok) {
          console.error('Unable to create LymphAware order items:', await itemsResponse.text());
          return new Response('Order item creation failed', { status: 500 });
        }

        await sendOrderNotification(order.order_number, session, items);
      }
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

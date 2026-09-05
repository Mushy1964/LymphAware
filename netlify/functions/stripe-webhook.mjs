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

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
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

async function patchOrder(orderId, values) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders('return=minimal'),
      body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
    }
  );
  if (!response.ok) console.error('Unable to update LymphAware order:', await response.text());
}

async function sendOrderNotification(order, session, items) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const orderRef = `LA-${String(order.order_number).padStart(6, '0')}`;
  if (!apiKey) {
    const error = 'RESEND_API_KEY is not configured.';
    await patchOrder(order.id, { notification_status: 'FAILED', notification_error: error, notification_sent_at: null });
    return { ok: false, error };
  }

  const to = String(process.env.ORDER_NOTIFICATION_EMAIL || 'admin@lymphaware.com').trim();
  const from = String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware <notifications@lymphaware.com>').trim();
  const itemLines = items.map((item) => {
    const language = item.language_name ? ` – ${item.language_name}` : '';
    return `${item.quantity} × ${item.description}${language}`;
  }).join('\n');

  const customerName = session.customer_details?.name || session.customer_email || 'Customer';
  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const totalPaid = `£${((session.amount_total || 0) / 100).toFixed(2)}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: ['admin@lymphaware.com'],
        subject: `New LymphAware order – ${orderRef}`,
        text:
          `A new LymphAware order has been paid and requires attention.\n\n` +
          `Order: ${orderRef}\nCustomer: ${customerName}\nEmail: ${customerEmail}\nTotal paid: ${totalPaid}\n\n` +
          `Items:\n${itemLines || 'No item detail recorded'}\n\n` +
          `Open LymphAware Administration to manage fulfilment:\nhttps://lymphaware.com/admin/orders/`
      })
    });

    if (!response.ok) {
      const error = await response.text();
      await patchOrder(order.id, { notification_status: 'FAILED', notification_error: error, notification_sent_at: null });
      return { ok: false, error };
    }

    const result = await response.json();
    await patchOrder(order.id, {
      notification_status: 'SENT',
      notification_error: null,
      notification_sent_at: new Date().toISOString()
    });
    return { ok: true, id: result?.id || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchOrder(order.id, { notification_status: 'FAILED', notification_error: message, notification_sent_at: null });
    return { ok: false, error: message };
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
  const missing = items
    .map(normaliseItem)
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

function buildInitialItems(packageType, languageCode, languageName) {
  if (packageType === 'PLUS') {
    return [
      normaliseItem({ item_type: 'MEMBERSHIP', description: 'LymphAware 5-Year Plus', quantity: 1, unit_price_pence: 3999, line_total_pence: 3999 }),
      normaliseItem({ item_type: 'EXTRA_CARD', description: 'Additional English ID Card – included in Plus package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 }),
      normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Additional Lanyard & Holder – included in Plus package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 })
    ];
  }

  if (packageType === 'MULTILINGUAL') {
    return [
      normaliseItem({ item_type: 'MEMBERSHIP', description: 'LymphAware 5-Year Multilingual', quantity: 1, unit_price_pence: 4999, line_total_pence: 4999 }),
      normaliseItem({ item_type: 'EXTRA_CARD', description: 'Second English ID Card – included in Multilingual package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 }),
      normaliseItem({
        item_type: 'LANGUAGE_PACKAGE',
        description: 'Multilingual translated ID Cards & QR Profile',
        quantity: 2,
        unit_price_pence: 0,
        line_total_pence: 0,
        language_code: languageCode,
        language_name: languageName
      }),
      normaliseItem({
        item_type: 'LANYARD_HOLDER',
        description: 'Translated-language Lanyard & Holder – included in Multilingual package',
        quantity: 1,
        unit_price_pence: 0,
        line_total_pence: 0,
        language_code: languageCode,
        language_name: languageName
      })
    ];
  }

  return [
    normaliseItem({ item_type: 'MEMBERSHIP', description: 'LymphAware 5-Year Membership', quantity: 1, unit_price_pence: 2999, line_total_pence: 2999 })
  ];
}

function buildAdditionalLanguageItems(languageCode, languageName) {
  return [
    normaliseItem({
      item_type: 'LANGUAGE_PACKAGE',
      description: 'Additional Language Package',
      quantity: 1,
      unit_price_pence: 1999,
      line_total_pence: 1999,
      language_code: languageCode,
      language_name: languageName
    }),
    normaliseItem({
      item_type: 'LANYARD_HOLDER',
      description: 'Lanyard & Holder – included in Additional Language Package',
      quantity: 1,
      unit_price_pence: 0,
      line_total_pence: 0,
      language_code: languageCode,
      language_name: languageName
    })
  ];
}

export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const payload = await request.text();
    const stripeSignature = request.headers.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!verifyStripeSignature(payload, stripeSignature, webhookSecret)) {
      return new Response('Invalid signature', { status: 400 });
    }

    const event = JSON.parse(payload);
    if (event.type !== 'checkout.session.completed') {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const session = event.data?.object;
    const userId = session?.metadata?.lymphaware_user_id;
    const membershipId = session?.metadata?.membership_id || null;
    const paymentType = String(session?.metadata?.payment_type || '').trim();

    if (!userId || !['initial_membership', 'additional_language'].includes(paymentType)) {
      return new Response('Invalid payment metadata', { status: 400 });
    }

    const completedPayment = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (!completedPayment) {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const paidAt = new Date();
    const packageType = String(session.metadata?.package_type || 'STANDARD').trim().toUpperCase();
    const languageName = String(session.metadata?.language_name || '').trim();
    const languageCode = String(session.metadata?.language_code || '').trim().toUpperCase();

    if (paymentType === 'initial_membership') {
      const membershipEnd = new Date(paidAt);
      membershipEnd.setUTCFullYear(membershipEnd.getUTCFullYear() + 5);
      const membershipResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: supabaseHeaders('return=minimal'),
          body: JSON.stringify({
            membership_status: 'ACTIVE',
            payment_status: 'PAID',
            payment_provider: 'STRIPE',
            payment_reference: session.id,
            paid_at: paidAt.toISOString(),
            membership_start: paidAt.toISOString(),
            membership_end: membershipEnd.toISOString(),
            updated_at: paidAt.toISOString()
          })
        }
      );
      if (!membershipResponse.ok) {
        console.error('Unable to update LymphAware membership:', await membershipResponse.text());
        return new Response('Membership update failed', { status: 500 });
      }
    }

    const items = paymentType === 'initial_membership'
      ? buildInitialItems(packageType, languageCode, languageName)
      : buildAdditionalLanguageItems(languageCode, languageName);

    const expectedSubtotal = items.reduce((sum, item) => sum + item.line_total_pence, 0);
    const shipping = session.collected_information?.shipping_details || session.shipping_details || null;
    const address = shipping?.address || session.customer_details?.address || {};
    const deliveryName = shipping?.name || session.customer_details?.name || null;

    const orderPayload = {
      user_id: userId,
      membership_id: membershipId,
      order_type: paymentType === 'initial_membership' ? 'INITIAL_MEMBERSHIP' : 'ADDITIONAL_LANGUAGE',
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
      paid_at: paidAt.toISOString(),
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
        console.error('Unable to create LymphAware order:', errorText);
        return new Response('Order creation failed', { status: 500 });
      }
      order = await getExistingOrder(session.id);
    }

    if (!order?.id) return new Response('Order could not be resolved', { status: 500 });

    const itemResult = await ensureOrderItems(order.id, items);
    if (!itemResult.ok) {
      console.error('Unable to create LymphAware order items:', itemResult.error);
      return new Response('Order item creation failed', { status: 500 });
    }

    if (order.notification_status !== 'SENT') await sendOrderNotification(order, session, items);

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return new Response('Webhook processing failed', { status: 500 });
  }
};

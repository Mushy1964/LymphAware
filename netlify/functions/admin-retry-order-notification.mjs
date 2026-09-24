import { verifyAdminRequest as verifyAdmin } from './_shared/admin-auth.mjs';
import { brandedEmailHtml } from './_shared/email-branding.mjs';
function serviceHeaders(prefer = '') {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function money(pence) {
  return `£${(Number(pence || 0) / 100).toFixed(2)}`;
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const admin = await verifyAdmin(request);
    if (!admin) {
      return new Response(JSON.stringify({ error: 'Administrator access required.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { orderId } = await request.json().catch(() => ({}));
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Order ID is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const [orderResponse, itemsResponse] = await Promise.all([
      fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, {
        headers: serviceHeaders()
      }),
      fetch(`${process.env.SUPABASE_URL}/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}&select=*&order=created_at.asc`, {
        headers: serviceHeaders()
      })
    ]);

    if (!orderResponse.ok) throw new Error(await orderResponse.text());
    if (!itemsResponse.ok) throw new Error(await itemsResponse.text());

    const order = (await orderResponse.json())?.[0];
    const items = await itemsResponse.json();
    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({ notification_status: 'FAILED', notification_error: 'RESEND_API_KEY is not configured.' })
      });
      return new Response(JSON.stringify({ error: 'Resend API key is not configured.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const orderRef = `ORD-${String(order.order_number).padStart(6, '0')}`;
    const itemLines = items.map(item => `${item.quantity} × ${item.description}`).join('\n');
    const to = String(process.env.ORDER_NOTIFICATION_EMAIL || 'admin@lymphawareid.com').trim();
    const from = String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware ID <notifications@lymphawareid.com>').trim();

    const subject = `New LymphAware ID order – ${orderRef}`;
    const emailText =
      `A new LymphAware ID membership order has been paid and requires attention.\n\n` +
      `Order: ${orderRef}\n` +
      `Customer: ${order.delivery_name || order.customer_email || 'Customer'}\n` +
      `Email: ${order.customer_email || ''}\n` +
      `Total paid: ${money(order.total_pence)}\n\n` +
      `Items:\n${itemLines || 'No item detail recorded'}\n\n` +
      `Open LymphAware ID Administration to manage fulfilment:\n` +
      `https://lymphawareid.com/admin/orders/`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: ['admin@lymphawareid.com'],
        subject,
        text: emailText,
        html: brandedEmailHtml({ title: subject, text: emailText })
      })
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({ notification_status: 'FAILED', notification_error: errorText.slice(0, 1000) })
      });
      return new Response(JSON.stringify({ error: 'Notification failed.', detail: errorText }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await resendResponse.json();
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({
        notification_status: 'SENT',
        notification_error: null,
        notification_sent_at: new Date().toISOString()
      })
    });

    return new Response(JSON.stringify({ sent: true, resendId: result?.id || null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Admin retry order notification error:', error);
    return new Response(JSON.stringify({ error: 'Unable to send order notification.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

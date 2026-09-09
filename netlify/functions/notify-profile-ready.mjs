function env(name) {
  return String(process.env[name] || '').trim();
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

async function verifyUser(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const accessToken = authHeader.slice('Bearer '.length).trim();
  if (!accessToken) return null;
  const response = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      apikey: env('SUPABASE_PUBLISHABLE_KEY'),
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) return null;
  return response.json();
}

async function patchOrder(orderId, values) {
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    headers: serviceHeaders('return=minimal'),
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Unable to update order notification status: ${await response.text()}`);
}

function orderReference(number) {
  return `ORD-${String(number || 0).padStart(6, '0')}`;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await verifyUser(request);
    if (!user?.id) return json({ error: 'Sign-in required.' }, 401);

    const profileResponse = await fetch(
      `${env('SUPABASE_URL')}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,display_name,lymphaware_id,photo_path&limit=1`,
      { headers: serviceHeaders() }
    );
    if (!profileResponse.ok) throw new Error(`Unable to load profile: ${await profileResponse.text()}`);
    const profile = (await profileResponse.json())?.[0];
    if (!profile?.display_name?.trim() || !profile?.photo_path?.trim()) {
      return json({ ok: true, ready: false, reason: 'Required card details are not complete.' });
    }

    const orderResponse = await fetch(
      `${env('SUPABASE_URL')}/rest/v1/orders?user_id=eq.${encodeURIComponent(user.id)}&order_type=eq.INITIAL_MEMBERSHIP&payment_status=eq.PAID&select=*&order=created_at.desc&limit=5`,
      { headers: serviceHeaders() }
    );
    if (!orderResponse.ok) throw new Error(`Unable to load membership order: ${await orderResponse.text()}`);
    const orders = await orderResponse.json();
    const order = orders.find(row => !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(String(row.order_status || '').toUpperCase()));
    if (!order) return json({ ok: true, ready: true, notification: 'not-applicable' });

    if (String(order.profile_ready_notification_status || '').toUpperCase() === 'SENT') {
      return json({ ok: true, ready: true, notification: 'already-sent' });
    }

    await patchOrder(order.id, {
      profile_ready_notification_status: 'SENDING',
      profile_ready_notification_error: null
    });

    const itemsResponse = await fetch(
      `${env('SUPABASE_URL')}/rest/v1/order_items?order_id=eq.${encodeURIComponent(order.id)}&select=description,quantity,language_name&order=created_at.asc`,
      { headers: serviceHeaders() }
    );
    const items = itemsResponse.ok ? await itemsResponse.json() : [];
    const itemLines = items.map(item => `• ${Math.max(1, Number(item.quantity || 1))} × ${item.description}${item.language_name ? ` – ${item.language_name}` : ''}`).join('\n');

    const apiKey = env('RESEND_API_KEY');
    const to = env('ORDER_NOTIFICATION_EMAIL') || 'admin@lymphaware.com';
    const from = env('ORDER_NOTIFICATION_FROM') || 'LymphAware <notifications@lymphaware.com>';
    if (!apiKey) {
      await patchOrder(order.id, {
        profile_ready_notification_status: 'FAILED',
        profile_ready_notification_error: 'RESEND_API_KEY is not configured.',
        profile_ready_notification_sent_at: null
      });
      return json({ error: 'Email delivery is not configured.' }, 500);
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `lymphaware-profile-ready-${order.id}`
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: ['admin@lymphaware.com'],
        subject: `LymphAware profile details ready for card production – ${profile.lymphaware_id || orderReference(order.order_number)}`,
        text:
          `A LymphAware member has now saved the two mandatory details needed for ID card production.\n\n` +
          `Order: ${orderReference(order.order_number)}\n` +
          `LymphAware ID: ${profile.lymphaware_id || 'Pending'}\n` +
          `Display name: ${profile.display_name}\n` +
          `Customer email: ${order.customer_email || user.email || ''}\n\n` +
          `Order contents:\n${itemLines || 'Membership order'}\n\n` +
          `The order will now appear at the appropriate stage in LymphAware Administration. If the order includes an additional language, that language version may still be preparing before the complete order is ready to print.\n\n` +
          `Open LymphAware Administration:\nhttps://lymphaware.com/admin/orders/`
      })
    });

    if (!response.ok) {
      const error = await response.text();
      await patchOrder(order.id, {
        profile_ready_notification_status: 'FAILED',
        profile_ready_notification_error: error,
        profile_ready_notification_sent_at: null
      });
      return json({ error: 'Profile-ready notification could not be sent.' }, 502);
    }

    await patchOrder(order.id, {
      profile_ready_notification_status: 'SENT',
      profile_ready_notification_error: null,
      profile_ready_notification_sent_at: new Date().toISOString()
    });

    return json({ ok: true, ready: true, notification: 'sent' });
  } catch (error) {
    console.error('Profile-ready notification error:', error);
    return json({ error: 'Unable to process the profile-ready notification.' }, 500);
  }
};

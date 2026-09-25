import { verifyAdminRequest } from './_shared/admin-auth.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function env(name) {
  return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || '').trim();
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

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const admin = await verifyAdminRequest(request);
  if (!admin) return json({ error: 'Administrator access required.' }, 403);

  try {
    const { order_id: orderId, component = 'letter' } = await request.json().catch(() => ({}));
    if (!orderId) return json({ error: 'Order ID required.' }, 400);
    if (!['letter', 'envelope'].includes(component)) {
      return json({ error: 'Unknown Welcome Pack component.' }, 400);
    }

    const base = env('SUPABASE_URL');
    const orderResponse = await fetch(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_type,order_status,welcome_letter_printed_at,welcome_envelope_printed_at&limit=1`,
      { headers: serviceHeaders() }
    );
    if (!orderResponse.ok) return json({ error: 'The order could not be checked.' }, 500);

    const order = (await orderResponse.json())?.[0];
    if (!order) return json({ error: 'Order not found.' }, 404);
    if (order.order_type !== 'INITIAL_MEMBERSHIP') {
      return json({ error: 'A Welcome Pack is not required for this order.' }, 400);
    }

    const now = new Date().toISOString();
    const field = component === 'envelope' ? 'welcome_envelope_printed_at' : 'welcome_letter_printed_at';
    const updateResponse = await fetch(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders('return=representation'),
        body: JSON.stringify({ [field]: now, updated_at: now })
      }
    );
    if (!updateResponse.ok) return json({ error: 'The Welcome Pack status could not be saved.' }, 500);

    return json({
      success: true,
      component,
      welcome_letter_printed_at: component === 'letter' ? now : order.welcome_letter_printed_at,
      welcome_envelope_printed_at: component === 'envelope' ? now : order.welcome_envelope_printed_at
    });
  } catch (error) {
    console.error('Welcome Pack print status error:', error);
    return json({ error: 'The Welcome Pack status could not be saved.' }, 500);
  }
};

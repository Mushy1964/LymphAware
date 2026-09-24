import { verifyAdminRequest } from './_shared/admin-auth.mjs';

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

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const admin = await verifyAdminRequest(request);
  if (!admin) return json({ error: 'Administrator access required.' }, 403);

  try {
    const { order_id: orderId } = await request.json().catch(() => ({}));
    if (!orderId) return json({ error: 'Order ID required.' }, 400);

    const base = env('SUPABASE_URL');
    const orderResponse = await fetch(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,user_id,membership_id,order_type,order_status,payment_status,total_pence&limit=1`,
      { headers: serviceHeaders() }
    );
    if (!orderResponse.ok) return json({ error: 'The order could not be checked.' }, 500);

    const order = (await orderResponse.json())?.[0];
    if (!order) return json({ error: 'Order not found.' }, 404);

    const status = String(order.order_status || '').toUpperCase();
    if (['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(status)) {
      return json({ error: 'This order is already closed.' }, 400);
    }

    if (!['PAID_AWAITING_PROFILE', 'READY_TO_PRINT'].includes(status)) {
      return json({ error: 'This test order has already entered production and cannot be cancelled here.' }, 400);
    }

    if (String(order.payment_status || '').toUpperCase() !== 'PAID' || Number(order.total_pence || 0) !== 0) {
      return json({ error: 'Only £0 private-trial orders can be cancelled with this action.' }, 400);
    }

    if (!order.membership_id) return json({ error: 'The trial membership could not be verified.' }, 400);

    const membershipResponse = await fetch(
      `${base}/rest/v1/memberships?id=eq.${encodeURIComponent(order.membership_id)}&select=id,membership_status&limit=1`,
      { headers: serviceHeaders() }
    );
    if (!membershipResponse.ok) return json({ error: 'The trial membership could not be checked.' }, 500);

    const membership = (await membershipResponse.json())?.[0];
    if (String(membership?.membership_status || '').toUpperCase() !== 'PILOT') {
      return json({ error: 'Only private-trial orders can be cancelled with this action.' }, 400);
    }

    const now = new Date().toISOString();
    const updateResponse = await fetch(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders('return=representation'),
        body: JSON.stringify({
          order_status: 'CANCELLED',
          cancelled_at: now,
          cancellation_reason: 'Private trial order cancelled by administrator',
          cancelled_by: admin.email,
          updated_at: now
        })
      }
    );
    if (!updateResponse.ok) return json({ error: 'The test order could not be cancelled.' }, 500);

    return json({
      success: true,
      order_number: order.order_number,
      cancelled_at: now,
      member_account_unchanged: true
    });
  } catch (error) {
    console.error('Cancel test order error:', error);
    return json({ error: 'The test order could not be cancelled.' }, 500);
  }
};

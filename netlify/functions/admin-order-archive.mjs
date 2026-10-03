import { verifyAdminRequest as verifyAdmin } from './_shared/admin-auth.mjs';

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders(prefer = '') {
  return {
    apikey: env('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${env('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function getOrder(orderId) {
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,order_status,membership_id,user_id,is_archived&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('The order could not be checked.');
  return (await response.json())?.[0] || null;
}

async function hasOpenCancellation(membershipId) {
  if (!membershipId) return false;
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/memberships?id=eq.${encodeURIComponent(membershipId)}&select=initial_cooling_off_cancellation_status&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('The membership could not be checked.');
  const membership = (await response.json())?.[0];
  return String(membership?.initial_cooling_off_cancellation_status || '').trim().toUpperCase() === 'REQUESTED';
}

async function saveArchiveState(orderId, payload) {
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=representation'),
      body: JSON.stringify(payload)
    }
  );
  if (!response.ok) throw new Error('The order history could not be updated.');
  return (await response.json())?.[0] || null;
}

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = await verifyAdmin(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    const body = await request.json().catch(() => ({}));
    const orderId = String(body.order_id || '').trim();
    const action = String(body.action || '').trim().toUpperCase();
    if (!orderId || !['ARCHIVE', 'RESTORE'].includes(action)) {
      return json({ error: 'Choose a valid order-history action.' }, 400);
    }

    const order = await getOrder(orderId);
    if (!order) return json({ error: 'Order not found.' }, 404);

    if (action === 'ARCHIVE') {
      if (!['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(String(order.order_status || '').toUpperCase())) {
        return json({ error: 'Only completed, cancelled or refunded orders can be archived.' }, 409);
      }
      if (await hasOpenCancellation(order.membership_id)) {
        return json({ error: 'This order still has a cancellation request requiring action and cannot be archived yet.' }, 409);
      }
      if (order.is_archived === true) return json({ order, unchanged: true });

      const archived = await saveArchiveState(orderId, {
        is_archived: true,
        archived_at: new Date().toISOString(),
        archive_reason: String(body.reason || 'Archived from Order Management after operational work was completed.').trim().slice(0, 500),
        archived_by: admin.email
      });
      return json({ order: archived, archived: true });
    }

    if (order.is_archived !== true) return json({ order, unchanged: true });
    const restored = await saveArchiveState(orderId, {
      is_archived: false,
      archived_at: null,
      archive_reason: null,
      archived_by: null
    });
    return json({ order: restored, restored: true });
  } catch (error) {
    console.error('Admin order archive error:', error);
    return json({ error: error instanceof Error ? error.message : 'The order history could not be updated.' }, 500);
  }
};

export const config = { path: '/api/admin-order-archive' };

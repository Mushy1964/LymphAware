async function verifyAdmin(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const accessToken = authHeader.replace('Bearer ', '').trim();
  const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  const adminEmail = String(process.env.LYMPHAWARE_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!user?.email || user.email.toLowerCase() !== adminEmail) return null;
  return user;
}

function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    Accept: 'application/json'
  };
}

export default async (request) => {
  if (request.method !== 'GET') {
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

    const ordersResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.desc&limit=100`,
      { headers: serviceHeaders() }
    );

    if (!ordersResponse.ok) {
      console.error('Unable to retrieve orders:', await ordersResponse.text());
      return new Response(JSON.stringify({ error: 'Orders could not be loaded.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const orders = await ordersResponse.json();
    if (!orders.length) {
      return new Response(JSON.stringify({ orders: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    const orderIds = orders.map(order => order.id).join(',');
    const userIds = [...new Set(orders.map(order => order.user_id))].join(',');

    const [itemsResponse, profilesResponse] = await Promise.all([
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/order_items?select=*&order_id=in.(${orderIds})&order=created_at.asc`,
        { headers: serviceHeaders() }
      ),
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles?select=user_id,display_name,lymphaware_id,photo_path,card_production_status,card_ready_at,card_printed_at&user_id=in.(${userIds})`,
        { headers: serviceHeaders() }
      )
    ]);

    const items = itemsResponse.ok ? await itemsResponse.json() : [];
    const profiles = profilesResponse.ok ? await profilesResponse.json() : [];

    const itemsByOrder = new Map();
    for (const item of items) {
      if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
      itemsByOrder.get(item.order_id).push(item);
    }

    const profileByUser = new Map(profiles.map(profile => [profile.user_id, profile]));

    const result = orders.map(order => {
      const profile = profileByUser.get(order.user_id) || null;
      const profileReady = Boolean(
        profile?.display_name?.trim() &&
        profile?.photo_path?.trim()
      );

      return {
        ...order,
        items: itemsByOrder.get(order.id) || [],
        profile,
        profile_ready: profileReady
      };
    });

    return new Response(JSON.stringify({ orders: result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Admin order list error:', error);
    return new Response(JSON.stringify({ error: 'Unable to load orders.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

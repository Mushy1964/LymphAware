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

    const [itemsResponse, profilesResponse, languageProfilesResponse] = await Promise.all([
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/order_items?select=*&order_id=in.(${orderIds})&order=created_at.asc`,
        { headers: serviceHeaders() }
      ),
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles?select=user_id,display_name,lymphaware_id,photo_path,card_production_status,card_ready_at,card_printed_at&user_id=in.(${userIds})`,
        { headers: serviceHeaders() }
      ),
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles?select=order_id,order_item_id,language_name,setup_status,card_production_status,card_printed_at&order_id=in.(${orderIds})`,
        { headers: serviceHeaders() }
      )
    ]);

    const items = itemsResponse.ok ? await itemsResponse.json() : [];
    const profiles = profilesResponse.ok ? await profilesResponse.json() : [];
    const languageProfiles = languageProfilesResponse.ok ? await languageProfilesResponse.json() : [];

    const itemsByOrder = new Map();
    for (const item of items) {
      if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
      itemsByOrder.get(item.order_id).push(item);
    }

    const profileByUser = new Map(profiles.map(profile => [profile.user_id, profile]));
    const languageProfilesByOrder = new Map();
    for (const profile of languageProfiles) {
      if (!languageProfilesByOrder.has(profile.order_id)) languageProfilesByOrder.set(profile.order_id, []);
      languageProfilesByOrder.get(profile.order_id).push(profile);
    }

    const result = orders.map(order => {
      const profile = profileByUser.get(order.user_id) || null;
      const orderItems = itemsByOrder.get(order.id) || [];
      const orderLanguageProfiles = languageProfilesByOrder.get(order.id) || [];
      const profileReady = Boolean(
        profile?.display_name?.trim() &&
        profile?.photo_path?.trim()
      );
      const needsPrimaryCard = orderItems.some(item => ['MEMBERSHIP', 'EXTRA_CARD'].includes(item.item_type));
      const languageItems = orderItems.filter(item => item.item_type === 'LANGUAGE_PACKAGE');
      const primaryCardPrinted = !needsPrimaryCard || profile?.card_production_status === 'PRINTED';
      const languageCardsPrinted = languageItems.every(item => orderLanguageProfiles.some(languageProfile => {
        const linkedItem = languageProfile.order_item_id && languageProfile.order_item_id === item.id;
        const sameLanguage = !languageProfile.order_item_id && languageProfile.language_name === item.language_name;
        return (linkedItem || sameLanguage) && languageProfile.card_production_status === 'PRINTED';
      }));
      const isClosed = ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(order.order_status);
      const readyToComplete = order.payment_status === 'PAID' && !isClosed && primaryCardPrinted && languageCardsPrinted;

      return {
        ...order,
        items: orderItems,
        profile,
        profile_ready: profileReady,
        language_profiles: orderLanguageProfiles,
        ready_to_complete: readyToComplete,
        completion_stage: isClosed
          ? 'COMPLETED'
          : !profileReady && needsPrimaryCard
            ? 'WAITING_FOR_CUSTOMER'
            : readyToComplete
              ? 'READY_TO_COMPLETE'
              : 'IN_PROGRESS'
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

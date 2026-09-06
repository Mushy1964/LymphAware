function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function env(name) {
  return Netlify.env.get(name);
}

function serviceHeaders(prefer) {
  return {
    apikey: env('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${env('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function requireAdmin(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const accessToken = authHeader.slice(7).trim();
  const response = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_PUBLISHABLE_KEY'), Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return false;
  const user = await response.json();
  return Boolean(user?.email && user.email.toLowerCase() === String(env('LYMPHAWARE_ADMIN_EMAIL') || '').trim().toLowerCase());
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!await requireAdmin(request)) return json({ error: 'Administrator access required.' }, 403);

  try {
    const { order_id: orderId } = await request.json();
    if (!orderId) return json({ error: 'Order ID required.' }, 400);

    const base = env('SUPABASE_URL');
    const headers = serviceHeaders();
    const orderResponse = await fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,user_id,order_status,payment_status&limit=1`, { headers });
    if (!orderResponse.ok) return json({ error: 'The order could not be checked.' }, 500);
    const order = (await orderResponse.json())?.[0];
    if (!order) return json({ error: 'Order not found.' }, 404);
    if (order.order_status === 'COMPLETED') return json({ success: true, already_completed: true });
    if (order.payment_status !== 'PAID' || ['CANCELLED', 'REFUNDED'].includes(order.order_status)) return json({ error: 'This order cannot be completed.' }, 400);

    const [itemsResponse, profileResponse, languagesResponse] = await Promise.all([
      fetch(`${base}/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}&select=id,item_type,language_name`, { headers }),
      fetch(`${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(order.user_id)}&select=card_production_status&limit=1`, { headers }),
      fetch(`${base}/rest/v1/language_profiles?user_id=eq.${encodeURIComponent(order.user_id)}&select=order_item_id,language_code,language_name,card_production_status`, { headers })
    ]);
    if (!itemsResponse.ok || !profileResponse.ok || !languagesResponse.ok) return json({ error: 'The order fulfilment could not be checked.' }, 500);

    const items = await itemsResponse.json();
    const primaryProfile = (await profileResponse.json())?.[0] || null;
    const languageProfiles = await languagesResponse.json();
    const needsPrimaryCard = items.some(item => item.item_type === 'MEMBERSHIP' || (item.item_type === 'EXTRA_CARD' && (!item.language_name || String(item.language_name).toLowerCase() === 'english')));
    const languageItems = items.filter(item => item.item_type === 'LANGUAGE_PACKAGE' || (item.item_type === 'EXTRA_CARD' && item.language_name && String(item.language_name).toLowerCase() !== 'english'));
    const primaryPrinted = !needsPrimaryCard || primaryProfile?.card_production_status === 'PRINTED';
    const languagesPrinted = languageItems.every(item => languageProfiles.some(profile => {
      const linkedItem = profile.order_item_id && profile.order_item_id === item.id;
      const sameLanguage = !profile.order_item_id && profile.language_name === item.language_name;
      return (linkedItem || sameLanguage) && profile.card_production_status === 'PRINTED';
    }));
    if (!primaryPrinted || !languagesPrinted) return json({ error: 'All required cards must be marked as printed before completing this order.' }, 400);

    const now = new Date().toISOString();
    const updateResponse = await fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({ order_status: 'COMPLETED', completed_at: now, updated_at: now })
    });
    if (!updateResponse.ok) return json({ error: 'The order could not be completed.' }, 500);
    return json({ success: true, completed_at: now });
  } catch (error) {
    console.error('Complete order error:', error);
    return json({ error: 'The order could not be completed.' }, 500);
  }
};

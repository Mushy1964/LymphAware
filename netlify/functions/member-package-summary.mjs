function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    Accept: 'application/json'
  };
}

async function getUser(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const accessToken = authHeader.replace('Bearer ', '').trim();
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

function packageFromItems(items) {
  const membership = items.find(item => item.item_type === 'MEMBERSHIP');
  const language = items.find(item => item.item_type === 'LANGUAGE_PACKAGE');
  const description = String(membership?.description || '');
  const languageName = String(language?.language_name || '').trim();

  if (description.includes('Multilingual')) {
    return {
      code: 'MULTILINGUAL',
      name: '5-Year Multilingual',
      language_name: languageName || null,
      included_summary: languageName
        ? `English + ${languageName} QR profiles · 2 English ID cards · 2 ${languageName} ID cards · 2 lanyards & holders`
        : '2 QR profiles · 2 English ID cards · 2 translated-language ID cards · 2 lanyards & holders'
    };
  }
  if (description.includes('Plus')) {
    return {
      code: 'PLUS',
      name: '5-Year Plus',
      language_name: null,
      included_summary: '1 English QR profile · 2 English ID cards · 2 lanyards & holders'
    };
  }
  return {
    code: 'STANDARD',
    name: '5-Year Membership',
    language_name: null,
    included_summary: '1 English QR profile · 1 English ID card · 1 lanyard & holder'
  };
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await getUser(request);
    if (!user) return json({ error: 'Authentication required.' }, 401);

    const ordersResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/orders?user_id=eq.${encodeURIComponent(user.id)}&payment_status=eq.PAID&select=id,order_type,paid_at&order=paid_at.asc`,
      { headers: serviceHeaders() }
    );
    if (!ordersResponse.ok) {
      console.error('Unable to load member orders:', await ordersResponse.text());
      return json({ error: 'Package information could not be loaded.' }, 500);
    }

    const orders = await ordersResponse.json();
    if (!orders?.length) return json({ package: null, additional_languages: [] });

    const orderIds = orders.map(order => order.id).filter(Boolean);
    const encodedIds = orderIds.map(id => encodeURIComponent(id)).join(',');
    const itemsResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/order_items?order_id=in.(${encodedIds})&select=id,order_id,item_type,description,quantity,language_code,language_name&order=created_at.asc`,
      { headers: serviceHeaders() }
    );
    if (!itemsResponse.ok) {
      console.error('Unable to load member order items:', await itemsResponse.text());
      return json({ error: 'Package information could not be loaded.' }, 500);
    }

    const items = await itemsResponse.json();
    const itemsByOrder = new Map();
    for (const item of items) {
      if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
      itemsByOrder.get(item.order_id).push(item);
    }

    const initialOrder = orders.find(order => order.order_type === 'INITIAL_MEMBERSHIP');
    const packageInfo = initialOrder ? packageFromItems(itemsByOrder.get(initialOrder.id) || []) : null;

    const extraLanguages = [];
    for (const order of orders.filter(order => ['LANGUAGE_PACKAGE', 'ADDITIONAL_LANGUAGE'].includes(order.order_type))) {
      const languageItem = (itemsByOrder.get(order.id) || []).find(item => item.item_type === 'LANGUAGE_PACKAGE');
      const languageName = String(languageItem?.language_name || '').trim();
      if (languageName && !extraLanguages.includes(languageName)) extraLanguages.push(languageName);
    }

    return json({ package: packageInfo, additional_languages: extraLanguages });
  } catch (error) {
    console.error('Member package summary error:', error);
    return json({ error: 'Package information could not be loaded.' }, 500);
  }
};

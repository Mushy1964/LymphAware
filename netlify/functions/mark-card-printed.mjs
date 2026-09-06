function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

async function requireAdmin(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: json({ error: 'Authentication required.' }, 401) };
  }

  const accessToken = authHeader.replace('Bearer ', '').trim();
  const userResponse = await fetch(`${Netlify.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      apikey: Netlify.env.get('SUPABASE_PUBLISHABLE_KEY'),
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!userResponse.ok) {
    return { error: json({ error: 'Unable to verify your account.' }, 401) };
  }

  const user = await userResponse.json();
  const adminEmail = String(Netlify.env.get('LYMPHAWARE_ADMIN_EMAIL') || '').trim().toLowerCase();
  if (!user?.email || user.email.toLowerCase() !== adminEmail) {
    return { error: json({ error: 'Administrator access required.' }, 403) };
  }

  return { user };
}

function serviceHeaders(prefer = '') {
  return {
    apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function completeReadyOrders(updatedRecord, recordType) {
  const base = Netlify.env.get('SUPABASE_URL');
  const headers = serviceHeaders();
  const orderFilter = recordType === 'LANGUAGE' && updatedRecord.order_id
    ? `id=eq.${encodeURIComponent(updatedRecord.order_id)}`
    : `user_id=eq.${encodeURIComponent(updatedRecord.user_id)}`;
  const ordersResponse = await fetch(
    `${base}/rest/v1/orders?${orderFilter}&payment_status=eq.PAID&order_status=in.(PAID_AWAITING_PROFILE,READY_TO_PRINT,IN_PRODUCTION,PRINTED)&select=id,user_id,order_number`,
    { headers }
  );
  if (!ordersResponse.ok) throw new Error(`Unable to check linked orders: ${await ordersResponse.text()}`);

  const completedOrders = [];
  for (const order of await ordersResponse.json()) {
    const [itemsResponse, profileResponse, languagesResponse] = await Promise.all([
      fetch(`${base}/rest/v1/order_items?order_id=eq.${encodeURIComponent(order.id)}&select=id,item_type,language_name`, { headers }),
      fetch(`${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(order.user_id)}&select=card_production_status&limit=1`, { headers }),
      fetch(`${base}/rest/v1/language_profiles?order_id=eq.${encodeURIComponent(order.id)}&select=order_item_id,language_name,card_production_status`, { headers })
    ]);
    if (!itemsResponse.ok || !profileResponse.ok || !languagesResponse.ok) throw new Error('Unable to check all required card records.');

    const items = await itemsResponse.json();
    const primaryProfile = (await profileResponse.json())?.[0] || null;
    const languageProfiles = await languagesResponse.json();
    const needsPrimaryCard = items.some(item => ['MEMBERSHIP', 'EXTRA_CARD'].includes(item.item_type));
    const languageItems = items.filter(item => item.item_type === 'LANGUAGE_PACKAGE');
    const primaryPrinted = !needsPrimaryCard || primaryProfile?.card_production_status === 'PRINTED';
    const languagesPrinted = languageItems.every(item => languageProfiles.some(profile => {
      const linkedItem = profile.order_item_id && profile.order_item_id === item.id;
      const sameLanguage = !profile.order_item_id && profile.language_name === item.language_name;
      return (linkedItem || sameLanguage) && profile.card_production_status === 'PRINTED';
    }));
    if (!primaryPrinted || !languagesPrinted) continue;

    const now = new Date().toISOString();
    const completionResponse = await fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
      method: 'PATCH',
      headers: serviceHeaders('return=representation'),
      body: JSON.stringify({ order_status: 'COMPLETED', completed_at: now, updated_at: now })
    });
    if (!completionResponse.ok) throw new Error(`Unable to complete linked order: ${await completionResponse.text()}`);
    const completed = await completionResponse.json();
    if (completed.length === 1) completedOrders.push({ id: order.id, order_number: order.order_number, completed_at: now });
  }
  return completedOrders;
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const profileId = String(body?.profile_id || '').trim();
    const recordType = String(body?.record_type || 'PRIMARY').trim().toUpperCase();

    if (!profileId) {
      return json({ error: 'Profile ID required.' }, 400);
    }

    const table = recordType === 'LANGUAGE' ? 'language_profiles' : 'profiles';
    const now = new Date().toISOString();

    const updateResponse = await fetch(
      `${Netlify.env.get('SUPABASE_URL')}/rest/v1/${table}?id=eq.${encodeURIComponent(profileId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
          Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          card_production_status: 'PRINTED',
          card_printed_at: now,
          updated_at: now
        })
      }
    );

    if (!updateResponse.ok) {
      console.error('Unable to mark card as printed:', await updateResponse.text());
      return json({ error: 'The card could not be marked as printed.' }, 500);
    }

    const updatedRecords = await updateResponse.json();
    if (!Array.isArray(updatedRecords) || updatedRecords.length !== 1) {
      console.error('Mark card printed did not update exactly one record:', { profileId, recordType, count: updatedRecords?.length });
      return json({ error: 'The card record was not updated. Please try again.' }, 409);
    }

    const completedOrders = await completeReadyOrders(updatedRecords[0], recordType);
    return json({ success: true, profile_id: profileId, record_type: recordType, card_printed_at: now, completed_orders: completedOrders });
  } catch (error) {
    console.error('Mark card printed error:', error);
    return json({ error: 'The card could not be marked as printed.' }, 500);
  }
};

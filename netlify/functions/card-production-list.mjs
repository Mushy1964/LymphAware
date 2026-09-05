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

async function requireAdmin(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: json({ error: 'Authentication required.' }, 401) };
  }

  const accessToken = authHeader.replace('Bearer ', '').trim();
  const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!userResponse.ok) {
    return { error: json({ error: 'Unable to verify your account.' }, 401) };
  }

  const user = await userResponse.json();
  const adminEmail = String(process.env.LYMPHAWARE_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!user?.email || user.email.toLowerCase() !== adminEmail) {
    return { error: json({ error: 'Administrator access required.' }, 403) };
  }

  return { user };
}

function formatOrderNumber(orderNumber) {
  if (orderNumber === null || orderNumber === undefined || orderNumber === '') return null;
  return `LA-${String(orderNumber).padStart(6, '0')}`;
}

export default async (request) => {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const headers = serviceHeaders();

    const [primaryResponse, languageResponse] = await Promise.all([
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?select=id,user_id,lymphaware_id,display_name,photo_path,qr_token,qr_profile_active,card_production_status,card_ready_at,card_prepared_at` +
        `&card_production_status=in.(READY,PREPARED)` +
        `&order=card_ready_at.asc`,
        { headers }
      ),
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles` +
        `?select=id,user_id,source_profile_id,order_id,order_item_id,language_code,language_name,qr_token,qr_profile_active,setup_status,card_production_status,card_ready_at,card_prepared_at` +
        `&setup_status=eq.APPROVED` +
        `&qr_profile_active=eq.true` +
        `&card_production_status=in.(READY,PREPARED)` +
        `&order=card_ready_at.asc`,
        { headers }
      )
    ]);

    if (!primaryResponse.ok || !languageResponse.ok) {
      if (!primaryResponse.ok) console.error('Unable to retrieve primary card jobs:', await primaryResponse.text());
      if (!languageResponse.ok) console.error('Unable to retrieve language card jobs:', await languageResponse.text());
      return json({ error: 'Card-production records could not be loaded.' }, 500);
    }

    const primaryProfiles = await primaryResponse.json();
    const languageProfiles = await languageResponse.json();

    const sourceProfileIds = [...new Set((languageProfiles || []).map(row => row.source_profile_id).filter(Boolean))];
    const sourceById = new Map();

    if (sourceProfileIds.length) {
      const encoded = sourceProfileIds.map(id => encodeURIComponent(id)).join(',');
      const sourceResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?select=id,user_id,lymphaware_id,display_name,photo_path` +
        `&id=in.(${encoded})`,
        { headers }
      );

      if (!sourceResponse.ok) {
        console.error('Unable to retrieve language source profiles:', await sourceResponse.text());
        return json({ error: 'Card-production records could not be loaded.' }, 500);
      }

      const sources = await sourceResponse.json();
      sources.forEach(source => sourceById.set(source.id, source));
    }

    const allUserIds = [...new Set([
      ...(primaryProfiles || []).map(row => row.user_id),
      ...(languageProfiles || []).map(row => row.user_id)
    ].filter(Boolean))];

    const fulfilmentByUser = new Map();
    const ordersById = new Map();
    const itemsByOrder = new Map();

    if (allUserIds.length) {
      const encodedUsers = allUserIds.map(id => encodeURIComponent(id)).join(',');
      const ordersResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/orders` +
        `?select=id,user_id,order_number,order_status,payment_status,created_at` +
        `&user_id=in.(${encodedUsers})` +
        `&payment_status=eq.PAID` +
        `&order_status=in.(PAID_AWAITING_PROFILE,READY_TO_PRINT,IN_PRODUCTION,PRINTED)` +
        `&order=created_at.asc`,
        { headers }
      );

      if (ordersResponse.ok) {
        const orders = await ordersResponse.json();
        orders.forEach(order => ordersById.set(order.id, order));

        const orderIds = orders.map(order => order.id).filter(Boolean);
        if (orderIds.length) {
          const encodedOrders = orderIds.map(id => encodeURIComponent(id)).join(',');
          const itemsResponse = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/order_items` +
            `?select=id,order_id,item_type,quantity,language_name` +
            `&order_id=in.(${encodedOrders})`,
            { headers }
          );

          if (itemsResponse.ok) {
            const items = await itemsResponse.json();
            items.forEach(item => {
              if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
              itemsByOrder.get(item.order_id).push(item);
            });
          } else {
            console.error('Unable to retrieve card-production order items:', await itemsResponse.text());
          }
        }

        orders.forEach(order => {
          if (!fulfilmentByUser.has(order.user_id)) {
            fulfilmentByUser.set(order.user_id, {
              order_numbers: [],
              card_copies: 0,
              lanyard_holders: 0,
              language_packages: []
            });
          }

          const fulfilment = fulfilmentByUser.get(order.user_id);
          const number = formatOrderNumber(order.order_number);
          if (number) fulfilment.order_numbers.push(number);

          const orderItems = itemsByOrder.get(order.id) || [];
          orderItems.forEach(item => {
            const quantity = Number(item.quantity || 0);
            if (item.item_type === 'MEMBERSHIP') {
              fulfilment.card_copies += quantity;
              fulfilment.lanyard_holders += quantity;
            } else if (item.item_type === 'EXTRA_CARD') {
              fulfilment.card_copies += quantity;
            } else if (item.item_type === 'LANYARD_HOLDER') {
              fulfilment.lanyard_holders += quantity;
            } else if (item.item_type === 'LANGUAGE_PACKAGE') {
              fulfilment.language_packages.push({
                language_name: item.language_name || 'Language not specified',
                quantity
              });
            }
          });
        });
      } else {
        console.error('Unable to retrieve card-production orders:', await ordersResponse.text());
      }
    }

    const activeLanguageKeys = new Set(
      (languageProfiles || []).map(row =>
        `${row.user_id || ''}|${String(row.language_name || '').trim().toLowerCase()}`
      )
    );

    const primaryJobs = (primaryProfiles || []).map(profile => {
      const baseFulfilment = fulfilmentByUser.get(profile.user_id) || {
        order_numbers: [],
        card_copies: 1,
        lanyard_holders: 1,
        language_packages: []
      };

      return {
        ...profile,
        record_type: 'PRIMARY',
        language_code: 'EN',
        language_name: 'English',
        fulfilment: {
          ...baseFulfilment,
          language_packages: (baseFulfilment.language_packages || []).map(item => ({
            ...item,
            setup_complete: activeLanguageKeys.has(
              `${profile.user_id || ''}|${String(item.language_name || '').trim().toLowerCase()}`
            )
          }))
        }
      };
    });

    const languageJobs = (languageProfiles || []).map(languageProfile => {
      const source = sourceById.get(languageProfile.source_profile_id) || {};
      const order = languageProfile.order_id ? ordersById.get(languageProfile.order_id) : null;
      const orderItems = languageProfile.order_id ? (itemsByOrder.get(languageProfile.order_id) || []) : [];
      const languageItem = languageProfile.order_item_id
        ? orderItems.find(item => item.id === languageProfile.order_item_id)
        : orderItems.find(item => item.item_type === 'LANGUAGE_PACKAGE' && (!item.language_name || item.language_name === languageProfile.language_name));
      const quantity = Math.max(1, Number(languageItem?.quantity || 1));
      const orderNumber = formatOrderNumber(order?.order_number);

      return {
        id: languageProfile.id,
        user_id: languageProfile.user_id,
        source_profile_id: languageProfile.source_profile_id,
        lymphaware_id: source.lymphaware_id || null,
        display_name: source.display_name || null,
        photo_path: source.photo_path || null,
        qr_token: languageProfile.qr_token,
        qr_profile_active: languageProfile.qr_profile_active,
        card_production_status: languageProfile.card_production_status,
        card_ready_at: languageProfile.card_ready_at,
        card_prepared_at: languageProfile.card_prepared_at,
        record_type: 'LANGUAGE',
        language_code: languageProfile.language_code,
        language_name: languageProfile.language_name,
        fulfilment: {
          order_numbers: orderNumber ? [orderNumber] : [],
          card_copies: quantity,
          lanyard_holders: quantity,
          language_packages: [{
            language_name: languageProfile.language_name,
            quantity
          }]
        }
      };
    });

    const jobs = [...primaryJobs, ...languageJobs].sort((a, b) => {
      const aTime = a.card_ready_at ? new Date(a.card_ready_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.card_ready_at ? new Date(b.card_ready_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

    return json({ profiles: jobs });
  } catch (error) {
    console.error('Card production list error:', error);
    return json({ error: 'Unable to load card-production records.' }, 500);
  }
};

export default async (request) => {

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();

    const userResponse = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!userResponse.ok) {
      return new Response(JSON.stringify({ error: 'Unable to verify your account.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await userResponse.json();
    const adminEmail = String(process.env.LYMPHAWARE_ADMIN_EMAIL || '')
      .trim()
      .toLowerCase();

    if (!user?.email || user.email.toLowerCase() !== adminEmail) {
      return new Response(JSON.stringify({ error: 'Administrator access required.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const serviceHeaders = {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      Accept: 'application/json'
    };

    /*
     * Show only cards that still need production action.
     * PRINTED cards are deliberately excluded.
     */
    const profileResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?select=id,user_id,lymphaware_id,display_name,photo_path,qr_token,qr_profile_active,card_production_status,card_ready_at,card_prepared_at` +
      `&card_production_status=in.(READY,PREPARED)` +
      `&order=card_ready_at.asc`,
      { headers: serviceHeaders }
    );

    if (!profileResponse.ok) {
      console.error('Unable to retrieve card-production records:', await profileResponse.text());
      return new Response(JSON.stringify({ error: 'Card-production records could not be loaded.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const profiles = await profileResponse.json();

    if (!profiles?.length) {
      return new Response(JSON.stringify({ profiles: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      });
    }

    const userIds = [...new Set(profiles.map(profile => profile.user_id).filter(Boolean))];
    const fulfilmentByUser = new Map();

    if (userIds.length) {
      const encodedUsers = userIds.map(id => encodeURIComponent(id)).join(',');

      const ordersResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/orders` +
        `?select=id,user_id,order_number,order_status,payment_status` +
        `&user_id=in.(${encodedUsers})` +
        `&payment_status=eq.PAID` +
        `&order_status=in.(PAID_AWAITING_PROFILE,READY_TO_PRINT,IN_PRODUCTION)` +
        `&order=created_at.asc`,
        { headers: serviceHeaders }
      );

      if (!ordersResponse.ok) {
        console.error('Unable to retrieve card-production orders:', await ordersResponse.text());
      } else {
        const orders = await ordersResponse.json();
        const orderIds = orders.map(order => order.id).filter(Boolean);
        let items = [];

        if (orderIds.length) {
          const encodedOrders = orderIds.map(id => encodeURIComponent(id)).join(',');
          const itemsResponse = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/order_items` +
            `?select=order_id,item_type,quantity,language_name` +
            `&order_id=in.(${encodedOrders})`,
            { headers: serviceHeaders }
          );

          if (!itemsResponse.ok) {
            console.error('Unable to retrieve card-production order items:', await itemsResponse.text());
          } else {
            items = await itemsResponse.json();
          }
        }

        const itemsByOrder = new Map();
        items.forEach(item => {
          if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
          itemsByOrder.get(item.order_id).push(item);
        });

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
          fulfilment.order_numbers.push(`LA-${String(order.order_number).padStart(6, '0')}`);

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
      }
    }

    const enrichedProfiles = profiles.map(profile => ({
      ...profile,
      fulfilment: fulfilmentByUser.get(profile.user_id) || {
        order_numbers: [],
        card_copies: 1,
        lanyard_holders: 1,
        language_packages: []
      }
    }));

    return new Response(JSON.stringify({ profiles: enrichedProfiles }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });

  } catch (error) {
    console.error('Card production list error:', error);
    return new Response(JSON.stringify({ error: 'Unable to load card-production records.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

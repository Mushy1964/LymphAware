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

    const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      return new Response(JSON.stringify({ error: 'Unable to verify your account.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await userResponse.json();
    const adminEmail = String(process.env.LYMPHAWARE_ADMIN_EMAIL || '').trim().toLowerCase();

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

    const languageResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/language_profiles?select=id,user_id,source_profile_id,order_id,order_item_id,language_code,language_name,setup_status,qr_profile_active,card_production_status,created_at,updated_at&order=created_at.asc`,
      { headers: serviceHeaders }
    );

    if (!languageResponse.ok) {
      console.error('Unable to retrieve language profiles:', await languageResponse.text());
      return new Response(JSON.stringify({ error: 'Language profile records could not be loaded.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const records = await languageResponse.json();

    if (!records?.length) {
      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    const profileIds = [...new Set(records.map((r) => r.source_profile_id).filter(Boolean))];
    const orderIds = [...new Set(records.map((r) => r.order_id).filter(Boolean))];

    const profilesById = new Map();
    if (profileIds.length) {
      const profileFilter = encodeURIComponent(`(${profileIds.join(',')})`);
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles?id=in.${profileFilter}&select=id,display_name,lymphaware_id,photo_path,qr_token`,
        { headers: serviceHeaders }
      );
      if (response.ok) {
        const rows = await response.json();
        rows.forEach((row) => profilesById.set(row.id, row));
      }
    }

    const ordersById = new Map();
    if (orderIds.length) {
      const orderFilter = encodeURIComponent(`(${orderIds.join(',')})`);
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/orders?id=in.${orderFilter}&select=id,order_number,order_status,payment_status,paid_at`,
        { headers: serviceHeaders }
      );
      if (response.ok) {
        const rows = await response.json();
        rows.forEach((row) => ordersById.set(row.id, row));
      }
    }

    const enriched = records.map((record) => ({
      ...record,
      source_profile: profilesById.get(record.source_profile_id) || null,
      order: ordersById.get(record.order_id) || null
    }));

    return new Response(JSON.stringify({ records: enriched }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Language profile admin list error:', error);
    return new Response(JSON.stringify({ error: 'Unable to load language profile records.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

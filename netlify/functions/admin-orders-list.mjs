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
        `${process.env.SUPABASE_URL}/rest/v1/profiles?select=id,user_id,display_name,lymphaware_id,photo_path,card_production_status,card_ready_at,card_prepared_at,card_printed_at&user_id=in.(${userIds})`,
        { headers: serviceHeaders() }
      ),
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles?select=id,user_id,order_id,order_item_id,language_code,language_name,setup_status,card_production_status,card_printed_at&user_id=in.(${userIds})`,
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
    const languageProfilesByUser = new Map();
    for (const profile of languageProfiles) {
      if (!languageProfilesByUser.has(profile.user_id)) languageProfilesByUser.set(profile.user_id, []);
      languageProfilesByUser.get(profile.user_id).push(profile);
    }

    const result = orders.map(order => {
      const profile = profileByUser.get(order.user_id) || null;
      const orderItems = itemsByOrder.get(order.id) || [];
      const userLanguageProfiles = languageProfilesByUser.get(order.user_id) || [];
      const profileReady = Boolean(
        profile?.display_name?.trim() &&
        profile?.photo_path?.trim()
      );
      const normaliseLanguage = value => String(value || '').trim().toLowerCase();
      const isEnglishCard = item =>
        item.item_type === 'EXTRA_CARD' &&
        (!normaliseLanguage(item.language_name) || normaliseLanguage(item.language_name) === 'english');
      const primaryCardItems = orderItems.filter(item =>
        item.item_type === 'MEMBERSHIP' || isEnglishCard(item)
      );
      const languageCardItems = orderItems.filter(item =>
        item.item_type === 'LANGUAGE_PACKAGE' ||
        (item.item_type === 'EXTRA_CARD' &&
          normaliseLanguage(item.language_name) &&
          normaliseLanguage(item.language_name) !== 'english')
      );
      const findLanguageProfile = item => {
        const itemLanguage = normaliseLanguage(item.language_name);
        return userLanguageProfiles.find(candidate =>
          candidate.order_item_id && candidate.order_item_id === item.id
        ) || userLanguageProfiles.find(candidate =>
          candidate.order_id === order.id &&
          normaliseLanguage(candidate.language_name) === itemLanguage
        ) || userLanguageProfiles.find(candidate =>
          normaliseLanguage(candidate.language_name) === itemLanguage
        ) || null;
      };
      const primaryQuantity = primaryCardItems.reduce(
        (sum, item) => sum + Math.max(0, Number(item.quantity || 0)),
        0
      );
      const productionJobs = [];
      if (primaryQuantity > 0) {
        productionJobs.push({
          record_type: 'PRIMARY',
          profile_id: profile?.id || null,
          language_code: 'EN',
          language_name: 'English',
          quantity: primaryQuantity,
          status: profileReady
            ? String(profile?.card_production_status || 'READY').toUpperCase()
            : 'WAITING_DETAILS'
        });
      }
      for (const item of languageCardItems) {
        const languageProfile = findLanguageProfile(item);
        productionJobs.push({
          record_type: 'LANGUAGE',
          profile_id: languageProfile?.id || null,
          order_item_id: item.id,
          language_code: languageProfile?.language_code || null,
          language_name: languageProfile?.language_name || item.language_name || 'Additional language',
          quantity: Math.max(1, Number(item.quantity || 1)),
          setup_status: languageProfile?.setup_status || null,
          status: languageProfile?.setup_status === 'APPROVED'
            ? String(languageProfile?.card_production_status || 'READY').toUpperCase()
            : 'WAITING_LANGUAGE'
        });
      }
      const lanyardQuantity = orderItems.reduce((sum, item) => {
        if (item.item_type === 'MEMBERSHIP') return sum + Math.max(0, Number(item.quantity || 0));
        if (item.item_type === 'LANYARD_HOLDER') return sum + Math.max(0, Number(item.quantity || 0));
        return sum;
      }, 0);
      const isClosed = ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(order.order_status);
      const waitingForDetails = productionJobs.some(job => job.status === 'WAITING_DETAILS');
      const waitingForLanguage = productionJobs.some(job => job.status === 'WAITING_LANGUAGE');
      const allCardsPrinted = productionJobs.length === 0 ||
        productionJobs.every(job => job.status === 'PRINTED');
      const printingStarted = productionJobs.some(job =>
        ['PREPARED', 'PRINTED'].includes(job.status)
      ) || order.order_status === 'IN_PRODUCTION';
      const readyToPack = order.payment_status === 'PAID' &&
        !isClosed &&
        (order.order_status === 'READY_TO_PACK' || allCardsPrinted);
      let workflowStage = 'WAITING';
      let workflowReason = 'Waiting for the information needed to prepare this order.';
      if (order.order_status === 'COMPLETED') {
        workflowStage = 'COMPLETED';
        workflowReason = 'This order has been dispatched and completed.';
      } else if (['CANCELLED', 'REFUNDED'].includes(order.order_status)) {
        workflowStage = 'CLOSED';
        workflowReason = 'This order is closed.';
      } else if (readyToPack) {
        workflowStage = 'READY_TO_DISPATCH';
        workflowReason = 'All required cards are printed. Pack the order and confirm dispatch.';
      } else if (waitingForDetails) {
        workflowStage = 'WAITING';
        workflowReason = 'Waiting for the customer to add their display name and photograph.';
      } else if (waitingForLanguage) {
        const language = productionJobs.find(job => job.status === 'WAITING_LANGUAGE')?.language_name;
        workflowStage = 'WAITING';
        workflowReason = `Waiting for the ${language || 'additional-language'} profile to be prepared.`;
      } else if (printingStarted) {
        workflowStage = 'PRINTING';
        workflowReason = 'Print and check every card, then mark each card as printed.';
      } else {
        workflowStage = 'READY_TO_PRINT';
        workflowReason = 'All required cards are ready to download for EasyBadge.';
      }
      return {
        ...order,
        items: orderItems,
        profile,
        profile_ready: profileReady,
        language_profiles: productionJobs
          .filter(job => job.record_type === 'LANGUAGE')
          .map(job => findLanguageProfile(
            languageCardItems.find(item => item.id === job.order_item_id) || {}
          ))
          .filter(Boolean),
        production_jobs: productionJobs,
        lanyard_quantity: lanyardQuantity,
        workflow_stage: workflowStage,
        workflow_reason: workflowReason,
        ready_to_complete: readyToPack,
        ready_to_pack: readyToPack,
        completion_stage: workflowStage
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

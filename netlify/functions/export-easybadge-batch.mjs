import { markLinkedOrdersInProduction } from './_shared/order-notifications.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function serviceHeaders(prefer = '') {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    Accept: 'application/json'
  };
  if (prefer) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = prefer;
  }
  return headers;
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
    return { error: json({ error: 'Unable to verify your LymphAware account.' }, 401) };
  }

  const user = await userResponse.json();
  const adminEmail = String(process.env.LYMPHAWARE_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!user?.email || user.email.toLowerCase() !== adminEmail) {
    return { error: json({ error: 'Administrator access required.' }, 403) };
  }

  return { user };
}

function csvValue(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function cardCopyForLanguage(languageCode) {
  const code = String(languageCode || '').trim().toUpperCase();

  if (code === 'EN') {
    return {
      patient_label: 'LYMPHOEDEMA PATIENT',
      qr_instruction: 'SCAN QR CODE to view my profile'
    };
  }

  if (code === 'FR') {
    return {
      patient_label: 'PATIENT ATTEINT DE LYMPHŒDÈME',
      qr_instruction: 'SCANNEZ LE CODE QR pour consulter mon profil'
    };
  }

  if (code === 'ES') {
    return {
      patient_label: 'PACIENTE CON LINFEDEMA',
      qr_instruction: 'ESCANEE EL CÓDIGO QR para ver mi perfil'
    };
  }

  if (code === 'DE') {
    return {
      patient_label: 'PATIENT MIT LYMPHÖDEM',
      qr_instruction: 'QR-CODE SCANNEN, um mein Profil anzusehen'
    };
  }

  return null;
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const headers = serviceHeaders();
    const body = await request.json().catch(() => ({}));
    const requestedOrderIds = new Set(
      (Array.isArray(body?.order_ids) ? body.order_ids : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    );

    const [primaryResponse, languageResponse] = await Promise.all([
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?select=id,user_id,lymphaware_id,display_name,qr_token,photo_path,card_ready_at` +
        `&card_production_status=eq.READY` +
        `&order=card_ready_at.asc`,
        { headers }
      ),
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles` +
        `?select=id,user_id,order_id,order_item_id,source_profile_id,language_code,language_name,qr_token,card_ready_at` +
        `&setup_status=eq.APPROVED` +
        `&card_production_status=eq.READY` +
        `&order=card_ready_at.asc`,
        { headers }
      )
    ]);

    if (!primaryResponse.ok || !languageResponse.ok) {
      if (!primaryResponse.ok) console.error('Unable to retrieve primary EasyBadge records:', await primaryResponse.text());
      if (!languageResponse.ok) console.error('Unable to retrieve language EasyBadge records:', await languageResponse.text());
      return json({ error: 'Unable to retrieve cards awaiting production.' }, 500);
    }

    const primaryProfiles = await primaryResponse.json();
    const languageProfiles = await languageResponse.json();

    const allUserIds = [...new Set([
      ...(primaryProfiles || []).map(row => row.user_id),
      ...(languageProfiles || []).map(row => row.user_id)
    ].filter(Boolean))];

    const primaryCopiesByUser = new Map();
    const orderIdsByUser = new Map();
    const itemById = new Map();

    if (allUserIds.length) {
      const encodedUsers = allUserIds.map(id => encodeURIComponent(id)).join(',');
      const requestedOrderFilter = requestedOrderIds.size
        ? `&id=in.(${[...requestedOrderIds].map(id => encodeURIComponent(id)).join(',')})`
        : '';

      const ordersResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/orders` +
        `?select=id,user_id` +
        `&user_id=in.(${encodedUsers})` +
        `&payment_status=eq.PAID` +
        `&order_status=in.(PAID_AWAITING_PROFILE,READY_TO_PRINT)` +
        requestedOrderFilter,
        { headers }
      );

      if (!ordersResponse.ok) {
        console.error('Unable to retrieve ready EasyBadge orders:', await ordersResponse.text());
        return json({ error: 'Unable to retrieve cards awaiting production.' }, 500);
      }

      const readyOrders = await ordersResponse.json();
      const orderById = new Map(readyOrders.map(order => [order.id, order]));
      for (const order of readyOrders) {
        if (!orderIdsByUser.has(order.user_id)) orderIdsByUser.set(order.user_id, []);
        orderIdsByUser.get(order.user_id).push(order.id);
      }
      const orderIds = readyOrders.map(order => order.id).filter(Boolean);

      if (orderIds.length) {
        const encodedOrders = orderIds.map(id => encodeURIComponent(id)).join(',');
        const itemsResponse = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/order_items` +
          `?select=id,order_id,item_type,quantity,language_name` +
          `&order_id=in.(${encodedOrders})`,
          { headers }
        );

        if (!itemsResponse.ok) {
          console.error('Unable to retrieve ready EasyBadge order items:', await itemsResponse.text());
          return json({ error: 'Unable to retrieve cards awaiting production.' }, 500);
        }

        const orderItems = await itemsResponse.json();
        for (const item of orderItems) {
          itemById.set(item.id, item);
          const order = orderById.get(item.order_id);
          if (!order) continue;

          const itemLanguage = String(item.language_name || '').trim().toLowerCase();
          const isEnglishCard =
            item.item_type === 'EXTRA_CARD' &&
            (!itemLanguage || itemLanguage === 'english');

          if (item.item_type === 'MEMBERSHIP' || isEnglishCard) {
            const quantity = Math.max(0, Number(item.quantity || 0));
            primaryCopiesByUser.set(
              order.user_id,
              Number(primaryCopiesByUser.get(order.user_id) || 0) + quantity
            );
          }
        }
      }
    }

    const sourceIds = [...new Set((languageProfiles || []).map(row => row.source_profile_id).filter(Boolean))];
    const sourceById = new Map();

    if (sourceIds.length) {
      const encodedIds = sourceIds.map(id => encodeURIComponent(id)).join(',');
      const sourceResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?select=id,lymphaware_id,display_name,photo_path` +
        `&id=in.(${encodedIds})`,
        { headers }
      );

      if (!sourceResponse.ok) {
        console.error('Unable to retrieve language source profiles for EasyBadge:', await sourceResponse.text());
        return json({ error: 'Unable to retrieve cards awaiting production.' }, 500);
      }

      const sources = await sourceResponse.json();
      sources.forEach(source => sourceById.set(source.id, source));
    }

    const jobs = [
      ...(primaryProfiles || []).map(profile => {
        const cardCopy = cardCopyForLanguage('EN');
        return {
          record_type: 'PRIMARY',
          record_id: profile.id,
          user_id: profile.user_id,
          order_id: null,
          order_ids: orderIdsByUser.get(profile.user_id) || [],
          lymphaware_id: profile.lymphaware_id,
          display_name: profile.display_name,
          qr_token: profile.qr_token,
          photo_path: profile.photo_path,
          language_code: 'EN',
          language_name: 'English',
          patient_label: cardCopy?.patient_label || null,
          qr_instruction: cardCopy?.qr_instruction || null,
          card_ready_at: profile.card_ready_at,
          quantity: Math.max(0, Number(primaryCopiesByUser.get(profile.user_id) || 0))
        };
      }),
      ...(languageProfiles || [])
        .filter(languageProfile => !requestedOrderIds.size || requestedOrderIds.has(String(languageProfile.order_id || '')))
        .map(languageProfile => {
        const source = sourceById.get(languageProfile.source_profile_id) || {};
        const cardCopy = cardCopyForLanguage(languageProfile.language_code);
        return {
          record_type: 'LANGUAGE',
          record_id: languageProfile.id,
          user_id: languageProfile.user_id,
          order_id: languageProfile.order_id,
          lymphaware_id: source.lymphaware_id,
          display_name: source.display_name,
          qr_token: languageProfile.qr_token,
          photo_path: source.photo_path,
          language_code: languageProfile.language_code,
          language_name: languageProfile.language_name,
          patient_label: cardCopy?.patient_label || null,
          qr_instruction: cardCopy?.qr_instruction || null,
          card_ready_at: languageProfile.card_ready_at,
          quantity: Math.max(1, Number(itemById.get(languageProfile.order_item_id)?.quantity || 1))
        };
      })
    ].filter(job => job.record_type === 'LANGUAGE' || job.quantity > 0).sort((a, b) => {
      const aTime = a.card_ready_at ? new Date(a.card_ready_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.card_ready_at ? new Date(b.card_ready_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

    if (!jobs.length) {
      return json({ error: 'There are currently no cards ready for EasyBadge.' }, 400);
    }

    const incomplete = jobs.find(job =>
      !job.lymphaware_id ||
      !job.display_name ||
      !job.qr_token ||
      !job.photo_path ||
      !job.patient_label ||
      !job.qr_instruction ||
      !job.language_code ||
      !job.language_name
    );

    if (incomplete) {
      return json({ error: 'One or more cards do not contain approved fixed wording or all information required for production.' }, 400);
    }

    const rows = [[
      'LymphAware ID',
      'Display Name',
      'QR Profile URL',
      'ImageURL',
      'Patient Label',
      'QR Instruction',
      'Language Code',
      'Card Language'
    ].join(',')];

    jobs.forEach(job => {
      const qrProfileUrl = `https://lymphaware.com/p/${job.qr_token}`;
      const imageUrl = `https://lymphaware.com/ebp/${job.qr_token}`;
      const copies = Math.max(1, Number(job.quantity || 1));

      for (let copy = 0; copy < copies; copy += 1) {
        rows.push([
          csvValue(job.lymphaware_id),
          csvValue(job.display_name),
          csvValue(qrProfileUrl),
          csvValue(imageUrl),
          csvValue(job.patient_label),
          csvValue(job.qr_instruction),
          csvValue(job.language_code),
          csvValue(job.language_name)
        ].join(','));
      }
    });

    const primaryIds = jobs.filter(job => job.record_type === 'PRIMARY').map(job => job.record_id);
    const languageIds = jobs.filter(job => job.record_type === 'LANGUAGE').map(job => job.record_id);

    const prepareResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/rpc/prepare_easybadge_batch`,
      {
        method: 'POST',
        headers: {
          ...serviceHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          primary_ids: primaryIds,
          language_ids: languageIds
        })
      }
    );

    if (!prepareResponse.ok) {
      console.error('Unable to prepare EasyBadge batch transactionally:', await prepareResponse.text());
      return json({ error: 'The EasyBadge batch could not be prepared. No card statuses were changed.' }, 500);
    }

    const linkedOrders = new Set();
    for (const job of jobs) {
      const jobOrderIds = Array.isArray(job.order_ids) && job.order_ids.length
        ? job.order_ids
        : [job.order_id || ''];

      for (const orderId of jobOrderIds) {
        const key = `${job.user_id || ''}:${orderId}`;
        if (linkedOrders.has(key)) continue;
        linkedOrders.add(key);
        try { await markLinkedOrdersInProduction(job.user_id, orderId); }
        catch (notificationError) { console.error('Production notification error:', notificationError); }
      }
    }

    const csv = rows.join('\r\n');

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="LymphAware_EasyBadge.csv"',
        'Cache-Control': 'no-store',
        'X-LymphAware-Card-Count': String(jobs.reduce((sum, job) => sum + Math.max(1, Number(job.quantity || 1)), 0))
      }
    });
  } catch (error) {
    console.error('Batch EasyBadge export error:', error);
    return json({ error: 'Unable to create the EasyBadge batch.' }, 500);
  }
};

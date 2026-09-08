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

async function primaryCardQuantity(userId, headers) {
  const ordersResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/orders` +
    `?select=id` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&payment_status=eq.PAID` +
    `&order_status=in.(PAID_AWAITING_PROFILE,READY_TO_PRINT)`,
    { headers }
  );

  if (!ordersResponse.ok) {
    throw new Error('Unable to retrieve ready card orders.');
  }

  const orders = await ordersResponse.json();
  const orderIds = orders.map(order => order.id).filter(Boolean);
  if (!orderIds.length) return 1;

  const encodedOrders = orderIds.map(id => encodeURIComponent(id)).join(',');
  const itemsResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/order_items` +
    `?select=item_type,quantity,language_name` +
    `&order_id=in.(${encodedOrders})`,
    { headers }
  );

  if (!itemsResponse.ok) {
    throw new Error('Unable to retrieve ready card quantities.');
  }

  const items = await itemsResponse.json();
  const quantity = items.reduce((sum, item) => {
    const itemLanguage = String(item.language_name || '').trim().toLowerCase();
    const isEnglishCard =
      item.item_type === 'EXTRA_CARD' &&
      (!itemLanguage || itemLanguage === 'english');

    return item.item_type === 'MEMBERSHIP' || isEnglishCard
      ? sum + Math.max(0, Number(item.quantity || 0))
      : sum;
  }, 0);

  return Math.max(1, quantity);
}

async function languageCardQuantity(orderItemId, headers) {
  if (!orderItemId) return 1;

  const itemResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/order_items` +
    `?id=eq.${encodeURIComponent(orderItemId)}` +
    `&select=quantity` +
    `&limit=1`,
    { headers }
  );

  if (!itemResponse.ok) {
    throw new Error('Unable to retrieve the language card quantity.');
  }

  const items = await itemResponse.json();
  return Math.max(1, Number(items?.[0]?.quantity || 1));
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const recordId = String(body?.profile_id || '').trim();
    const recordType = String(body?.record_type || 'PRIMARY').trim().toUpperCase();

    if (!recordId) {
      return json({ error: 'Profile ID required.' }, 400);
    }

    const headers = serviceHeaders();
    let job = null;
    let table = 'profiles';

    if (recordType === 'LANGUAGE') {
      table = 'language_profiles';
      const languageResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles` +
        `?id=eq.${encodeURIComponent(recordId)}` +
        `&select=id,user_id,order_id,order_item_id,source_profile_id,language_code,language_name,qr_token,setup_status,qr_profile_active,card_production_status` +
        `&limit=1`,
        { headers }
      );

      if (!languageResponse.ok) {
        console.error('Unable to retrieve language EasyBadge record:', await languageResponse.text());
        return json({ error: 'Unable to retrieve the card record.' }, 500);
      }

      const languageRows = await languageResponse.json();
      const languageProfile = languageRows?.[0];
      if (!languageProfile) return json({ error: 'The language card record could not be found.' }, 404);

      if (languageProfile.setup_status !== 'APPROVED') {
        return json({ error: 'The language profile must be ready before card production.' }, 400);
      }

      const sourceResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?id=eq.${encodeURIComponent(languageProfile.source_profile_id)}` +
        `&select=user_id,lymphaware_id,display_name,photo_path` +
        `&limit=1`,
        { headers }
      );

      if (!sourceResponse.ok) {
        console.error('Unable to retrieve language source profile:', await sourceResponse.text());
        return json({ error: 'Unable to retrieve the card record.' }, 500);
      }

      const sourceRows = await sourceResponse.json();
      const source = sourceRows?.[0] || {};

      job = {
        id: languageProfile.id,
        user_id: languageProfile.user_id || source.user_id,
        order_id: languageProfile.order_id,
        lymphaware_id: source.lymphaware_id,
        display_name: source.display_name,
        qr_token: languageProfile.qr_token,
        photo_path: source.photo_path,
        language_code: languageProfile.language_code,
        language_name: languageProfile.language_name,
        quantity: await languageCardQuantity(languageProfile.order_item_id, headers)
      };
    } else {
      const primaryResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?id=eq.${encodeURIComponent(recordId)}` +
        `&select=id,user_id,lymphaware_id,display_name,qr_token,photo_path` +
        `&limit=1`,
        { headers }
      );

      if (!primaryResponse.ok) {
        console.error('Unable to retrieve EasyBadge record:', await primaryResponse.text());
        return json({ error: 'Unable to retrieve the card record.' }, 500);
      }

      const rows = await primaryResponse.json();
      const profile = rows?.[0];
      job = profile ? {
        ...profile,
        language_code: 'EN',
        language_name: 'English',
        quantity: await primaryCardQuantity(profile.user_id, headers)
      } : null;
    }

    if (!job || !job.lymphaware_id || !job.display_name || !job.qr_token || !job.photo_path) {
      return json({ error: 'The profile does not contain all information required for card production.' }, 400);
    }

    const cardCopy = cardCopyForLanguage(job.language_code);
    if (!cardCopy) {
      return json({ error: 'Approved fixed card wording is not available for this language.' }, 400);
    }

    const qrProfileUrl = `https://lymphaware.com/p/${job.qr_token}`;
    const imageUrl = `https://lymphaware.com/ebp/${job.qr_token}`;

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

    const cardRow = [
      csvValue(job.lymphaware_id),
      csvValue(job.display_name),
      csvValue(qrProfileUrl),
      csvValue(imageUrl),
      csvValue(cardCopy.patient_label),
      csvValue(cardCopy.qr_instruction),
      csvValue(job.language_code),
      csvValue(job.language_name)
    ].join(',');

    const copies = Math.max(1, Number(job.quantity || 1));
    for (let copy = 0; copy < copies; copy += 1) rows.push(cardRow);
    const csv = rows.join('\r\n');

    const now = new Date().toISOString();
    const preparedResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(job.id)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({
          card_production_status: 'PREPARED',
          card_prepared_at: now,
          updated_at: now
        })
      }
    );

    if (!preparedResponse.ok) {
      console.error('Unable to mark card as prepared:', await preparedResponse.text());
      return json({ error: 'The EasyBadge file was created, but the card-production status could not be updated.' }, 500);
    }

    try { await markLinkedOrdersInProduction(job.user_id, job.order_id || ''); }
    catch (notificationError) { console.error('Production notification error:', notificationError); }

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="LymphAware_EasyBadge.csv"',
        'Cache-Control': 'no-store',
        'X-LymphAware-Card-Count': String(Math.max(1, Number(job.quantity || 1)))
      }
    });
  } catch (error) {
    console.error('Unable to create EasyBadge export:', error);
    return json({ error: 'Unable to create the EasyBadge export.' }, 500);
  }
};

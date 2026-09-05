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

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const headers = serviceHeaders();

    const [primaryResponse, languageResponse] = await Promise.all([
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?select=id,lymphaware_id,display_name,qr_token,photo_path,card_ready_at` +
        `&card_production_status=eq.READY` +
        `&order=card_ready_at.asc`,
        { headers }
      ),
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles` +
        `?select=id,source_profile_id,language_code,language_name,qr_token,card_ready_at` +
        `&setup_status=eq.APPROVED` +
        `&qr_profile_active=eq.true` +
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
      ...(primaryProfiles || []).map(profile => ({
        record_type: 'PRIMARY',
        record_id: profile.id,
        lymphaware_id: profile.lymphaware_id,
        display_name: profile.display_name,
        qr_token: profile.qr_token,
        photo_path: profile.photo_path,
        language_code: 'EN',
        language_name: 'English',
        card_ready_at: profile.card_ready_at
      })),
      ...(languageProfiles || []).map(languageProfile => {
        const source = sourceById.get(languageProfile.source_profile_id) || {};
        return {
          record_type: 'LANGUAGE',
          record_id: languageProfile.id,
          lymphaware_id: source.lymphaware_id,
          display_name: source.display_name,
          qr_token: languageProfile.qr_token,
          photo_path: source.photo_path,
          language_code: languageProfile.language_code,
          language_name: languageProfile.language_name,
          card_ready_at: languageProfile.card_ready_at
        };
      })
    ].sort((a, b) => {
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
      !job.language_code ||
      !job.language_name
    );

    if (incomplete) {
      return json({ error: 'One or more cards do not contain all information required for production.' }, 400);
    }

    const rows = [[
      'LymphAware ID',
      'Display Name',
      'QR Profile URL',
      'ImageURL',
      'Language Code',
      'Card Language'
    ].join(',')];

    jobs.forEach(job => {
      const qrProfileUrl = `https://lymphaware.com/p/${job.qr_token}`;
      const imageUrl = `https://lymphaware.com/ebp/${job.qr_token}`;
      rows.push([
        csvValue(job.lymphaware_id),
        csvValue(job.display_name),
        csvValue(qrProfileUrl),
        csvValue(imageUrl),
        csvValue(job.language_code),
        csvValue(job.language_name)
      ].join(','));
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

    const csv = rows.join('\r\n');

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="LymphAware_EasyBadge.csv"',
        'Cache-Control': 'no-store',
        'X-LymphAware-Card-Count': String(jobs.length)
      }
    });
  } catch (error) {
    console.error('Batch EasyBadge export error:', error);
    return json({ error: 'Unable to create the EasyBadge batch.' }, 500);
  }
};

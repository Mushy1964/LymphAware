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
        `?select=id,lymphaware_id,display_name,card_printed_at` +
        `&card_production_status=eq.PRINTED` +
        `&order=card_printed_at.desc` +
        `&limit=20`,
        { headers }
      ),
      fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles` +
        `?select=id,source_profile_id,language_code,language_name,card_printed_at` +
        `&card_production_status=eq.PRINTED` +
        `&order=card_printed_at.desc` +
        `&limit=20`,
        { headers }
      )
    ]);

    if (!primaryResponse.ok || !languageResponse.ok) {
      if (!primaryResponse.ok) console.error('Unable to retrieve primary card history:', await primaryResponse.text());
      if (!languageResponse.ok) console.error('Unable to retrieve language card history:', await languageResponse.text());
      return json({ error: 'Printed-card history could not be loaded.' }, 500);
    }

    const primaryRows = await primaryResponse.json();
    const languageRows = await languageResponse.json();

    const sourceIds = [...new Set((languageRows || []).map(row => row.source_profile_id).filter(Boolean))];
    const sourceById = new Map();

    if (sourceIds.length) {
      const encoded = sourceIds.map(id => encodeURIComponent(id)).join(',');
      const sourceResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?select=id,lymphaware_id,display_name` +
        `&id=in.(${encoded})`,
        { headers }
      );

      if (sourceResponse.ok) {
        const sources = await sourceResponse.json();
        sources.forEach(source => sourceById.set(source.id, source));
      } else {
        console.error('Unable to retrieve language history source profiles:', await sourceResponse.text());
      }
    }

    const primaryHistory = (primaryRows || []).map(row => ({
      ...row,
      record_type: 'PRIMARY',
      language_code: 'EN',
      language_name: 'English'
    }));

    const languageHistory = (languageRows || []).map(row => {
      const source = sourceById.get(row.source_profile_id) || {};
      return {
        id: row.id,
        lymphaware_id: source.lymphaware_id || null,
        display_name: source.display_name || null,
        card_printed_at: row.card_printed_at,
        record_type: 'LANGUAGE',
        language_code: row.language_code,
        language_name: row.language_name
      };
    });

    const profiles = [...primaryHistory, ...languageHistory]
      .sort((a, b) => new Date(b.card_printed_at || 0).getTime() - new Date(a.card_printed_at || 0).getTime())
      .slice(0, 20);

    return json({ profiles });
  } catch (error) {
    console.error('Card history error:', error);
    return json({ error: 'Printed-card history could not be loaded.' }, 500);
  }
};

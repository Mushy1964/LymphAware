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

    return json({ success: true, profile_id: profileId, record_type: recordType, card_printed_at: now });
  } catch (error) {
    console.error('Mark card printed error:', error);
    return json({ error: 'The card could not be marked as printed.' }, 500);
  }
};

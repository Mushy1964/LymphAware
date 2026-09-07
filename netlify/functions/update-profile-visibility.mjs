function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function serviceHeaders(prefer = '') {
  const secret = env('SUPABASE_SECRET_KEY');
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const accessToken = authHeader.slice(7).trim();
    const userResponse = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
      headers: {
        apikey: env('SUPABASE_PUBLISHABLE_KEY'),
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!userResponse.ok) return json({ error: 'Your account could not be verified.' }, 401);
    const user = await userResponse.json();
    if (!user?.id) return json({ error: 'Your account could not be verified.' }, 401);

    const body = await request.json().catch(() => ({}));
    if (typeof body.visible !== 'boolean') return json({ error: 'A visibility choice is required.' }, 400);
    const now = new Date().toISOString();
    const headers = serviceHeaders('return=minimal');

    const profileResponse = await fetch(
      `${env('SUPABASE_URL')}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ qr_profile_active: body.visible, updated_at: now })
      }
    );
    if (!profileResponse.ok) throw new Error('The English profile visibility could not be changed.');

    const languageResponse = await fetch(
      `${env('SUPABASE_URL')}/rest/v1/language_profiles?user_id=eq.${encodeURIComponent(user.id)}&setup_status=eq.APPROVED`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ qr_profile_active: body.visible, updated_at: now })
      }
    );
    if (!languageResponse.ok) throw new Error('The additional-language profile visibility could not be changed.');

    return json({ success: true, visible: body.visible });
  } catch (error) {
    console.error('Profile visibility update error:', error);
    return json({ error: 'Your QR profile visibility could not be changed. Please try again.' }, 500);
  }
};

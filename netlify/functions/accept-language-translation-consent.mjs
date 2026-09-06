function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders(prefer = '') {
  const secret = env('SUPABASE_SECRET_KEY');
  const headers = {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
  const accessToken = authHeader.slice(7).trim();
  const supabaseUrl = env('SUPABASE_URL');
  const publishableKey = env('SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !publishableKey || !env('SUPABASE_SECRET_KEY')) {
    return json({ error: 'The service is not configured.' }, 500);
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` }
  });
  if (!userResponse.ok) return json({ error: 'Unable to verify your account.' }, 401);
  const user = await userResponse.json();

  const body = await request.json().catch(() => ({}));
  const languageProfileId = String(body?.languageProfileId || '').trim();
  const explicitConsent = body?.explicitConsent === true;
  if (!languageProfileId || !explicitConsent) {
    return json({ error: 'Explicit agreement is required.' }, 400);
  }

  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/language_profiles?id=eq.${encodeURIComponent(languageProfileId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!profileResponse.ok) return json({ error: 'Unable to verify the language profile.' }, 500);
  const languageProfile = (await profileResponse.json())?.[0];
  if (!languageProfile?.id) return json({ error: 'Language profile not found.' }, 404);

  const consentAt = new Date().toISOString();
  const updateResponse = await fetch(
    `${supabaseUrl}/rest/v1/language_profiles?id=eq.${encodeURIComponent(languageProfile.id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({ translation_consent_at: consentAt, updated_at: consentAt })
    }
  );
  if (!updateResponse.ok) return json({ error: 'Unable to record your agreement.' }, 500);
  return json({ accepted: true, consentAt });
};

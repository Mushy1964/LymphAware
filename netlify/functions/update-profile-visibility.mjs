function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const accessToken = authHeader.slice(7).trim();
    const supabaseUrl = env('SUPABASE_URL');
    const publishableKey = env('SUPABASE_PUBLISHABLE_KEY');
    if (!supabaseUrl || !publishableKey) {
      return json({ error: 'The service is not configured.' }, 500);
    }

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!userResponse.ok) return json({ error: 'Your account could not be verified.' }, 401);
    const user = await userResponse.json();
    if (!user?.id) return json({ error: 'Your account could not be verified.' }, 401);

    const body = await request.json().catch(() => ({}));
    if (typeof body.visible !== 'boolean') return json({ error: 'A visibility choice is required.' }, 400);

    const currentProfileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,display_name,photo_path,qr_profile_active`,
      {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      }
    );

    if (!currentProfileResponse.ok) {
      const detail = await currentProfileResponse.text().catch(() => '');
      console.error('Profile visibility readiness check failed:', currentProfileResponse.status, detail);
      return json({ error: 'Your profile details could not be checked. Please try again.' }, 500);
    }

    const currentProfiles = await currentProfileResponse.json().catch(() => []);
    const currentProfile = currentProfiles.find((profile) => profile?.user_id === user.id);
    if (!currentProfile) {
      return json({ error: 'Your profile could not be found. Please sign in again.' }, 409);
    }

    if (body.visible) {
      const missing = [];
      if (!String(currentProfile.display_name || '').trim()) missing.push('display name');
      if (!String(currentProfile.photo_path || '').trim()) missing.push('photograph');

      if (missing.length) {
        const missingDetails = missing.length === 2
          ? 'your display name and photograph'
          : `your ${missing[0]}`;
        return json({
          error: `Your QR profiles cannot be shown yet. Add ${missingDetails} using Edit my profile, then try again.`,
          code: 'PROFILE_INCOMPLETE',
          missing
        }, 422);
      }
    }

    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=user_id,qr_profile_active`,
      {
        method: 'PATCH',
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          qr_profile_active: body.visible,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!profileResponse.ok) {
      const detail = await profileResponse.text().catch(() => '');
      console.error('Profile visibility database update failed:', profileResponse.status, detail);
      throw new Error('Profile visibility database update failed.');
    }

    const updatedProfiles = await profileResponse.json().catch(() => []);
    if (!updatedProfiles.some((profile) => profile?.user_id === user.id)) {
      return json({ error: 'Your profile could not be found or updated. Please sign in again.' }, 409);
    }

    return json({ success: true, visible: body.visible });
  } catch (error) {
    console.error('Profile visibility update error:', error);
    return json({ error: 'Your QR profile visibility could not be changed. Please try again.' }, 500);
  }
};

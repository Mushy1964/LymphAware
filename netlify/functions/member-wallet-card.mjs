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
    apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json'
  };
}

async function getUser(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const accessToken = authHeader.replace('Bearer ', '').trim();
  const response = await fetch(`${Netlify.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      apikey: Netlify.env.get('SUPABASE_PUBLISHABLE_KEY'),
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

function membershipIsCurrent(membership) {
  if (!membership) return false;
  const status = String(membership.membership_status || '').toUpperCase();
  const paymentStatus = String(membership.payment_status || '').toUpperCase();
  const statusEntitled =
    (status === 'ACTIVE' && paymentStatus === 'PAID') ||
    status === 'PILOT' ||
    status === 'SPONSORED';

  if (!statusEntitled) return false;
  if (!membership.membership_end) return true;

  const end = new Date(membership.membership_end).getTime();
  return Number.isFinite(end) && end > Date.now();
}

function walletPackageEligible(packageType) {
  return ['PLUS', 'MULTILINGUAL'].includes(String(packageType || '').toUpperCase());
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await getUser(request);
    if (!user) return json({ error: 'Authentication required.' }, 401);

    const membershipResponse = await fetch(
      `${Netlify.env.get('SUPABASE_URL')}/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}&select=membership_status,payment_status,package_type,membership_end&limit=1`,
      { headers: serviceHeaders() }
    );
    if (!membershipResponse.ok) return json({ error: 'Membership information could not be loaded.' }, 500);
    const membership = (await membershipResponse.json())?.[0] || null;

    if (!membershipIsCurrent(membership)) {
      return json({ eligible: false, reason: 'MEMBERSHIP_INACTIVE' });
    }
    if (!walletPackageEligible(membership.package_type)) {
      return json({ eligible: false, reason: 'PACKAGE_NOT_ELIGIBLE', package_type: membership.package_type || null });
    }

    const profileResponse = await fetch(
      `${Netlify.env.get('SUPABASE_URL')}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=display_name,lymphaware_id,qr_token,qr_profile_active,photo_path,is_archived&limit=1`,
      { headers: serviceHeaders() }
    );
    if (!profileResponse.ok) return json({ error: 'Profile information could not be loaded.' }, 500);
    const profile = (await profileResponse.json())?.[0] || null;

    if (!profile || profile.is_archived === true) {
      return json({ eligible: false, reason: 'PROFILE_UNAVAILABLE' });
    }

    const missing = [];
    if (!String(profile.display_name || '').trim()) missing.push('display_name');
    if (!String(profile.lymphaware_id || '').trim()) missing.push('lymphaware_id');
    if (!String(profile.qr_token || '').trim()) missing.push('qr_token');
    if (!String(profile.photo_path || '').trim()) missing.push('photo');

    if (missing.length) {
      return json({ eligible: false, reason: 'PROFILE_INCOMPLETE', missing });
    }

    const token = String(profile.qr_token);
    return json({
      eligible: true,
      package_type: String(membership.package_type || '').toUpperCase(),
      membership_end: membership.membership_end || null,
      display_name: profile.display_name,
      lymphaware_id: profile.lymphaware_id,
      qr_profile_active: profile.qr_profile_active === true,
      profile_url: `https://lymphawareid.com/p/${encodeURIComponent(token)}`,
      photo_url: `https://lymphawareid.com/ebp/${encodeURIComponent(token)}`
    });
  } catch (error) {
    console.error('Member Wallet card error:', error);
    return json({ error: 'Your digital LymphAware ID could not be prepared.' }, 500);
  }
};

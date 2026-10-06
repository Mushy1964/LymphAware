const SITE_URL = 'https://lymphawareid.com';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders() {
  return {
    apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json'
  };
}

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

export function normalisePem(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

export function walletProviderReadiness() {
  const apple = Boolean(
    env('APPLE_WALLET_PASS_TYPE_ID') &&
    env('APPLE_WALLET_TEAM_ID') &&
    env('APPLE_WALLET_SIGNER_CERT_PEM') &&
    env('APPLE_WALLET_SIGNER_KEY_PEM') &&
    env('APPLE_WALLET_WWDR_CERT_PEM')
  );

  const googleApproved = env('GOOGLE_WALLET_PRIVATE_PASS_APPROVED').toLowerCase() === 'true';
  const google = Boolean(
    googleApproved &&
    env('GOOGLE_WALLET_ISSUER_ID') &&
    env('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL') &&
    env('GOOGLE_WALLET_PRIVATE_KEY_PEM')
  );

  return {
    apple: {
      available: apple,
      configured: apple
    },
    google: {
      available: google,
      configured: Boolean(
        env('GOOGLE_WALLET_ISSUER_ID') &&
        env('GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL') &&
        env('GOOGLE_WALLET_PRIVATE_KEY_PEM')
      ),
      private_pass_approved: googleApproved
    }
  };
}

async function getUser(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const accessToken = authHeader.slice(7).trim();
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

export function safeWalletIdentifier(value) {
  return String(value || 'member')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'member';
}

export function formatExpiryDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

export async function loadWalletMember(request) {
  const user = await getUser(request);
  if (!user) return { response: json({ error: 'Authentication required.' }, 401) };

  const membershipResponse = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}&select=id,membership_status,payment_status,package_type,membership_end,membership_term_years&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!membershipResponse.ok) {
    return { response: json({ error: 'Membership information could not be loaded.' }, 500) };
  }
  const membership = (await membershipResponse.json())?.[0] || null;

  if (!membershipIsCurrent(membership)) {
    return { response: json({ eligible: false, reason: 'MEMBERSHIP_INACTIVE' }) };
  }
  if (!walletPackageEligible(membership.package_type)) {
    return { response: json({ eligible: false, reason: 'PACKAGE_NOT_ELIGIBLE', package_type: membership.package_type || null }) };
  }

  const profileResponse = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,display_name,lymphaware_id,qr_token,qr_profile_active,photo_path,is_archived&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!profileResponse.ok) {
    return { response: json({ error: 'Profile information could not be loaded.' }, 500) };
  }
  const profile = (await profileResponse.json())?.[0] || null;

  if (!profile || profile.is_archived === true) {
    return { response: json({ eligible: false, reason: 'PROFILE_UNAVAILABLE' }) };
  }

  const missing = [];
  if (!String(profile.display_name || '').trim()) missing.push('display_name');
  if (!String(profile.lymphaware_id || '').trim()) missing.push('lymphaware_id');
  if (!String(profile.qr_token || '').trim()) missing.push('qr_token');
  if (!String(profile.photo_path || '').trim()) missing.push('photo');
  if (!membership.membership_end) missing.push('membership_end');

  if (missing.length) {
    return { response: json({ eligible: false, reason: 'PROFILE_INCOMPLETE', missing }) };
  }

  const token = String(profile.qr_token);
  return {
    user,
    membership,
    profile,
    card: {
      package_type: String(membership.package_type || '').toUpperCase(),
      membership_end: membership.membership_end,
      expiry_label: formatExpiryDate(membership.membership_end),
      display_name: String(profile.display_name),
      lymphaware_id: String(profile.lymphaware_id),
      qr_profile_active: profile.qr_profile_active === true,
      profile_url: `${SITE_URL}/p/${encodeURIComponent(token)}`,
      photo_url: `${SITE_URL}/ebp/${encodeURIComponent(token)}`
    }
  };
}

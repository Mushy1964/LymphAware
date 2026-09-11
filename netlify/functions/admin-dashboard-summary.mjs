function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function serviceHeaders(range) {
  return {
    apikey: env('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${env('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json',
    ...(range ? { Range: range } : {})
  };
}

async function verifyAdmin(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const accessToken = authHeader.slice(7).trim();
  const response = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      apikey: env('SUPABASE_PUBLISHABLE_KEY'),
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) return null;
  const user = await response.json();
  const adminEmail = env('LYMPHAWARE_ADMIN_EMAIL').toLowerCase();
  return user?.email && user.email.toLowerCase() === adminEmail ? user : null;
}

async function fetchAll(path) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(`${env('SUPABASE_URL')}${path}`, {
      headers: serviceHeaders(`${offset}-${offset + pageSize - 1}`)
    });
    if (!response.ok) throw new Error('Administration figures could not be retrieved.');
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function hasPortalEntitlement(membership) {
  return (
    (membership.membership_status === 'ACTIVE' && membership.payment_status === 'PAID') ||
    membership.membership_status === 'PILOT' ||
    membership.membership_status === 'SPONSORED'
  );
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = await verifyAdmin(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    const [memberships, profiles, languageProfiles] = await Promise.all([
      fetchAll('/rest/v1/memberships?select=user_id,membership_status,payment_status'),
      fetchAll('/rest/v1/profiles?select=user_id,display_name,photo_path,qr_profile_active,is_archived'),
      fetchAll('/rest/v1/language_profiles?select=user_id,setup_status')
    ]);

    const entitledByUser = new Map();
    for (const membership of memberships) {
      if (membership.user_id && hasPortalEntitlement(membership)) {
        entitledByUser.set(membership.user_id, membership);
      }
    }

    const archivedUserIds = new Set(
      profiles.filter(profile => profile.is_archived === true).map(profile => profile.user_id)
    );
    const activeUserIds = new Set(
      [...entitledByUser.keys()].filter(userId => !archivedUserIds.has(userId))
    );
    const profilesByUser = new Map(profiles.map(profile => [profile.user_id, profile]));
    let visibleProfiles = 0;
    let profilesNeedingDetails = 0;

    for (const userId of activeUserIds) {
      const profile = profilesByUser.get(userId);
      if (profile?.qr_profile_active === true) visibleProfiles += 1;
      if (!profile || !String(profile.display_name || '').trim() || !String(profile.photo_path || '').trim()) {
        profilesNeedingDetails += 1;
      }
    }

    const paidMembers = [...entitledByUser.values()].filter(
      membership => membership.membership_status === 'ACTIVE' && membership.payment_status === 'PAID'
    ).length;
    const pilotSponsoredMembers = [...entitledByUser.values()].filter(
      membership => ['PILOT', 'SPONSORED'].includes(membership.membership_status)
    ).length;
    const approvedLanguageProfiles = languageProfiles.filter(
      profile => activeUserIds.has(profile.user_id) && profile.setup_status === 'APPROVED'
    ).length;

    return json({
      summary: {
        active_members: activeUserIds.size,
        paid_members: paidMembers,
        pilot_sponsored_members: pilotSponsoredMembers,
        visible_profiles: visibleProfiles,
        profiles_needing_details: profilesNeedingDetails,
        approved_language_profiles: approvedLanguageProfiles
      },
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin dashboard summary error:', error);
    return json({ error: 'Administration figures could not be loaded.' }, 500);
  }
};

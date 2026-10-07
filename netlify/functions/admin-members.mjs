import { verifyAdminRequest } from './_shared/admin-auth.mjs';

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders(range = '') {
  return {
    apikey: env('SUPABASE_SECRET_KEY'),
    Authorization: 'Bearer ' + env('SUPABASE_SECRET_KEY'),
    Accept: 'application/json',
    ...(range ? { Range: range } : {})
  };
}

async function fetchAll(path) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(env('SUPABASE_URL') + path, {
      headers: serviceHeaders(offset + '-' + (offset + pageSize - 1))
    });
    if (!response.ok) throw new Error('Unable to load member records: ' + await response.text());
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function authUsers() {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(
      env('SUPABASE_URL') + '/auth/v1/admin/users?page=' + page + '&per_page=1000',
      { headers: serviceHeaders() }
    );
    if (!response.ok) throw new Error('Unable to load member email addresses.');
    const result = await response.json();
    const batch = Array.isArray(result?.users) ? result.users : [];
    users.push(...batch);
    if (batch.length < 1000) return users;
  }
  return users;
}

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

function serializeMember(user, profile, membership) {
  return {
    user_id: user?.id || profile?.user_id || membership?.user_id || '',
    email: String(user?.email || '').trim(),
    display_name: String(profile?.display_name || '').trim(),
    lymphaware_id: String(profile?.lymphaware_id || '').trim(),
    qr_profile_active: profile?.qr_profile_active === true,
    profile_next_review_due_at: profile?.profile_next_review_due_at || null,
    profile_last_reviewed_at: profile?.profile_last_reviewed_at || null,
    package_type: membership?.package_type || null,
    membership_status: String(membership?.membership_status || 'NO MEMBERSHIP').toUpperCase(),
    payment_status: membership?.payment_status || null,
    membership_start: membership?.membership_start || null,
    membership_end: membership?.membership_end || null,
    membership_term_years: membership?.membership_term_years || null,
    auto_renew_enabled: membership?.auto_renew_enabled === true,
    next_renewal_at: membership?.next_renewal_at || null,
    renewal_price_pence: membership?.renewal_price_pence || null,
    pending_renewal_price_pence: membership?.pending_renewal_price_pence || null,
    stripe_subscription_status: membership?.stripe_subscription_status || null
  };
}

export default async request => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = await verifyAdminRequest(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    const url = new URL(request.url);
    const query = normalise(url.searchParams.get('q'));
    const requestedUserId = String(url.searchParams.get('user_id') || '').trim();
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));

    const [users, profiles, memberships, orders] = await Promise.all([
      authUsers(),
      fetchAll('/rest/v1/profiles?is_demo=eq.false&select=user_id,display_name,lymphaware_id,qr_profile_active,profile_next_review_due_at,profile_last_reviewed_at,is_archived'),
      fetchAll('/rest/v1/memberships?select=user_id,package_type,membership_status,payment_status,membership_start,membership_end,membership_term_years,auto_renew_enabled,next_renewal_at,renewal_price_pence,pending_renewal_price_pence,stripe_subscription_status'),
      requestedUserId
        ? fetchAll('/rest/v1/orders?user_id=eq.' + encodeURIComponent(requestedUserId) + '&select=id,order_number,order_type,order_status,payment_status,total_pence,created_at,completed_at&order=created_at.desc')
        : Promise.resolve([])
    ]);

    const userMap = new Map(users.map(user => [user.id, user]));
    const profileMap = new Map(profiles.filter(profile => profile.is_archived !== true).map(profile => [profile.user_id, profile]));
    const membershipMap = new Map(memberships.map(membership => [membership.user_id, membership]));
    const ids = new Set([...userMap.keys(), ...profileMap.keys(), ...membershipMap.keys()]);

    let members = [...ids].map(userId =>
      serializeMember(userMap.get(userId), profileMap.get(userId), membershipMap.get(userId))
    ).filter(member => member.user_id && member.email.toLowerCase() !== admin.email.toLowerCase());

    if (requestedUserId) {
      const member = members.find(row => row.user_id === requestedUserId);
      if (!member) return json({ error: 'Member not found.' }, 404);
      return json({
        member,
        orders: orders.map(order => ({
          id: order.id,
          reference: order.order_number ? 'ORD-' + String(order.order_number).padStart(6, '0') : '',
          order_type: order.order_type,
          order_status: order.order_status,
          payment_status: order.payment_status,
          total_pence: order.total_pence,
          created_at: order.created_at,
          completed_at: order.completed_at
        }))
      });
    }

    if (query) {
      members = members.filter(member =>
        [member.email, member.display_name, member.lymphaware_id, member.package_type, member.membership_status]
          .some(value => normalise(value).includes(query))
      );
    }

    members.sort((a, b) =>
      (a.display_name || a.email).localeCompare(b.display_name || b.email, 'en-GB', { sensitivity: 'base' })
    );

    return json({
      members: members.slice(0, limit),
      total: members.length,
      query,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin members error:', error);
    return json({ error: error instanceof Error ? error.message : 'Members could not be loaded.' }, 500);
  }
};

export const config = { path: '/api/admin-members' };

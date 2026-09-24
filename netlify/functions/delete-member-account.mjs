import { brandedEmailHtml } from './_shared/email-branding.mjs';
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

function tokenIssuedRecently(token) {
  try {
    const raw = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    return Number.isFinite(payload.iat) && (Date.now() / 1000 - payload.iat) <= 600;
  } catch {
    return false;
  }
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${env('SUPABASE_URL')}${path}`, options);
  if (!response.ok && response.status !== 404) {
    throw new Error(`Account deletion step failed (${response.status}).`);
  }
  return response;
}

async function cancelStripeSubscription(subscriptionId) {
  if (!subscriptionId) return;
  const stripeKey = env('STRIPE_SECRET_KEY');
  if (!stripeKey) throw new Error('Stripe is not configured for account deletion.');
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Stripe-Version': '2026-07-29.dahlia'
    }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error('Automatic renewal could not be cancelled before account deletion.');
  }
}

async function sendDeletionEmails(email, lymphawareId) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) return;
  const from = env('ORDER_NOTIFICATION_FROM') || 'LymphAware ID <notifications@lymphawareid.com>';
  const adminEmail = env('ORDER_NOTIFICATION_EMAIL') || 'admin@lymphawareid.com';
  const reference = lymphawareId ? ` (${lymphawareId})` : '';
  const customerSubject = 'Your LymphAware ID account has been deleted';
  const customerText = 'Your LymphAware ID account, QR profile, additional-language profiles and stored photograph have been permanently deleted. Completed transaction records are retained only where required for financial and legal record keeping.\n\nIf you did not expect this email, contact admin@lymphawareid.com.';
  const adminSubject = `LymphAware ID account deleted${reference}`;
  const adminText = `A member completed the self-service account deletion process${reference}. Any Stripe subscription/automatic renewal was cancelled before deletion. Their profile, translated profiles, photograph and login were removed. Identifying delivery and email details were removed from retained completed order records.`;
  await Promise.allSettled([
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: customerSubject,
        text: customerText,
        html: brandedEmailHtml({ title: customerSubject, text: customerText })
      })
    }),
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [adminEmail],
        subject: adminSubject,
        text: adminText,
        html: brandedEmailHtml({ title: adminSubject, text: adminText })
      })
    })
  ]);
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const accessToken = authHeader.slice(7).trim();
    if (!tokenIssuedRecently(accessToken)) {
      return json({ error: 'For your security, please enter your password again before deleting the account.' }, 401);
    }

    const userResponse = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
      headers: {
        apikey: env('SUPABASE_PUBLISHABLE_KEY'),
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!userResponse.ok) return json({ error: 'Your account could not be verified.' }, 401);
    const user = await userResponse.json();
    if (!user?.id || !user?.email) return json({ error: 'Your account could not be verified.' }, 401);
    if (user.email.toLowerCase() === env('LYMPHAWARE_ADMIN_EMAIL').toLowerCase()) {
      return json({ error: 'The administrator account cannot be deleted from the Patient Portal.' }, 403);
    }

    const body = await request.json().catch(() => ({}));
    if (String(body.confirmation || '') !== 'DELETE' || String(body.email || '').trim().toLowerCase() !== user.email.toLowerCase()) {
      return json({ error: 'The email address and DELETE confirmation must exactly match.' }, 400);
    }

    const base = env('SUPABASE_URL');
    const headers = serviceHeaders();
    const openOrdersResponse = await fetch(
      `${base}/rest/v1/orders?user_id=eq.${encodeURIComponent(user.id)}&payment_status=eq.PAID&select=order_number,order_status&order=created_at.desc`,
      { headers }
    );
    if (!openOrdersResponse.ok) throw new Error('Unable to check outstanding orders.');
    const paidOrders = await openOrdersResponse.json();
    const finishedStatuses = new Set(['COMPLETED', 'CANCELLED', 'REFUNDED']);
    const openOrder = (paidOrders || []).find((order) => !finishedStatuses.has(String(order.order_status || '').toUpperCase()));
    if (openOrder) {
      return json({
        error: `Your account cannot be deleted while order ORD-${String(openOrder.order_number || 0).padStart(6, '0')} is still being processed. Please contact admin@lymphawareid.com if you need help.`
      }, 409);
    }

    const membershipResponse = await fetch(
      `${base}/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}&select=id,stripe_subscription_id,auto_renew_enabled&limit=1`,
      { headers }
    );
    if (!membershipResponse.ok) throw new Error('Unable to load the member membership.');
    const membership = (await membershipResponse.json())?.[0] || null;
    if (membership?.stripe_subscription_id) {
      await cancelStripeSubscription(membership.stripe_subscription_id);
    }

    const profileResponse = await fetch(
      `${base}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id,photo_path,lymphaware_id&limit=1`,
      { headers }
    );
    if (!profileResponse.ok) throw new Error('Unable to load the member profile.');
    const profile = (await profileResponse.json())?.[0] || null;

    if (profile?.photo_path) {
      const encodedPath = String(profile.photo_path).split('/').map(encodeURIComponent).join('/');
      await supabaseRequest(`/storage/v1/object/patient-photos/${encodedPath}`, {
        method: 'DELETE',
        headers: serviceHeaders()
      });
    }

    if (profile?.id) {
      await supabaseRequest(`/rest/v1/profile_assistance?profile_id=eq.${encodeURIComponent(profile.id)}`, {
        method: 'DELETE',
        headers: serviceHeaders('return=minimal')
      });
    }
    await supabaseRequest(`/rest/v1/language_profiles?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: serviceHeaders('return=minimal')
    });
    await supabaseRequest(`/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: serviceHeaders('return=minimal')
    });
    await supabaseRequest(`/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: serviceHeaders('return=minimal')
    });
    await supabaseRequest(`/rest/v1/orders?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({
        customer_email: null,
        delivery_name: null,
        delivery_line1: null,
        delivery_line2: null,
        delivery_city: null,
        delivery_county: null,
        delivery_postcode: null,
        notification_error: null,
        customer_confirmation_error: null,
        production_notification_error: null,
        completion_notification_error: null,
        updated_at: new Date().toISOString()
      })
    });

    const deleteAuthResponse = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: serviceHeaders()
    });
    if (!deleteAuthResponse.ok) throw new Error('The login account could not be deleted.');

    await sendDeletionEmails(user.email, profile?.lymphaware_id || '');
    return json({ success: true });
  } catch (error) {
    console.error('Account deletion error:', error);
    return json({ error: 'Your account could not be deleted completely. Please contact admin@lymphawareid.com for assistance.' }, 500);
  }
};

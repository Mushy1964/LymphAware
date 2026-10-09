function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function supabaseHeaders() {
  return {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function stripeRequest(path, method = 'GET', values = null) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(values ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      'Stripe-Version': '2026-07-29.dahlia'
    },
    body: values ? new URLSearchParams(values).toString() : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || 'Stripe request failed.');
  }
  return result;
}

async function paymentMethodPortalConfiguration() {
  const list = await stripeRequest('billing_portal/configurations?active=true&limit=100');
  const existing = (list?.data || []).find(configuration =>
    configuration?.metadata?.managed_by === 'lymphaware_system' &&
    configuration?.metadata?.purpose === 'payment_method_update' &&
    configuration?.features?.payment_method_update?.enabled === true
  );
  if (existing?.id) return existing.id;

  const configuration = await stripeRequest('billing_portal/configurations', 'POST', {
    name: 'LymphAware ID – payment method updates',
    default_return_url: 'https://lymphawareid.com/portal/#membership-panel',
    'business_profile[headline]': 'Manage the payment method used for your LymphAware ID automatic renewal.',
    'business_profile[privacy_policy_url]': 'https://lymphawareid.com/privacy/',
    'business_profile[terms_of_service_url]': 'https://lymphawareid.com/terms/',
    'features[payment_method_update][enabled]': 'true',
    'metadata[managed_by]': 'lymphaware_system',
    'metadata[purpose]': 'payment_method_update'
  });
  return configuration.id;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const token = authHeader.slice(7).trim();

    const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      }
    });
    if (!userResponse.ok) return json({ error: 'Unable to verify your LymphAware ID account.' }, 401);
    const user = await userResponse.json();
    if (!user?.id) return json({ error: 'Unable to verify your LymphAware ID account.' }, 401);

    const membershipResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}&select=id,auto_renew_enabled,stripe_customer_id,stripe_subscription_id,stripe_subscription_status&limit=1`,
      { headers: supabaseHeaders() }
    );
    if (!membershipResponse.ok) return json({ error: 'Unable to read your membership.' }, 500);
    const membership = (await membershipResponse.json())?.[0];

    if (!membership?.auto_renew_enabled || !membership?.stripe_customer_id || !membership?.stripe_subscription_id) {
      return json({ error: 'There is no active automatic renewal payment method to update.' }, 400);
    }

    const configuration = await paymentMethodPortalConfiguration();
    const returnUrl = 'https://lymphawareid.com/portal/?payment_method=updated#membership-panel';
    const session = await stripeRequest('billing_portal/sessions', 'POST', {
      customer: membership.stripe_customer_id,
      configuration,
      locale: 'en-GB',
      return_url: 'https://lymphawareid.com/portal/#membership-panel',
      'flow_data[type]': 'payment_method_update',
      'flow_data[after_completion][type]': 'redirect',
      'flow_data[after_completion][redirect][return_url]': returnUrl
    });

    if (!session?.url) return json({ error: 'Unable to open secure payment settings.' }, 500);
    return json({ url: session.url });
  } catch (error) {
    console.error('Unable to create payment-method update session:', error);
    return json({ error: 'Unable to open secure payment settings. Please try again.' }, 500);
  }
};

export const config = { path: '/api/manage-payment-method' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Not found.' }, 404);

  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!Netlify.env.get('STRIPE_BRAND_MIGRATION_TOKEN') || token !== Netlify.env.get('STRIPE_BRAND_MIGRATION_TOKEN')) {
    return json({ error: 'Not found.' }, 404);
  }

  const apiKey = String(Netlify.env.get('STRIPE_SECRET_KEY') || '').trim();
  if (!apiKey) return json({ error: 'Stripe is not configured.' }, 500);

  const accountId = 'acct_1U6VxxPMYhQKb2OT';
  const form = new URLSearchParams();
  form.append('email', 'admin@lymphawareid.com');
  form.append('business_profile[name]', 'LymphAware ID sandbox');
  form.append('business_profile[url]', 'https://lymphawareid.com');
  form.append('business_profile[support_email]', 'admin@lymphawareid.com');
  form.append('business_profile[support_url]', 'https://lymphawareid.com/contact/');
  form.append('settings[payments][statement_descriptor]', 'LYMPHAWARE ID');

  const response = await fetch(`https://api.stripe.com/v1/accounts/${accountId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2026-07-29.dahlia'
    },
    body: form.toString()
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: body?.error?.message || 'Stripe update failed.' }, response.status);

  return json({
    ok: true,
    email: body.email || null,
    business_profile: {
      name: body.business_profile?.name || null,
      url: body.business_profile?.url || null,
      support_email: body.business_profile?.support_email || null,
      support_url: body.business_profile?.support_url || null
    },
    statement_descriptor: body.settings?.payments?.statement_descriptor || null,
    dashboard_display_name: body.settings?.dashboard?.display_name || null
  });
};

export const config = { path: '/api/stripe-brand-fix-0924' };

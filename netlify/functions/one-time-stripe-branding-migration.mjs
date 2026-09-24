function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function stripeJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || `Stripe request failed (${response.status})`);
  }
  return body;
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Not found.' }, 404);
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!env('MIGRATION_TOKEN') || token !== env('MIGRATION_TOKEN')) return json({ error: 'Not found.' }, 404);

  try {
    const apiKey = env('STRIPE_SECRET_KEY');
    if (!apiKey) return json({ error: 'Stripe is not configured.' }, 500);

    const auth = {
      Authorization: `Bearer ${apiKey}`,
      'Stripe-Version': '2026-07-29.dahlia'
    };

    const account = await stripeJson('https://api.stripe.com/v1/account', { headers: auth });

    const accountForm = new URLSearchParams();
    accountForm.append('email', 'admin@lymphawareid.com');
    accountForm.append('business_profile[name]', 'LymphAware ID');
    accountForm.append('business_profile[url]', 'https://lymphawareid.com');
    accountForm.append('business_profile[support_email]', 'admin@lymphawareid.com');
    accountForm.append('business_profile[support_url]', 'https://lymphawareid.com/contact/');
    accountForm.append('settings[payments][statement_descriptor]', 'LYMPHAWARE ID');

    const updatedAccount = await stripeJson(
      `https://api.stripe.com/v1/accounts/${encodeURIComponent(account.id)}`,
      {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: accountForm.toString()
      }
    );

    let branding = { updated: false, logo_file_created: false, error: null };

    try {
      const logoResponse = await fetch('https://lymphawareid.com/assets/brand/LymphAwareID_Email_Logo.png');
      if (!logoResponse.ok) throw new Error('Unable to fetch the approved LymphAware ID logo.');
      const logoBlob = await logoResponse.blob();

      const fileForm = new FormData();
      fileForm.append('purpose', 'business_logo');
      fileForm.append('file', logoBlob, 'LymphAwareID-logo.png');

      const file = await stripeJson('https://files.stripe.com/v1/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fileForm
      });

      const brandForm = new URLSearchParams();
      brandForm.append('checkout_background_color', 'rgb(255, 255, 255)');
      brandForm.append('checkout_use_brand_colors', 'true');
      brandForm.append('contrast_color', 'rgb(0, 81, 178)');
      brandForm.append('font_color', 'rgb(255, 255, 255)');
      brandForm.append('primary_color', 'rgb(0, 83, 183)');
      brandForm.append('secondary_color', 'rgb(36, 122, 36)');
      brandForm.append('checkout_border_style', 'default');
      brandForm.append('checkout_font_family', 'default');
      brandForm.append('use_logo_instead_of_icon', 'true');
      brandForm.append('logo', file.id);
      brandForm.append('icon', file.id);

      await stripeJson('https://api.stripe.com/v1/_unstable/settings/brand', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: brandForm.toString()
      });

      branding = { updated: true, logo_file_created: true, error: null };
    } catch (error) {
      branding = {
        updated: false,
        logo_file_created: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    return json({
      ok: true,
      account: {
        email: updatedAccount.email || null,
        name: updatedAccount.business_profile?.name || null,
        url: updatedAccount.business_profile?.url || null,
        support_email: updatedAccount.business_profile?.support_email || null,
        support_url: updatedAccount.business_profile?.support_url || null,
        statement_descriptor: updatedAccount.settings?.payments?.statement_descriptor || null
      },
      branding
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Migration failed.' }, 500);
  }
};

export const config = {
  path: '/api/one-time-stripe-branding-migration'
};

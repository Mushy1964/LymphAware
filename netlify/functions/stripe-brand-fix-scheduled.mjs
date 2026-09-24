export default async () => {
  const apiKey = String(Netlify.env.get('STRIPE_SECRET_KEY') || '').trim();
  if (!apiKey) {
    console.error('Stripe is not configured.');
    return;
  }

  const form = new URLSearchParams();
  form.append('email', 'admin@lymphawareid.com');
  form.append('business_profile[name]', 'LymphAware ID sandbox');
  form.append('business_profile[url]', 'https://lymphawareid.com');
  form.append('business_profile[support_email]', 'admin@lymphawareid.com');
  form.append('business_profile[support_url]', 'https://lymphawareid.com/contact/');
  form.append('settings[payments][statement_descriptor]', 'LYMPHAWARE ID');

  const response = await fetch('https://api.stripe.com/v1/accounts/acct_1U6VxxPMYhQKb2OT', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2026-07-29.dahlia'
    },
    body: form.toString()
  });

  if (!response.ok) {
    console.error('Stripe brand migration failed:', await response.text());
    return;
  }

  console.log('Stripe brand migration applied.');
};

export const config = { schedule: '* * * * *' };

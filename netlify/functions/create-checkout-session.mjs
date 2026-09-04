export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();
    const body = await request.json().catch(() => ({}));

    const extraCard = Boolean(body?.extraCard);
    const extraLanyard = Boolean(body?.extraLanyard);
    const languagePackage = Boolean(body?.languagePackage);
    const languageName = languagePackage
      ? String(body?.languageName || '').trim().slice(0, 80)
      : '';

    if (languagePackage && !languageName) {
      return new Response(JSON.stringify({ error: 'Please choose the language required for your additional language package.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      return new Response(JSON.stringify({ error: 'Unable to verify your LymphAware account.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await userResponse.json();

    if (!user?.id) {
      return new Response(JSON.stringify({ error: 'Unable to verify your LymphAware account.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const membershipResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${user.id}&select=id,membership_status,payment_status,initial_fee_pence`,
      {
        headers: {
          apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      }
    );

    if (!membershipResponse.ok) {
      return new Response(JSON.stringify({ error: 'Unable to verify your membership.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const memberships = await membershipResponse.json();
    const membership = memberships?.[0];

    if (
      !membership ||
      membership.membership_status !== 'PENDING' ||
      membership.payment_status !== 'PENDING'
    ) {
      return new Response(JSON.stringify({ error: 'No membership payment is currently due.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (Number(membership.initial_fee_pence) !== 2999) {
      return new Response(JSON.stringify({ error: 'Membership fee could not be verified.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const stripeForm = new URLSearchParams();
    stripeForm.append('mode', 'payment');

    let itemIndex = 0;
    const addLineItem = (priceId) => {
      stripeForm.append(`line_items[${itemIndex}][price]`, priceId);
      stripeForm.append(`line_items[${itemIndex}][quantity]`, '1');
      itemIndex += 1;
    };

    addLineItem('price_1UBvUAPMYhQKb2OT8koXgY1w');
    if (extraCard) addLineItem('price_1UBw5vPMYhQKb2OTcMbClQbh');
    if (extraLanyard) addLineItem('price_1UBw6APMYhQKb2OT3HefM6zT');
    if (languagePackage) addLineItem('price_1UBw6XPMYhQKb2OTlE9VQDd5');

    stripeForm.append('allow_promotion_codes', 'true');
    stripeForm.append('billing_address_collection', 'required');

    const allowedCountries = [
      'GB','IE','FR','ES','PT','DE','NL','BE','LU','IT','AT','DK','SE','NO','FI','CH',
      'US','CA','AU','NZ','CY','MT','GR','PL','CZ','SK','SI','HR','HU','RO','BG'
    ];
    allowedCountries.forEach((country, index) => {
      stripeForm.append(`shipping_address_collection[allowed_countries][${index}]`, country);
    });

    stripeForm.append('client_reference_id', user.id);
    stripeForm.append('metadata[lymphaware_user_id]', user.id);
    stripeForm.append('metadata[membership_id]', membership.id);
    stripeForm.append('metadata[payment_type]', 'initial_membership');
    stripeForm.append('metadata[extra_card]', extraCard ? '1' : '0');
    stripeForm.append('metadata[extra_lanyard]', extraLanyard ? '1' : '0');
    stripeForm.append('metadata[language_package]', languagePackage ? '1' : '0');
    stripeForm.append('metadata[language_name]', languageName);
    stripeForm.append('success_url', 'https://lymphaware.com/portal/?payment=success');
    stripeForm.append('cancel_url', 'https://lymphaware.com/portal/?payment=cancelled');

    if (user.email) {
      stripeForm.append('customer_email', user.email);
    }

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: stripeForm.toString()
    });

    const checkoutSession = await stripeResponse.json();

    if (!stripeResponse.ok || !checkoutSession?.url) {
      console.error('Stripe Checkout error:', checkoutSession);
      return new Response(JSON.stringify({ error: 'Unable to create the secure payment page.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ url: checkoutSession.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Unable to create Stripe Checkout session:', error);
    return new Response(JSON.stringify({ error: 'Unable to start membership payment.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

const APPROVED_LANGUAGES = {
  FR: 'French'
};

const PACKAGE_DEFINITIONS = {
  STANDARD: { name: 'LymphAware 5-Year Membership', amountPence: 2999, requiresLanguage: false },
  PLUS: { name: 'LymphAware 5-Year Plus', amountPence: 3999, requiresLanguage: false },
  MULTILINGUAL: { name: 'LymphAware 5-Year Multilingual', amountPence: 4999, requiresLanguage: true }
};

const EUROPE_COUNTRIES = new Set([
  'AL','AD','AT','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT',
  'XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','SM','RS','SK','SI',
  'ES','SE','CH','UA','VA'
]);

const CHECKOUT_COUNTRIES = new Set([
  'GB','IE','FR','ES','PT','DE','NL','BE','LU','IT','AT','DK','SE','NO','FI','CH','US','CA','AU','NZ',
  'CY','MT','GR','PL','CZ','SK','SI','HR','HU','RO','BG','EE','LV','LT','IS','AL','AD','BA','MD','MC',
  'ME','MK','RS','UA','AE','ZA','IN','JP','SG','HK'
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function normaliseLanguageCode(value) { return String(value || '').trim().toUpperCase(); }
function normaliseCountry(value) { return String(value || '').trim().toUpperCase(); }
function shippingBand(country) {
  if (country === 'GB') return 'UK';
  if (EUROPE_COUNTRIES.has(country)) return 'EUROPE';
  return 'REST_OF_WORLD';
}
function shippingRateIdForBand(band) {
  if (band === 'UK') return String(process.env.STRIPE_SHIPPING_RATE_UK || '').trim();
  if (band === 'EUROPE') return String(process.env.STRIPE_SHIPPING_RATE_EUROPE || '').trim();
  return String(process.env.STRIPE_SHIPPING_RATE_REST_OF_WORLD || '').trim();
}
function appendInlinePrice(stripeForm, name, amountPence, description = '') {
  stripeForm.append('line_items[0][price_data][currency]', 'gbp');
  stripeForm.append('line_items[0][price_data][unit_amount]', String(amountPence));
  stripeForm.append('line_items[0][price_data][product_data][name]', name);
  if (description) stripeForm.append('line_items[0][price_data][product_data][description]', description);
  stripeForm.append('line_items[0][quantity]', '1');
}

async function getMembership(userId) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&select=id,membership_status,payment_status,initial_fee_pence,membership_end&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

function hasActiveEntitlement(membership) {
  return Boolean(
    membership && (
      (membership.membership_status === 'ACTIVE' && membership.payment_status === 'PAID') ||
      membership.membership_status === 'PILOT' ||
      membership.membership_status === 'SPONSORED'
    )
  );
}

async function alreadyPurchasedLanguage(userId, languageCode, languageName) {
  const profileResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/language_profiles?user_id=eq.${encodeURIComponent(userId)}&language_code=eq.${encodeURIComponent(languageCode)}&select=id&limit=1`,
    { headers: serviceHeaders() }
  );
  if (profileResponse.ok) {
    const rows = await profileResponse.json();
    if (rows?.length) return true;
  }

  const ordersResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/orders?user_id=eq.${encodeURIComponent(userId)}&payment_status=eq.PAID&select=id`,
    { headers: serviceHeaders() }
  );
  if (!ordersResponse.ok) return false;
  const orders = await ordersResponse.json();
  const orderIds = (orders || []).map(row => row.id).filter(Boolean);
  if (!orderIds.length) return false;

  const encodedIds = orderIds.map(id => encodeURIComponent(id)).join(',');
  const itemsResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/order_items?order_id=in.(${encodedIds})&item_type=eq.LANGUAGE_PACKAGE&language_name=eq.${encodeURIComponent(languageName)}&select=id&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!itemsResponse.ok) return false;
  const items = await itemsResponse.json();
  return Boolean(items?.length);
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const accessToken = authHeader.replace('Bearer ', '').trim();
    const body = await request.json().catch(() => ({}));
    const paymentType = String(body?.paymentType || 'initial_membership').trim();

    const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userResponse.ok) return json({ error: 'Unable to verify your LymphAware account.' }, 401);
    const user = await userResponse.json();
    if (!user?.id) return json({ error: 'Unable to verify your LymphAware account.' }, 401);

    const membership = await getMembership(user.id);
    if (!membership) return json({ error: 'Unable to verify your membership.' }, 403);

    const deliveryCountry = normaliseCountry(body?.deliveryCountry);
    if (!CHECKOUT_COUNTRIES.has(deliveryCountry)) return json({ error: 'Please select a supported delivery country.' }, 400);
    const band = shippingBand(deliveryCountry);
    const shippingRateId = shippingRateIdForBand(band);

    let checkoutName = '';
    let checkoutDescription = '';
    let amountPence = 0;
    let packageType = '';
    let languageCode = '';
    let languageName = '';
    let replacementCard = false;
    let replacementLanyard = false;

    if (paymentType === 'initial_membership') {
      if (membership.membership_status !== 'PENDING' || membership.payment_status !== 'PENDING') {
        return json({ error: 'No membership payment is currently due.' }, 403);
      }
      if (Number(membership.initial_fee_pence) !== 2999) return json({ error: 'Membership fee could not be verified.' }, 400);

      packageType = String(body?.packageType || 'STANDARD').trim().toUpperCase();
      const packageDefinition = PACKAGE_DEFINITIONS[packageType];
      if (!packageDefinition) return json({ error: 'Please select a valid LymphAware membership package.' }, 400);

      if (packageDefinition.requiresLanguage) {
        languageCode = normaliseLanguageCode(body?.languageCode);
        languageName = APPROVED_LANGUAGES[languageCode] || '';
        if (!languageName) return json({ error: 'Please select an additional language that is currently available.' }, 400);
      }

      checkoutName = packageDefinition.name;
      checkoutDescription = packageType === 'MULTILINGUAL'
        ? `Five-year membership with English and ${languageName} profiles, 2 English cards, 2 ${languageName} cards and 2 lanyards & holders.`
        : packageType === 'PLUS'
          ? 'Five-year membership with 2 English ID cards and 2 lanyards & holders.'
          : 'Five-year membership with 1 English ID card and 1 lanyard & holder.';
      amountPence = packageDefinition.amountPence;
    } else if (paymentType === 'additional_language') {
      if (!hasActiveEntitlement(membership)) return json({ error: 'An active LymphAware membership is required.' }, 403);

      languageCode = normaliseLanguageCode(body?.languageCode);
      languageName = APPROVED_LANGUAGES[languageCode] || '';
      if (!languageName) return json({ error: 'Please select an additional language that is currently available.' }, 400);
      if (await alreadyPurchasedLanguage(user.id, languageCode, languageName)) {
        return json({ error: `Your account already has a ${languageName} language package.` }, 400);
      }

      checkoutName = `LymphAware Additional Language Package – ${languageName}`;
      checkoutDescription = `One ${languageName} QR profile, one ${languageName} ID card and one lanyard & holder.`;
      amountPence = 1999;
      packageType = 'ADDITIONAL_LANGUAGE';
    } else if (paymentType === 'replacement_items') {
      if (!hasActiveEntitlement(membership)) return json({ error: 'An active LymphAware membership is required.' }, 403);

      replacementCard = body?.replacementCard === true;
      replacementLanyard = body?.replacementLanyard === true;
      if (!replacementCard && !replacementLanyard) {
        return json({ error: 'Please select at least one item.' }, 400);
      }

      amountPence = (replacementCard ? 650 : 0) + (replacementLanyard ? 650 : 0);
      checkoutName = replacementCard && replacementLanyard
        ? 'LymphAware Replacement Card + Lanyard & Holder'
        : replacementCard
          ? 'LymphAware Replacement ID Card'
          : 'LymphAware Replacement Lanyard & Holder';
      checkoutDescription = 'Replacement items for an existing LymphAware membership.';
      packageType = 'REPLACEMENT_ITEMS';
    } else {
      return json({ error: 'Unsupported payment type.' }, 400);
    }

    const stripeForm = new URLSearchParams();
    stripeForm.append('mode', 'payment');
    appendInlinePrice(stripeForm, checkoutName, amountPence, checkoutDescription);
    stripeForm.append('allow_promotion_codes', 'true');
    stripeForm.append('billing_address_collection', 'required');
    stripeForm.append('shipping_address_collection[allowed_countries][0]', deliveryCountry);
    if (shippingRateId) stripeForm.append('shipping_options[0][shipping_rate]', shippingRateId);

    stripeForm.append('client_reference_id', user.id);
    stripeForm.append('metadata[lymphaware_user_id]', user.id);
    stripeForm.append('metadata[membership_id]', membership.id);
    stripeForm.append('metadata[payment_type]', paymentType);
    stripeForm.append('metadata[package_type]', packageType);
    stripeForm.append('metadata[language_code]', languageCode);
    stripeForm.append('metadata[language_name]', languageName);
    stripeForm.append('metadata[replacement_card]', replacementCard ? '1' : '0');
    stripeForm.append('metadata[replacement_lanyard]', replacementLanyard ? '1' : '0');
    stripeForm.append('metadata[delivery_country_selected]', deliveryCountry);
    stripeForm.append('metadata[shipping_band]', band);
    stripeForm.append('metadata[shipping_rate_configured]', shippingRateId ? '1' : '0');

    const successType = paymentType === 'additional_language'
      ? 'language'
      : paymentType === 'replacement_items'
        ? 'replacement'
        : 'membership';
    stripeForm.append('success_url', `https://lymphaware.com/portal/?payment=success&type=${successType}`);
    stripeForm.append('cancel_url', 'https://lymphaware.com/portal/?payment=cancelled');
    if (user.email) stripeForm.append('customer_email', user.email);

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: stripeForm.toString()
    });
    const checkoutSession = await stripeResponse.json();
    if (!stripeResponse.ok || !checkoutSession?.url) {
      console.error('Stripe Checkout error:', checkoutSession);
      return json({ error: 'Unable to create the secure payment page.' }, 500);
    }
    return json({ url: checkoutSession.url });
  } catch (error) {
    console.error('Unable to create Stripe Checkout session:', error);
    return json({ error: 'Unable to start secure payment.' }, 500);
  }
};

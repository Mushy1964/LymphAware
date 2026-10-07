import { PACKAGE_DEFINITIONS } from './_shared/initial-membership-checkout.mjs';
import { getBusinessSettings, publicPricing } from './_shared/business-settings.mjs';
import { MEMBERSHIP_CONTRACT_VERSION, recordContractEvent } from './_shared/membership-contract.mjs';

const TRIAL_RENEWAL_PROTECTION_COUPON = 'LYMPHAWARE_TRIAL_RENEWAL_FREE_V1';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders(prefer = '') {
  const headers = {
    apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function getUser(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const response = await fetch(`${Netlify.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      apikey: Netlify.env.get('SUPABASE_PUBLISHABLE_KEY'),
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

async function getMembership(userId) {
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,membership_status,payment_status,package_type,membership_term_years,membership_end,auto_renew_enabled&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) return null;
  return (await response.json())?.[0] || null;
}

function addYearsClamped(value, years) {
  const source = new Date(value);
  if (!Number.isFinite(source.getTime())) return null;
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const result = new Date(source);
  result.setUTCDate(1);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  result.setUTCMonth(month);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), month + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function currentRenewalBase(membership) {
  const now = new Date();
  const currentEnd = new Date(membership.membership_end || 0);
  return Number.isFinite(currentEnd.getTime()) && currentEnd.getTime() > now.getTime() ? currentEnd : now;
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await getUser(request);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const body = await request.json().catch(() => ({}));
    if (body?.termsAccepted !== true) {
      return json({ error: 'Please confirm the renewal terms before continuing.' }, 400);
    }

    const membership = await getMembership(user.id);
    if (!membership) return json({ error: 'Your membership could not be found.' }, 404);

    if (membership.auto_renew_enabled === true) {
      return json({ error: 'Automatic renewal is already active for this membership.' }, 409);
    }

    const status = String(membership.membership_status || '').toUpperCase();
    if (!['ACTIVE', 'PILOT', 'LAPSED'].includes(status)) {
      return json({ error: 'This membership is not currently available for renewal.' }, 403);
    }

    const packageType = String(membership.package_type || '').toUpperCase();
    const years = Number(membership.membership_term_years || 0);
    const packageDefinition = PACKAGE_DEFINITIONS[packageType];
    const livePricing = publicPricing(await getBusinessSettings({ strict: true }));
    const renewalPricePence = Number(livePricing.renewals?.[packageType]?.[years] || 0);

    if (!packageDefinition || ![1, 2, 3].includes(years) || renewalPricePence <= 0) {
      return json({ error: 'The renewal price for this membership could not be confirmed.' }, 500);
    }

    const baseDate = currentRenewalBase(membership);
    const projectedEnd = addYearsClamped(baseDate, years);
    if (!projectedEnd) return json({ error: 'The new membership expiry date could not be calculated.' }, 500);

    const form = new URLSearchParams();
    form.append('mode', 'payment');
    form.append('line_items[0][price_data][currency]', 'gbp');
    form.append('line_items[0][price_data][unit_amount]', String(renewalPricePence));
    form.append('line_items[0][price_data][product]', packageDefinition.renewalProductId);
    form.append('line_items[0][quantity]', '1');
    form.append('billing_address_collection', 'required');
    form.append('client_reference_id', user.id);
    if (user.email) form.append('customer_email', user.email);

    form.append('metadata[lymphaware_user_id]', user.id);
    form.append('metadata[membership_id]', membership.id);
    form.append('metadata[payment_type]', 'manual_membership_renewal');
    form.append('metadata[package_type]', packageType);
    form.append('metadata[membership_term_years]', String(years));
    form.append('metadata[renewal_price_pence]', String(renewalPricePence));
    form.append('metadata[renewal_base_date]', baseDate.toISOString());
    form.append('metadata[projected_membership_end]', projectedEnd.toISOString());
    form.append('metadata[contract_version]', MEMBERSHIP_CONTRACT_VERSION);
    form.append('metadata[manual_renewal_terms_accepted_at]', new Date().toISOString());
    form.append('metadata[renewal_cooling_off_days]', '14');
    form.append('metadata[trial_discount_applied]', status === 'PILOT' ? '1' : '0');

    if (status === 'PILOT') form.append('discounts[0][coupon]', TRIAL_RENEWAL_PROTECTION_COUPON);

    form.append('success_url', 'https://lymphawareid.com/portal/?payment=success&type=renewal');
    form.append('cancel_url', 'https://lymphawareid.com/portal/?payment=cancelled&type=renewal');

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Netlify.env.get('STRIPE_SECRET_KEY')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2026-07-29.dahlia'
      },
      body: form.toString()
    });
    const session = await response.json();
    if (!response.ok || !session?.url) {
      console.error('Manual renewal Stripe Checkout error:', session);
      return json({ error: 'Unable to start secure renewal payment.' }, 500);
    }

    try {
      await recordContractEvent({
        membershipId: membership.id,
        userId: user.id,
        eventType: 'MANUAL_RENEWAL_CHECKOUT_STARTED',
        stripeReference: session.id,
        details: {
          package_type: packageType,
          membership_term_years: years,
          renewal_price_pence: renewalPricePence,
          current_membership_end: membership.membership_end,
          renewal_base_date: baseDate.toISOString(),
          projected_membership_end: projectedEnd.toISOString()
        }
      });
    } catch (error) {
      console.error('Unable to record manual renewal checkout event:', error);
    }

    return json({
      url: session.url,
      projectedMembershipEnd: projectedEnd.toISOString()
    });
  } catch (error) {
    console.error('Unable to start manual membership renewal:', error);
    return json({ error: 'Unable to start secure renewal payment.' }, 500);
  }
};

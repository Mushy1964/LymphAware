import {
  createInitialMembershipCheckout,
  normaliseInitialSelection
} from './_shared/initial-membership-checkout.mjs';
import {
  authoriseRegistration,
  registrationUnavailableMessage
} from './_shared/registration-access.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders() {
  return {
    apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
    'Content-Type': 'application/json'
  };
}

async function registrationEmailExists(email) {
  const response = await fetch(`${Netlify.env.get('SUPABASE_URL')}/rest/v1/rpc/registration_email_exists`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ p_email: email })
  });
  if (!response.ok) throw new Error('The account check could not be completed.');
  return Boolean(await response.json());
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);

    const suppliedCode = body.discountCode ?? body.inviteCode ?? '';
    const registrationAccess = await authoriseRegistration(suppliedCode, email);
    if (!registrationAccess.allowed) {
      return json({ error: registrationUnavailableMessage(registrationAccess) }, 403);
    }

    if (await registrationEmailExists(email)) {
      return json({
        error: 'An account already exists for this email address. Please sign in to continue, or use Forgotten password.'
      }, 409);
    }

    const selection = normaliseInitialSelection(body);
    const acceptedAt = new Date().toISOString();

    const checkout = await createInitialMembershipCheckout({
      email,
      selection,
      promotionCodeId: registrationAccess.promotionCodeId,
      promotionCode: registrationAccess.code,
      isTrial: registrationAccess.isTrial,
      acceptedAt
    });

    return json({ url: checkout.url });
  } catch (error) {
    console.error('Unable to start membership checkout:', error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : 'Unable to open secure payment.' }, 500);
  }
};

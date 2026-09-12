import {
  MEMBERSHIP_CONTRACT_VERSION,
  contractSnapshot,
  createInitialMembershipCheckout,
  normaliseInitialSelection
} from './_shared/initial-membership-checkout.mjs';
import { recordContractEvent } from './_shared/membership-contract.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders(prefer = '') {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function registrationIsOpen() {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/system_settings?setting_key=eq.registration_mode&select=setting_value&limit=1`, {
    headers: serviceHeaders()
  });
  if (!response.ok) return false;
  return String((await response.json())?.[0]?.setting_value || '').toUpperCase() === 'OPEN';
}

async function waitForMembership(userId) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&select=id,membership_status,payment_status&limit=1`, {
      headers: serviceHeaders()
    });
    if (response.ok) {
      const membership = (await response.json())?.[0];
      if (membership) return membership;
    }
    await new Promise(resolve => setTimeout(resolve, 175));
  }
  return null;
}

async function recordPendingSelection(membership, userId, selection) {
  const now = new Date().toISOString();
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders('return=minimal'),
    body: JSON.stringify({
      package_type: selection.packageType,
      membership_term_years: selection.membershipTermYears,
      initial_fee_pence: selection.packagePricePence,
      renewal_price_pence: selection.autoRenew ? selection.renewalPricePence : null,
      auto_renew_requested: selection.autoRenew,
      auto_renew_enabled: false,
      subscription_terms_version: MEMBERSHIP_CONTRACT_VERSION,
      precontract_accepted_at: now,
      auto_renew_consent_at: selection.autoRenew ? now : null,
      updated_at: now
    })
  });
  if (!response.ok) throw new Error('Unable to save the selected membership.');

  const details = contractSnapshot(selection);
  await recordContractEvent({ membershipId: membership.id, userId, eventType: 'PRECONTRACT_ACCEPTED', details });
  if (selection.autoRenew) {
    await recordContractEvent({ membershipId: membership.id, userId, eventType: 'AUTO_RENEW_CONSENT', details });
  }
}

async function removeIncompleteSignup(userId) {
  if (!userId) return;
  await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: serviceHeaders()
  }).catch(() => {});
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  let createdUserId = '';
  let accountPrepared = false;
  try {
    if (!(await registrationIsOpen())) return json({ error: 'New LymphAware membership registration is currently closed.' }, 403);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
    if (password.length < 8) return json({ error: 'Please choose a password containing at least 8 characters.' }, 400);
    const selection = normaliseInitialSelection(body);

    const signupResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent('https://lymphaware.com/portal/?email=confirmed')}`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        data: {
          selected_package: selection.packageType,
          selected_membership_term_years: selection.membershipTermYears,
          membership_contract_version: MEMBERSHIP_CONTRACT_VERSION
        }
      })
    });
    const signup = await signupResponse.json().catch(() => ({}));
    const signupUser = signup?.user || signup;
    const identities = signupUser?.identities;
    if (!signupResponse.ok || !signupUser?.id || (Array.isArray(identities) && identities.length === 0)) {
      return json({ error: 'An account may already exist for this email address. Please sign in to continue, or use Forgotten password.' }, 409);
    }
    createdUserId = signupUser.id;

    const membership = await waitForMembership(createdUserId);
    if (!membership || membership.membership_status !== 'PENDING' || membership.payment_status !== 'PENDING') {
      await removeIncompleteSignup(createdUserId);
      return json({ error: 'Your membership could not be prepared. Please try again.' }, 500);
    }
    await recordPendingSelection(membership, createdUserId, selection);
    accountPrepared = true;
    const checkout = await createInitialMembershipCheckout({
      userId: createdUserId,
      email,
      membershipId: membership.id,
      selection
    });
    return json({ url: checkout.url });
  } catch (error) {
    console.error('Unable to start membership registration and checkout:', error instanceof Error ? error.message : error);
    // Keep a successfully prepared pending account if Stripe is temporarily unavailable. The member can
    // confirm their email, sign in and resume payment without receiving a second verification email.
    if (!accountPrepared) await removeIncompleteSignup(createdUserId);
    const reason = error instanceof Error ? error.message : 'Unable to start secure payment.';
    return json({ error: accountPrepared ? `${reason} Your unpaid membership has not been activated. Confirm your email and sign in to try payment again.` : reason }, 500);
  }
};

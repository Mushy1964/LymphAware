const VALID_REGISTRATION_MODES = new Set(['OPEN', 'INVITE_ONLY', 'CLOSED']);

function serviceHeaders() {
  return {
    apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
    'Content-Type': 'application/json'
  };
}

export function normaliseInviteCode(value) {
  return String(value || '').trim().toUpperCase();
}

export async function getRegistrationMode() {
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/system_settings?setting_key=eq.registration_mode&select=setting_value&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('Registration availability could not be checked.');
  const value = String((await response.json())?.[0]?.setting_value || 'CLOSED').trim().toUpperCase();
  return VALID_REGISTRATION_MODES.has(value) ? value : 'CLOSED';
}

async function pilotInvitationExists(inviteCode, email) {
  if (!inviteCode) return false;
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/pilot_invites?invite_code=eq.${encodeURIComponent(inviteCode)}&active=eq.true&select=id,email&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('The trial code could not be checked.');
  const invitation = (await response.json())?.[0];
  if (!invitation?.id) return false;
  const restrictedEmail = String(invitation.email || '').trim().toLowerCase();
  return !restrictedEmail || restrictedEmail === String(email || '').trim().toLowerCase();
}

async function isActivePilotCode(code) {
  if (!code) return false;
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/pilot_invites?invite_code=eq.${encodeURIComponent(code)}&active=eq.true&select=id&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('The trial code could not be checked.');
  return Boolean((await response.json())?.[0]?.id);
}

async function activeInitialPromotion(code, { requireTrial = false } = {}) {
  if (!code) return null;
  const parameters = new URLSearchParams({
    code,
    active: 'true',
    limit: '1'
  });
  parameters.append('expand[]', 'data.promotion.coupon');
  const response = await fetch(`https://api.stripe.com/v1/promotion_codes?${parameters}`, {
    headers: {
      Authorization: `Bearer ${Netlify.env.get('STRIPE_SECRET_KEY')}`,
      'Stripe-Version': '2026-07-29.dahlia'
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('The discount code could not be checked.');

  const promotionCode = result?.data?.[0];
  const coupon = promotionCode?.promotion?.coupon || promotionCode?.coupon;
  const oneTimeOnly = coupon?.duration === 'once';
  const trialEligible = Number(coupon?.percent_off) === 100;

  if (
    !promotionCode?.id ||
    promotionCode.active !== true ||
    coupon?.valid === false ||
    !oneTimeOnly ||
    (requireTrial && !trialEligible)
  ) {
    return null;
  }

  return {
    id: promotionCode.id,
    code: String(promotionCode.code || code).trim().toUpperCase(),
    percentOff: coupon?.percent_off == null ? null : Number(coupon.percent_off),
    amountOff: coupon?.amount_off == null ? null : Number(coupon.amount_off),
    currency: coupon?.currency || null
  };
}

export async function authoriseRegistration(codeValue, email = '') {
  const mode = await getRegistrationMode();
  const code = normaliseInviteCode(codeValue);

  if (mode === 'CLOSED') {
    return { allowed: false, mode, code: '', promotionCodeId: '', isTrial: false, codeInvalid: false };
  }

  if (mode === 'INVITE_ONLY') {
    if (!code || !(await pilotInvitationExists(code, email))) {
      return { allowed: false, mode, code: '', promotionCodeId: '', isTrial: false, codeInvalid: Boolean(code) };
    }
    const promotion = await activeInitialPromotion(code, { requireTrial: true });
    if (!promotion) {
      return { allowed: false, mode, code: '', promotionCodeId: '', isTrial: false, codeInvalid: true };
    }
    return {
      allowed: true,
      mode,
      code: promotion.code,
      promotionCodeId: promotion.id,
      isTrial: true,
      codeInvalid: false
    };
  }

  if (!code) {
    return { allowed: true, mode, code: '', promotionCodeId: '', isTrial: false, codeInvalid: false };
  }

  if (await isActivePilotCode(code)) {
    return { allowed: false, mode, code, promotionCodeId: '', isTrial: false, codeInvalid: true };
  }

  const promotion = await activeInitialPromotion(code);
  if (!promotion) {
    return { allowed: false, mode, code, promotionCodeId: '', isTrial: false, codeInvalid: true };
  }

  return {
    allowed: true,
    mode,
    code: promotion.code,
    promotionCodeId: promotion.id,
    isTrial: false,
    codeInvalid: false
  };
}

export function registrationUnavailableMessage(access) {
  const mode = typeof access === 'string' ? access : access?.mode;
  const codeInvalid = typeof access === 'object' && access?.codeInvalid === true;

  if (mode === 'INVITE_ONLY') {
    return codeInvalid
      ? 'The LymphAware ID trial code is invalid or unavailable.'
      : 'LymphAware ID is currently available by invitation for testing. Please enter the valid trial code supplied with your invitation.';
  }
  if (mode === 'OPEN' && codeInvalid) {
    return 'That discount code is invalid, expired or not available for this initial membership order.';
  }
  return 'New LymphAware ID membership registration is currently closed.';
}

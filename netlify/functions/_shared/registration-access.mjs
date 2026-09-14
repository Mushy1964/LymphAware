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

async function registrationMode() {
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

async function activeTrialPromotion(inviteCode) {
  const parameters = new URLSearchParams({
    code: inviteCode,
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
  if (!response.ok) throw new Error('The trial discount could not be checked.');
  const promotionCode = result?.data?.[0];
  const coupon = promotionCode?.promotion?.coupon || promotionCode?.coupon;
  if (
    !promotionCode?.id ||
    promotionCode.active !== true ||
    coupon?.valid === false ||
    Number(coupon?.percent_off) !== 100 ||
    coupon?.duration !== 'once'
  ) {
    return '';
  }
  return promotionCode.id;
}

export async function authoriseRegistration(inviteCodeValue, email = '') {
  const mode = await registrationMode();
  const inviteCode = normaliseInviteCode(inviteCodeValue);
  if (mode === 'OPEN') return { allowed: true, mode, inviteCode: '', promotionCodeId: '' };
  if (mode === 'INVITE_ONLY' && await pilotInvitationExists(inviteCode, email)) {
    const promotionCodeId = await activeTrialPromotion(inviteCode);
    if (promotionCodeId) return { allowed: true, mode, inviteCode, promotionCodeId };
  }
  return { allowed: false, mode, inviteCode: '', promotionCodeId: '' };
}

export function registrationUnavailableMessage(mode) {
  return mode === 'INVITE_ONLY'
    ? 'LymphAware is currently available by invitation for testing. Please enter the valid trial code supplied with your invitation.'
    : 'New LymphAware membership registration is currently closed.';
}

const VALID_REGISTRATION_MODES = new Set(['OPEN', 'INVITE_ONLY', 'CLOSED']);

function serviceHeaders(prefer = '') {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

export function normaliseInviteCode(value) {
  return String(value || '').trim().toUpperCase();
}

async function registrationMode() {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/system_settings?setting_key=eq.registration_mode&select=setting_value&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('Registration availability could not be checked.');
  const value = String((await response.json())?.[0]?.setting_value || 'CLOSED').trim().toUpperCase();
  return VALID_REGISTRATION_MODES.has(value) ? value : 'CLOSED';
}

async function unusedInvitationExists(inviteCode) {
  if (!inviteCode) return false;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/invitation_codes?code=eq.${encodeURIComponent(inviteCode)}&status=eq.unused&used_by=is.null&select=id&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('The trial invitation could not be checked.');
  return Boolean((await response.json())?.[0]?.id);
}

export async function authoriseRegistration(inviteCodeValue) {
  const mode = await registrationMode();
  const inviteCode = normaliseInviteCode(inviteCodeValue);
  if (mode === 'OPEN') return { allowed: true, mode, inviteCode: '' };
  if (mode === 'INVITE_ONLY' && await unusedInvitationExists(inviteCode)) {
    return { allowed: true, mode, inviteCode };
  }
  return { allowed: false, mode, inviteCode: '' };
}

export function registrationUnavailableMessage(mode) {
  return mode === 'INVITE_ONLY'
    ? 'LymphAware is currently available by invitation for testing. Please enter a valid unused trial invitation code.'
    : 'New LymphAware membership registration is currently closed.';
}

export async function releaseRegistrationInvitation(inviteCodeValue, userId) {
  const inviteCode = normaliseInviteCode(inviteCodeValue);
  if (!inviteCode || !userId) return;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/invitation_codes?code=eq.${encodeURIComponent(inviteCode)}&status=eq.used&used_by=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({ status: 'unused', used_by: null, used_at: null })
    }
  );
  if (!response.ok) console.error('Unable to release a failed registration invitation.');
}

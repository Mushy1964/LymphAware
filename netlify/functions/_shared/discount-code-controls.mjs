function serviceHeaders(prefer = '') {
  return {
    apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

export function normaliseManagedCode(value) {
  return String(value || '').trim().toUpperCase();
}

function parseRow(row) {
  if (!row) return null;
  return {
    code: normaliseManagedCode(row.code),
    codeType: String(row.code_type || '').trim().toUpperCase(),
    enabled: row.enabled === true,
    validFrom: row.valid_from || null,
    validUntil: row.valid_until || null,
    stripePromotionCodeId: row.stripe_promotion_code_id || null,
    createdViaAdmin: row.created_via_admin === true,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function getDiscountCodeControl(codeValue) {
  const code = normaliseManagedCode(codeValue);
  if (!code) return null;
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/discount_code_controls?code=eq.${encodeURIComponent(code)}&select=code,code_type,enabled,valid_from,valid_until,stripe_promotion_code_id,created_via_admin,created_at,updated_at&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('Discount-code availability could not be checked.');
  return parseRow((await response.json())?.[0]);
}

export async function listDiscountCodeControls() {
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/discount_code_controls?select=code,code_type,enabled,valid_from,valid_until,stripe_promotion_code_id,created_via_admin,created_at,updated_at&order=code_type.desc,code.asc`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('Discount-code controls could not be loaded.');
  return (await response.json()).map(parseRow);
}

export function discountCodeWebsiteStatus(control, expectedType = '') {
  if (!control) return { allowed: false, reason: 'UNMANAGED' };
  const type = String(expectedType || '').trim().toUpperCase();
  if (type && control.codeType !== type) return { allowed: false, reason: 'WRONG_TYPE' };
  if (!control.enabled) return { allowed: false, reason: 'PAUSED' };

  const now = Date.now();
  const starts = control.validFrom ? new Date(control.validFrom).getTime() : null;
  const ends = control.validUntil ? new Date(control.validUntil).getTime() : null;
  if (Number.isFinite(starts) && starts > now) return { allowed: false, reason: 'SCHEDULED' };
  if (Number.isFinite(ends) && ends <= now) return { allowed: false, reason: 'EXPIRED' };
  return { allowed: true, reason: 'ACTIVE' };
}

export async function updateDiscountCodeControl(codeValue, updates = {}) {
  const code = normaliseManagedCode(codeValue);
  if (!code) throw new Error('A discount code is required.');

  const payload = {
    enabled: updates.enabled === true,
    valid_from: updates.validFrom || null,
    valid_until: updates.validUntil || null,
    updated_at: new Date().toISOString()
  };
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/discount_code_controls?code=eq.${encodeURIComponent(code)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=representation'),
      body: JSON.stringify(payload)
    }
  );
  if (!response.ok) throw new Error('Discount-code controls could not be saved.');
  return parseRow((await response.json())?.[0]);
}

export async function createDiscountCodeControl({
  code,
  codeType = 'PUBLIC',
  enabled = false,
  validFrom = null,
  validUntil = null,
  stripePromotionCodeId = null,
  createdViaAdmin = true
}) {
  const normalisedCode = normaliseManagedCode(code);
  const payload = {
    code: normalisedCode,
    code_type: String(codeType || 'PUBLIC').trim().toUpperCase(),
    enabled: enabled === true,
    valid_from: validFrom || null,
    valid_until: validUntil || null,
    stripe_promotion_code_id: stripePromotionCodeId || null,
    created_via_admin: createdViaAdmin === true,
    updated_at: new Date().toISOString()
  };
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/discount_code_controls`,
    {
      method: 'POST',
      headers: serviceHeaders('return=representation'),
      body: JSON.stringify(payload)
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 409 || /duplicate/i.test(detail)) throw new Error('That discount code is already managed.');
    throw new Error('The discount code could not be added to Business Settings.');
  }
  return parseRow((await response.json())?.[0]);
}

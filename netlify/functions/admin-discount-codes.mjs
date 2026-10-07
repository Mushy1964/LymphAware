import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { recordAdminActivity } from './_shared/admin-audit.mjs';
import { PACKAGE_DEFINITIONS } from './_shared/initial-membership-checkout.mjs';
import { getRegistrationMode } from './_shared/registration-access.mjs';
import {
  createDiscountCodeControl,
  discountCodeWebsiteStatus,
  listDiscountCodeControls,
  normaliseManagedCode,
  updateDiscountCodeControl
} from './_shared/discount-code-controls.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function stripeHeaders() {
  return {
    Authorization: `Bearer ${Netlify.env.get('STRIPE_SECRET_KEY')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2026-07-29.dahlia'
  };
}

async function stripeJson(path, { method = 'GET', form = null } = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: stripeHeaders(),
    body: form ? form.toString() : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || 'Stripe could not complete the discount-code request.');
  return result;
}

async function listStripePromotions() {
  const parameters = new URLSearchParams({ limit: '100' });
  parameters.append('expand[]', 'data.promotion.coupon');
  return stripeJson(`promotion_codes?${parameters.toString()}`);
}

function couponForPromotion(promotion) {
  return promotion?.promotion?.coupon && typeof promotion.promotion.coupon === 'object'
    ? promotion.promotion.coupon
    : promotion?.coupon && typeof promotion.coupon === 'object'
      ? promotion.coupon
      : null;
}

function serialiseCode(control, promotions, registrationMode) {
  const candidates = (promotions || []).filter(item => normaliseManagedCode(item.code) === control.code);
  const promotion = candidates.find(item => item.active === true) || candidates[0] || null;
  const coupon = couponForPromotion(promotion);
  const website = discountCodeWebsiteStatus(control, control.codeType);
  const stripeUsable = promotion?.active === true && coupon?.valid !== false;
  let websiteStatus = website.reason;
  if (website.allowed && !stripeUsable) websiteStatus = 'STRIPE_INACTIVE';
  else if (website.allowed && control.codeType === 'PUBLIC' && registrationMode !== 'OPEN') websiteStatus = 'WAITING_FOR_OPEN_REGISTRATION';
  else if (website.allowed && control.codeType === 'TRIAL' && registrationMode !== 'INVITE_ONLY') websiteStatus = 'TRIAL_MODE_NOT_ACTIVE';

  return {
    ...control,
    websiteStatus,
    usableNow: website.allowed && stripeUsable && (
      (control.codeType === 'PUBLIC' && registrationMode === 'OPEN') ||
      (control.codeType === 'TRIAL' && registrationMode === 'INVITE_ONLY')
    ),
    stripe: promotion ? {
      id: promotion.id,
      active: promotion.active === true,
      expiresAt: promotion.expires_at ? new Date(Number(promotion.expires_at) * 1000).toISOString() : null,
      maxRedemptions: promotion.max_redemptions ?? null,
      timesRedeemed: Number(promotion.times_redeemed || 0),
      percentOff: coupon?.percent_off == null ? null : Number(coupon.percent_off),
      amountOff: coupon?.amount_off == null ? null : Number(coupon.amount_off),
      currency: coupon?.currency || null,
      couponValid: coupon?.valid !== false
    } : null
  };
}

function validateWindow(validFrom, validUntil) {
  const from = validFrom ? new Date(validFrom) : null;
  const until = validUntil ? new Date(validUntil) : null;
  if (from && Number.isNaN(from.getTime())) throw new Error('The valid-from date is not recognised.');
  if (until && Number.isNaN(until.getTime())) throw new Error('The valid-until date is not recognised.');
  if (from && until && until <= from) throw new Error('The valid-until date must be later than the valid-from date.');
  return {
    validFrom: from ? from.toISOString() : null,
    validUntil: until ? until.toISOString() : null
  };
}

function membershipProductIds() {
  return [...new Set(Object.values(PACKAGE_DEFINITIONS).flatMap(pkg => [pkg.initialProductId, pkg.renewalProductId]).filter(Boolean))];
}

async function createStripePublicCode({ code, percentOff, maxRedemptions }) {
  const couponForm = new URLSearchParams();
  couponForm.append('duration', 'once');
  couponForm.append('percent_off', String(percentOff));
  couponForm.append('name', `${code} – ${percentOff}% initial membership discount`);
  couponForm.append('metadata[purpose]', 'lymphaware_admin_public_discount');
  membershipProductIds().forEach((productId, index) => couponForm.append(`applies_to[products][${index}]`, productId));
  const coupon = await stripeJson('coupons', { method: 'POST', form: couponForm });

  try {
    const promotionForm = new URLSearchParams();
    promotionForm.append('code', code);
    promotionForm.append('active', 'true');
    promotionForm.append('promotion[type]', 'coupon');
    promotionForm.append('promotion[coupon]', coupon.id);
    promotionForm.append('metadata[purpose]', 'lymphaware_admin_public_discount');
    if (maxRedemptions) promotionForm.append('max_redemptions', String(maxRedemptions));
    return await stripeJson('promotion_codes', { method: 'POST', form: promotionForm });
  } catch (error) {
    try { await stripeJson(`coupons/${encodeURIComponent(coupon.id)}`, { method: 'DELETE' }); } catch {}
    throw error;
  }
}

export default async request => {
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = await verifyAdminRequest(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    if (request.method === 'GET') {
      const [controls, registrationMode, promotions] = await Promise.all([
        listDiscountCodeControls(),
        getRegistrationMode(),
        listStripePromotions()
      ]);
      return json({
        registrationMode,
        codes: controls.map(control => serialiseCode(control, promotions.data || [], registrationMode))
      });
    }

    const body = await request.json().catch(() => ({}));

    if (request.method === 'PATCH') {
      const code = normaliseManagedCode(body.code);
      const window = validateWindow(body.validFrom || null, body.validUntil || null);
      const updated = await updateDiscountCodeControl(code, {
        enabled: body.enabled === true,
        ...window
      });
      const [registrationMode, promotions] = await Promise.all([getRegistrationMode(), listStripePromotions()]);
      await recordAdminActivity({
        admin,
        actionType: 'DISCOUNT_CODE_UPDATED',
        entityType: 'DISCOUNT_CODE',
        entityId: code,
        summary: 'Discount or trial code settings updated: ' + code + '.',
        details: { enabled: updated.enabled, valid_from: updated.validFrom, valid_until: updated.validUntil }
      });
      return json({ code: serialiseCode(updated, promotions.data || [], registrationMode) });
    }

    const code = normaliseManagedCode(body.code);
    if (!/^[A-Z0-9-]{3,32}$/.test(code)) {
      return json({ error: 'Use 3–32 letters, numbers or hyphens for the discount code.' }, 400);
    }
    if (code.includes('TRIAL')) {
      return json({ error: 'Trial codes are protected. Create ordinary public discount codes here instead.' }, 400);
    }

    const percentOff = Number(body.percentOff);
    if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) {
      return json({ error: 'Enter a percentage discount greater than 0 and no more than 100.' }, 400);
    }
    const maxRedemptions = body.maxRedemptions === '' || body.maxRedemptions == null
      ? null
      : Number(body.maxRedemptions);
    if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000)) {
      return json({ error: 'Maximum uses must be a whole number between 1 and 100,000, or left blank.' }, 400);
    }
    const window = validateWindow(body.validFrom || null, body.validUntil || null);

    const existingControls = await listDiscountCodeControls();
    if (existingControls.some(item => item.code === code)) {
      return json({ error: 'That code already exists in Business Settings.' }, 409);
    }

    const promotion = await createStripePublicCode({ code, percentOff, maxRedemptions });
    const created = await createDiscountCodeControl({
      code,
      codeType: 'PUBLIC',
      enabled: body.enabled === true,
      validFrom: window.validFrom,
      validUntil: window.validUntil,
      stripePromotionCodeId: promotion.id,
      createdViaAdmin: true
    });
    const registrationMode = await getRegistrationMode();
    const promotions = await listStripePromotions();
    await recordAdminActivity({
      admin,
      actionType: 'DISCOUNT_CODE_CREATED',
      entityType: 'DISCOUNT_CODE',
      entityId: code,
      summary: 'Public discount code created: ' + code + '.',
      details: { percent_off: percentOff, max_redemptions: maxRedemptions, enabled: created.enabled, valid_from: created.validFrom, valid_until: created.validUntil }
    });
    return json({ created: true, code: serialiseCode(created, promotions.data || [], registrationMode) }, 201);
  } catch (error) {
    console.error('Admin discount-code error:', error);
    return json({ error: error instanceof Error ? error.message : 'Discount-code settings could not be updated.' }, 500);
  }
};

export const config = { path: '/api/admin-discount-codes' };

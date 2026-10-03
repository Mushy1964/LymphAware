import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { PACKAGE_DEFINITIONS } from './_shared/initial-membership-checkout.mjs';
import {
  BUSINESS_SETTING_KEYS,
  getBusinessSettings,
  normaliseBusinessSettings,
  publicPricing,
  saveBusinessSettings
} from './_shared/business-settings.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

const RENEWAL_PRICES = {
  STANDARD: PACKAGE_DEFINITIONS.STANDARD.renewals,
  PLUS: PACKAGE_DEFINITIONS.PLUS.renewals,
  MULTILINGUAL: PACKAGE_DEFINITIONS.MULTILINGUAL.renewals
};

function validateSubmittedSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('No settings were supplied.');
  for (const key of BUSINESS_SETTING_KEYS) {
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < 0 || value > 999999) {
      throw new Error('Every price must be a valid amount between £0.00 and £9,999.99.');
    }
  }
  const settings = normaliseBusinessSettings(input);
  const checks = [
    ['Standard', settings.price_standard_1y_pence, RENEWAL_PRICES.STANDARD[1]],
    ['Standard', settings.price_standard_2y_pence, RENEWAL_PRICES.STANDARD[2]],
    ['Standard', settings.price_standard_3y_pence, RENEWAL_PRICES.STANDARD[3]],
    ['Plus', settings.price_plus_1y_pence, RENEWAL_PRICES.PLUS[1]],
    ['Plus', settings.price_plus_2y_pence, RENEWAL_PRICES.PLUS[2]],
    ['Plus', settings.price_plus_3y_pence, RENEWAL_PRICES.PLUS[3]],
    ['Multilingual', settings.price_multilingual_1y_pence, RENEWAL_PRICES.MULTILINGUAL[1]],
    ['Multilingual', settings.price_multilingual_2y_pence, RENEWAL_PRICES.MULTILINGUAL[2]],
    ['Multilingual', settings.price_multilingual_3y_pence, RENEWAL_PRICES.MULTILINGUAL[3]]
  ];
  const invalid = checks.find(([, initial, renewal]) => initial < renewal);
  if (invalid) {
    throw new Error(`${invalid[0]} joining prices cannot be lower than the linked automatic-renewal price. Contact technical support if you want to change renewal pricing.`);
  }
  return settings;
}

export default async request => {
  if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  try {
    const admin = await verifyAdminRequest(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    if (request.method === 'GET') {
      const settings = await getBusinessSettings({ strict: true });
      return json({
        settings,
        pricing: publicPricing(settings),
        renewalPrices: RENEWAL_PRICES,
        updatedAt: new Date().toISOString()
      });
    }

    const body = await request.json().catch(() => ({}));
    const settings = validateSubmittedSettings(body.settings);
    const saved = await saveBusinessSettings(settings);
    return json({
      saved: true,
      settings: saved,
      pricing: publicPricing(saved),
      renewalPrices: RENEWAL_PRICES,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin business settings error:', error);
    return json({ error: error instanceof Error ? error.message : 'Business settings could not be updated.' }, 500);
  }
};

export const config = { path: '/api/admin-business-settings' };

import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { changedSettings, recordAdminActivity } from './_shared/admin-audit.mjs';
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
    ['Standard', settings.price_standard_1y_pence, settings.renewal_standard_1y_pence],
    ['Standard', settings.price_standard_2y_pence, settings.renewal_standard_2y_pence],
    ['Standard', settings.price_standard_3y_pence, settings.renewal_standard_3y_pence],
    ['Plus', settings.price_plus_1y_pence, settings.renewal_plus_1y_pence],
    ['Plus', settings.price_plus_2y_pence, settings.renewal_plus_2y_pence],
    ['Plus', settings.price_plus_3y_pence, settings.renewal_plus_3y_pence],
    ['Multilingual', settings.price_multilingual_1y_pence, settings.renewal_multilingual_1y_pence],
    ['Multilingual', settings.price_multilingual_2y_pence, settings.renewal_multilingual_2y_pence],
    ['Multilingual', settings.price_multilingual_3y_pence, settings.renewal_multilingual_3y_pence]
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
        renewalPrices: publicPricing(settings).renewals,
        updatedAt: new Date().toISOString()
      });
    }

    const body = await request.json().catch(() => ({}));
    const before = await getBusinessSettings({ strict: true });
    const settings = validateSubmittedSettings(body.settings);
    const saved = await saveBusinessSettings(settings);
    const changes = changedSettings(before, saved);
    if (Object.keys(changes).length) {
      await recordAdminActivity({
        admin,
        actionType: 'BUSINESS_SETTINGS_UPDATED',
        entityType: 'SYSTEM_SETTINGS',
        summary: 'Business prices or postage settings updated.',
        details: { changes }
      });
    }
    return json({
      saved: true,
      settings: saved,
      pricing: publicPricing(saved),
      renewalPrices: publicPricing(saved).renewals,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin business settings error:', error);
    return json({ error: error instanceof Error ? error.message : 'Business settings could not be updated.' }, 500);
  }
};

export const config = { path: '/api/admin-business-settings' };

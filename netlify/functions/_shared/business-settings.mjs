const DEFAULTS = Object.freeze({
  price_standard_1y_pence: 2499,
  price_standard_2y_pence: 3499,
  price_standard_3y_pence: 4499,
  price_plus_1y_pence: 3499,
  price_plus_2y_pence: 4499,
  price_plus_3y_pence: 5499,
  price_multilingual_1y_pence: 5499,
  price_multilingual_2y_pence: 6999,
  price_multilingual_3y_pence: 8499,
  price_additional_card_pence: 699,
  price_lanyard_holder_pence: 799,
  price_additional_language_pence: 2499,
  postage_uk_pence: 299,
  postage_europe_pence: 499,
  postage_rest_of_world_pence: 999
});

export const BUSINESS_SETTING_KEYS = Object.freeze(Object.keys(DEFAULTS));
export const DEFAULT_BUSINESS_SETTINGS = DEFAULTS;

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function serviceHeaders(prefer = '') {
  return {
    apikey: env('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${env('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

function validPence(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 999999 ? number : null;
}

export function normaliseBusinessSettings(input = {}) {
  const result = { ...DEFAULTS };
  for (const key of BUSINESS_SETTING_KEYS) {
    const value = validPence(input[key]);
    if (value !== null) result[key] = value;
  }
  return result;
}

export async function getBusinessSettings({ strict = false } = {}) {
  const supabaseUrl = env('SUPABASE_URL');
  const secretKey = env('SUPABASE_SECRET_KEY');
  if (!supabaseUrl || !secretKey) {
    if (strict) throw new Error('Business pricing configuration is unavailable.');
    return { ...DEFAULTS };
  }

  try {
    const filter = `in.(${BUSINESS_SETTING_KEYS.join(',')})`;
    const response = await fetch(
      `${supabaseUrl}/rest/v1/system_settings?setting_key=${encodeURIComponent(filter)}&select=setting_key,setting_value`,
      { headers: serviceHeaders() }
    );
    if (!response.ok) throw new Error('Business pricing settings could not be read.');

    const settings = { ...DEFAULTS };
    for (const row of await response.json()) {
      if (!BUSINESS_SETTING_KEYS.includes(row.setting_key)) continue;
      const value = validPence(row.setting_value);
      if (value !== null) settings[row.setting_key] = value;
    }
    return settings;
  } catch (error) {
    if (strict) throw error;
    console.error('Using default business settings:', error instanceof Error ? error.message : error);
    return { ...DEFAULTS };
  }
}

export async function saveBusinessSettings(settings) {
  const supabaseUrl = env('SUPABASE_URL');
  const secretKey = env('SUPABASE_SECRET_KEY');
  if (!supabaseUrl || !secretKey) throw new Error('Business settings cannot be saved.');

  const normalised = normaliseBusinessSettings(settings);
  const updatedAt = new Date().toISOString();
  const rows = BUSINESS_SETTING_KEYS.map(setting_key => ({
    setting_key,
    setting_value: String(normalised[setting_key]),
    updated_at: updatedAt
  }));

  const response = await fetch(
    `${supabaseUrl}/rest/v1/system_settings?on_conflict=setting_key`,
    {
      method: 'POST',
      headers: serviceHeaders('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(rows)
    }
  );
  if (!response.ok) throw new Error('Business settings could not be saved.');
  return normalised;
}

export function publicPricing(settings) {
  const s = normaliseBusinessSettings(settings);
  return {
    packages: {
      STANDARD: { 1: s.price_standard_1y_pence, 2: s.price_standard_2y_pence, 3: s.price_standard_3y_pence },
      PLUS: { 1: s.price_plus_1y_pence, 2: s.price_plus_2y_pence, 3: s.price_plus_3y_pence },
      MULTILINGUAL: { 1: s.price_multilingual_1y_pence, 2: s.price_multilingual_2y_pence, 3: s.price_multilingual_3y_pence }
    },
    additionalItems: {
      CARD: s.price_additional_card_pence,
      LANYARD: s.price_lanyard_holder_pence,
      LANGUAGE: s.price_additional_language_pence
    },
    shipping: {
      UK: s.postage_uk_pence,
      EUROPE: s.postage_europe_pence,
      REST_OF_WORLD: s.postage_rest_of_world_pence
    }
  };
}

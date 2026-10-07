const DEFAULTS = Object.freeze({
  registration_mode: 'INVITE_ONLY',
  announcement_enabled: false,
  announcement_message: '',
  announcement_start_at: '',
  announcement_end_at: '',
  feature_auto_renew_signup_enabled: true,
  feature_additional_items_enabled: true,
  feature_additional_languages_enabled: true,
  communications_renewal_reminders_enabled: true,
  communications_profile_review_reminders_enabled: true,
  communications_expiry_notices_enabled: true,
  communications_order_notifications_enabled: true,
  communications_admin_notification_email: 'admin@lymphawareid.com'
});

export const CONTROL_SETTING_KEYS = Object.freeze(Object.keys(DEFAULTS));
export const DEFAULT_CONTROL_SETTINGS = DEFAULTS;

function env(name) {
  return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || '').trim();
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

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function validEmail(value, fallback = '') {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : fallback;
}

export function normaliseControlSettings(input = {}) {
  const registrationMode = String(input.registration_mode || DEFAULTS.registration_mode).trim().toUpperCase();
  return {
    registration_mode: ['OPEN', 'INVITE_ONLY', 'CLOSED'].includes(registrationMode)
      ? registrationMode
      : DEFAULTS.registration_mode,
    announcement_enabled: parseBoolean(input.announcement_enabled, DEFAULTS.announcement_enabled),
    announcement_message: String(input.announcement_message ?? DEFAULTS.announcement_message).trim().slice(0, 280),
    announcement_start_at: parseDate(input.announcement_start_at),
    announcement_end_at: parseDate(input.announcement_end_at),
    feature_auto_renew_signup_enabled: parseBoolean(input.feature_auto_renew_signup_enabled, DEFAULTS.feature_auto_renew_signup_enabled),
    feature_additional_items_enabled: parseBoolean(input.feature_additional_items_enabled, DEFAULTS.feature_additional_items_enabled),
    feature_additional_languages_enabled: parseBoolean(input.feature_additional_languages_enabled, DEFAULTS.feature_additional_languages_enabled),
    communications_renewal_reminders_enabled: parseBoolean(input.communications_renewal_reminders_enabled, DEFAULTS.communications_renewal_reminders_enabled),
    communications_profile_review_reminders_enabled: parseBoolean(input.communications_profile_review_reminders_enabled, DEFAULTS.communications_profile_review_reminders_enabled),
    communications_expiry_notices_enabled: parseBoolean(input.communications_expiry_notices_enabled, DEFAULTS.communications_expiry_notices_enabled),
    communications_order_notifications_enabled: parseBoolean(input.communications_order_notifications_enabled, DEFAULTS.communications_order_notifications_enabled),
    communications_admin_notification_email: validEmail(input.communications_admin_notification_email, DEFAULTS.communications_admin_notification_email)
  };
}

export async function getControlSettings({ strict = false } = {}) {
  const supabaseUrl = env('SUPABASE_URL');
  const secretKey = env('SUPABASE_SECRET_KEY');
  if (!supabaseUrl || !secretKey) {
    if (strict) throw new Error('Control settings are unavailable.');
    return { ...DEFAULTS };
  }

  try {
    const filter = `in.(${CONTROL_SETTING_KEYS.join(',')})`;
    const response = await fetch(
      `${supabaseUrl}/rest/v1/system_settings?setting_key=${encodeURIComponent(filter)}&select=setting_key,setting_value`,
      { headers: serviceHeaders() }
    );
    if (!response.ok) throw new Error('Control settings could not be read.');
    const raw = {};
    for (const row of await response.json()) raw[row.setting_key] = row.setting_value;
    return normaliseControlSettings({ ...DEFAULTS, ...raw });
  } catch (error) {
    if (strict) throw error;
    console.error('Using default control settings:', error instanceof Error ? error.message : error);
    return { ...DEFAULTS };
  }
}

export async function saveControlSettings(settings) {
  const supabaseUrl = env('SUPABASE_URL');
  if (!supabaseUrl || !env('SUPABASE_SECRET_KEY')) throw new Error('Control settings cannot be saved.');
  const normalised = normaliseControlSettings(settings);
  if (
    normalised.announcement_start_at &&
    normalised.announcement_end_at &&
    new Date(normalised.announcement_end_at).getTime() <= new Date(normalised.announcement_start_at).getTime()
  ) {
    throw new Error('Announcement end time must be after its start time.');
  }

  const now = new Date().toISOString();
  const rows = CONTROL_SETTING_KEYS.map(setting_key => ({
    setting_key,
    setting_value: String(normalised[setting_key]),
    updated_at: now
  }));
  const response = await fetch(
    `${supabaseUrl}/rest/v1/system_settings?on_conflict=setting_key`,
    {
      method: 'POST',
      headers: serviceHeaders('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(rows)
    }
  );
  if (!response.ok) throw new Error(`Control settings could not be saved: ${await response.text()}`);
  return normalised;
}

export function publicControlSettings(settings) {
  const s = normaliseControlSettings(settings);
  const now = Date.now();
  const start = s.announcement_start_at ? new Date(s.announcement_start_at).getTime() : null;
  const end = s.announcement_end_at ? new Date(s.announcement_end_at).getTime() : null;
  const announcementActive =
    s.announcement_enabled &&
    Boolean(s.announcement_message) &&
    (!start || start <= now) &&
    (!end || end > now);

  return {
    registrationMode: s.registration_mode,
    features: {
      autoRenewSignup: s.feature_auto_renew_signup_enabled,
      additionalItems: s.feature_additional_items_enabled,
      additionalLanguages: s.feature_additional_languages_enabled
    },
    announcement: {
      active: announcementActive,
      message: announcementActive ? s.announcement_message : ''
    }
  };
}

export function communicationsEnabled(settings, key) {
  return normaliseControlSettings(settings)[key] === true;
}

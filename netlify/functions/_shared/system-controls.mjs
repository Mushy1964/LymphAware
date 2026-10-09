const DEFAULTS = Object.freeze({
  announcement_enabled: 'false',
  announcement_message: '',
  announcement_start_at: '',
  announcement_end_at: '',
  communications_admin_notification_email: 'admin@lymphawareid.com',
  communications_expiry_notices_enabled: 'true',
  communications_profile_review_reminders_enabled: 'true',
  communications_renewal_reminders_enabled: 'true',
  feature_additional_items_enabled: 'true',
  feature_additional_languages_enabled: 'true',
  feature_auto_renew_signup_enabled: 'true',
  feature_package_standard_enabled: 'true',
  feature_package_plus_enabled: 'true',
  feature_package_multilingual_enabled: 'true',
  feature_term_1y_enabled: 'true',
  feature_term_2y_enabled: 'true',
  feature_term_3y_enabled: 'true',
  feature_language_fr_enabled: 'true',
  feature_language_es_enabled: 'true',
  feature_language_de_enabled: 'true',
  admin_mfa_required: 'false'
});

export const CONTROL_SETTING_KEYS = Object.freeze(Object.keys(DEFAULTS));
export const DEFAULT_CONTROL_SETTINGS = DEFAULTS;

function env(name) {
  return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || '').trim();
}

function headers() {
  const secret = env('SUPABASE_SECRET_KEY');
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function asBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (['true','1','yes','on'].includes(raw)) return true;
  if (['false','0','no','off'].includes(raw)) return false;
  return fallback;
}

function isoOrBlank(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export async function getControlSettings({ strict = false } = {}) {
  const supabaseUrl = env('SUPABASE_URL');
  const secret = env('SUPABASE_SECRET_KEY');
  if (!supabaseUrl || !secret) {
    if (strict) throw new Error('System controls are unavailable.');
    return { ...DEFAULTS };
  }
  try {
    const filter = `in.(${CONTROL_SETTING_KEYS.join(',')})`;
    const response = await fetch(
      `${supabaseUrl}/rest/v1/system_settings?setting_key=${encodeURIComponent(filter)}&select=setting_key,setting_value`,
      { headers: headers() }
    );
    if (!response.ok) throw new Error('System controls could not be read.');
    const settings = { ...DEFAULTS };
    for (const row of await response.json()) {
      if (CONTROL_SETTING_KEYS.includes(row.setting_key)) settings[row.setting_key] = String(row.setting_value ?? '');
    }
    return settings;
  } catch (error) {
    if (strict) throw error;
    console.error('Using default system controls:', error instanceof Error ? error.message : error);
    return { ...DEFAULTS };
  }
}

export function publicControls(settings, now = new Date()) {
  const s = { ...DEFAULTS, ...(settings || {}) };
  const start = isoOrBlank(s.announcement_start_at);
  const end = isoOrBlank(s.announcement_end_at);
  const nowMs = now.getTime();
  const activeAnnouncement =
    asBool(s.announcement_enabled) &&
    String(s.announcement_message || '').trim().length > 0 &&
    (!start || new Date(start).getTime() <= nowMs) &&
    (!end || new Date(end).getTime() >= nowMs);

  return {
    announcement: {
      enabled: activeAnnouncement,
      message: activeAnnouncement ? String(s.announcement_message || '').trim() : '',
      startAt: start || null,
      endAt: end || null
    },
    features: {
      packages: {
        STANDARD: asBool(s.feature_package_standard_enabled, true),
        PLUS: asBool(s.feature_package_plus_enabled, true),
        MULTILINGUAL: asBool(s.feature_package_multilingual_enabled, true)
      },
      terms: {
        1: asBool(s.feature_term_1y_enabled, true),
        2: asBool(s.feature_term_2y_enabled, true),
        3: asBool(s.feature_term_3y_enabled, true)
      },
      autoRenewSignup: asBool(s.feature_auto_renew_signup_enabled, true),
      additionalItems: asBool(s.feature_additional_items_enabled, true),
      additionalLanguages: asBool(s.feature_additional_languages_enabled, true),
      languages: {
        FR: asBool(s.feature_language_fr_enabled, true),
        ES: asBool(s.feature_language_es_enabled, true),
        DE: asBool(s.feature_language_de_enabled, true)
      }
    }
  };
}

export function communicationControls(settings) {
  const s = { ...DEFAULTS, ...(settings || {}) };
  return {
    renewalReminders: asBool(s.communications_renewal_reminders_enabled, true),
    expiryNotices: asBool(s.communications_expiry_notices_enabled, true),
    profileReviewReminders: asBool(s.communications_profile_review_reminders_enabled, true),
    adminNotificationEmail: String(s.communications_admin_notification_email || DEFAULTS.communications_admin_notification_email).trim().toLowerCase()
  };
}

export function adminMfaRequired(settings) {
  return asBool((settings || {}).admin_mfa_required, false);
}

import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { changedSettings, recordAdminActivity } from './_shared/admin-audit.mjs';
import {
  getControlSettings,
  normaliseControlSettings,
  publicControlSettings,
  saveControlSettings
} from './_shared/control-settings.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function validate(input) {
  const settings = normaliseControlSettings(input);
  if (settings.announcement_enabled && !settings.announcement_message) {
    throw new Error('Add an announcement message before switching the banner on.');
  }
  if (settings.announcement_message.length > 280) {
    throw new Error('Announcement text must be 280 characters or fewer.');
  }
  return settings;
}

export default async request => {
  if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = await verifyAdminRequest(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    if (request.method === 'GET') {
      const settings = await getControlSettings({ strict: true });
      return json({
        settings,
        public: publicControlSettings(settings),
        loadedAt: new Date().toISOString()
      });
    }

    const body = await request.json().catch(() => ({}));
    const before = await getControlSettings({ strict: true });
    const after = validate(body.settings || {});

    if (
      before.registration_mode !== after.registration_mode &&
      String(body.registrationModeConfirmation || '').toUpperCase() !== after.registration_mode
    ) {
      return json({
        error: 'Confirm the selected registration mode before saving this change.'
      }, 400);
    }

    const saved = await saveControlSettings(after);
    const changes = changedSettings(before, saved);

    if (Object.keys(changes).length) {
      await recordAdminActivity({
        admin,
        actionType: 'CONTROL_SETTINGS_UPDATED',
        entityType: 'SYSTEM_SETTINGS',
        summary: 'Admin Control Centre settings updated.',
        details: { changes }
      });
    }

    return json({
      saved: true,
      settings: saved,
      public: publicControlSettings(saved),
      changed: Object.keys(changes),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin Control Centre settings error:', error);
    return json({ error: error instanceof Error ? error.message : 'Control settings could not be updated.' }, 500);
  }
};

export const config = { path: '/api/admin-control-settings' };

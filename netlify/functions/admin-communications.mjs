import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { changedSettings, recordAdminActivity } from './_shared/admin-audit.mjs';
import { getControlSettings, saveControlSettings } from './_shared/control-settings.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

const COMM_KEYS = [
  'communications_renewal_reminders_enabled',
  'communications_profile_review_reminders_enabled',
  'communications_expiry_notices_enabled',
  'communications_order_notifications_enabled',
  'communications_admin_notification_email'
];

export default async request => {
  if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  try {
    const admin = await verifyAdminRequest(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);
    const before = await getControlSettings({ strict: true });

    if (request.method === 'GET') {
      return json({
        settings: Object.fromEntries(COMM_KEYS.map(key => [key, before[key]])),
        loadedAt: new Date().toISOString()
      });
    }

    const body = await request.json().catch(() => ({}));
    const supplied = body.settings || {};
    const merged = { ...before };
    for (const key of COMM_KEYS) {
      if (Object.prototype.hasOwnProperty.call(supplied, key)) merged[key] = supplied[key];
    }
    const saved = await saveControlSettings(merged);
    const changes = changedSettings(
      Object.fromEntries(COMM_KEYS.map(key => [key, before[key]])),
      Object.fromEntries(COMM_KEYS.map(key => [key, saved[key]]))
    );

    if (Object.keys(changes).length) {
      await recordAdminActivity({
        admin,
        actionType: 'COMMUNICATION_SETTINGS_UPDATED',
        entityType: 'SYSTEM_SETTINGS',
        summary: 'Customer and administrator communication settings updated.',
        details: { changes }
      });
    }

    return json({
      saved: true,
      settings: Object.fromEntries(COMM_KEYS.map(key => [key, saved[key]])),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin communication settings error:', error);
    return json({ error: error instanceof Error ? error.message : 'Communication settings could not be updated.' }, 500);
  }
};

export const config = { path: '/api/admin-communications' };

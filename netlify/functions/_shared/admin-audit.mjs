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

export async function recordAdminActivity({
  admin,
  actionType,
  entityType = null,
  entityId = null,
  summary,
  details = {}
}) {
  if (!admin?.email || !actionType || !summary) return;
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/admin_activity_log`, {
    method: 'POST',
    headers: serviceHeaders('return=minimal'),
    body: JSON.stringify({
      actor_user_id: admin.id || null,
      actor_email: admin.email,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      summary: String(summary).slice(0, 500),
      details
    })
  });
  if (!response.ok) {
    console.error('Unable to record admin activity:', await response.text());
  }
}

export function changedSettings(before = {}, after = {}) {
  const changed = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return changed;
}

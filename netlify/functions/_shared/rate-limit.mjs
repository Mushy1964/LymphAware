import crypto from 'node:crypto';

function env(name) {
  return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || '').trim();
}

function serviceHeaders(prefer = '') {
  const secret = env('SUPABASE_SECRET_KEY');
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

function clientAddress(request) {
  const direct = String(request.headers.get('x-nf-client-connection-ip') || '').trim();
  if (direct) return direct;
  return String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
}

function clientHash(request, scope) {
  const ip = clientAddress(request);
  if (!ip) return '';
  return crypto.createHash('sha256').update(`${scope}|${ip}|${env('SUPABASE_SECRET_KEY')}`).digest('hex');
}

export async function enforcePublicRateLimit(request, { scope, limit, windowSeconds }) {
  const hash = clientHash(request, scope);
  if (!hash) return { allowed: true, remaining: null };
  const supabaseUrl = env('SUPABASE_URL');
  if (!supabaseUrl || !env('SUPABASE_SECRET_KEY')) return { allowed: true, remaining: null };

  try {
    const since = new Date(Date.now() - Number(windowSeconds || 600) * 1000).toISOString();
    const countResponse = await fetch(
      `${supabaseUrl}/rest/v1/rate_limit_events?scope=eq.${encodeURIComponent(scope)}&client_hash=eq.${encodeURIComponent(hash)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
      { headers: { ...serviceHeaders(), Prefer: 'count=exact' } }
    );
    if (!countResponse.ok) throw new Error('Rate-limit count unavailable.');
    const range = countResponse.headers.get('content-range') || '';
    const count = Number(range.split('/')[1]);
    if (Number.isFinite(count) && count >= limit) return { allowed: false, remaining: 0 };

    await fetch(`${supabaseUrl}/rest/v1/rate_limit_events`, {
      method: 'POST',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({ scope, client_hash: hash })
    });

    return { allowed: true, remaining: Number.isFinite(count) ? Math.max(0, limit - count - 1) : null };
  } catch (error) {
    console.error('Public rate-limit check failed open:', error instanceof Error ? error.message : error);
    return { allowed: true, remaining: null };
  }
}

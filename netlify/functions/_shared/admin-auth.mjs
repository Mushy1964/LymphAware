import { webcrypto } from 'node:crypto';

function env(name) {
  return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || '').trim();
}

function decodeJson(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

async function fetchJwks(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifySignature(token, header, jwk) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = Buffer.from(encodedSignature, 'base64url');

  if (header.alg === 'ES256' && jwk.kty === 'EC' && jwk.crv === 'P-256') {
    const key = await webcrypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    return webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      data
    );
  }

  if (header.alg === 'RS256' && jwk.kty === 'RSA') {
    const key = await webcrypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return webcrypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      signature,
      data
    );
  }

  return false;
}

export async function verifyAdminRequest(request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.slice(7).trim();
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);

    if (!header?.kid || !['ES256', 'RS256'].includes(header.alg)) return null;

    const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
    const adminEmail = env('LYMPHAWARE_ADMIN_EMAIL').toLowerCase();
    if (!supabaseUrl || !adminEmail) return null;

    const now = Math.floor(Date.now() / 1000);
    if (!payload?.sub || !payload?.exp || Number(payload.exp) <= now) return null;
    if (payload.nbf && Number(payload.nbf) > now) return null;
    if (payload.iss !== `${supabaseUrl}/auth/v1`) return null;
    if (payload.role !== 'authenticated') return null;

    const email = String(payload.email || '').trim().toLowerCase();
    if (!email || email !== adminEmail) return null;

    const jwks = await fetchJwks(supabaseUrl);
    const jwk = Array.isArray(jwks?.keys)
      ? jwks.keys.find(key => key.kid === header.kid)
      : null;
    if (!jwk) return null;

    const valid = await verifySignature(token, header, jwk);
    if (!valid) return null;

    return { id: payload.sub, email };
  } catch {
    return null;
  }
}

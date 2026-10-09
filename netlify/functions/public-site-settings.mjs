import { getControlSettings, publicControls } from './_shared/system-controls.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async request => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  try {
    const settings = await getControlSettings();
    return json(publicControls(settings));
  } catch (error) {
    console.error('Unable to read public site controls:', error instanceof Error ? error.message : error);
    return json({ announcement: { enabled: false, message: '' }, features: {} });
  }
};

export const config = { path: '/api/public-site-settings' };

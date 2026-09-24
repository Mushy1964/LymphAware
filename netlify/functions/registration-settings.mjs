import { getRegistrationMode } from './_shared/registration-access.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  try {
    const mode = await getRegistrationMode();
    return json({
      mode,
      codeRequired: mode === 'INVITE_ONLY',
      codeLabel: mode === 'INVITE_ONLY' ? 'Trial code' : 'Discount code (optional)',
      codeHelp: mode === 'INVITE_ONLY'
        ? 'Enter the code provided in your LymphAware ID trial invitation. It is applied automatically at secure checkout.'
        : 'If you have an active LymphAware ID promotional code, enter it here. Leave this blank if you do not have one. Any discount applies only to the initial checkout and never reduces automatic-renewal prices.'
    });
  } catch (error) {
    console.error('Unable to read registration settings:', error instanceof Error ? error.message : error);
    return json({ mode: 'INVITE_ONLY', codeRequired: true, codeLabel: 'Trial code' });
  }
};

export const config = { path: '/api/registration-settings' };

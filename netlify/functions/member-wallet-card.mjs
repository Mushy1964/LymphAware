import { loadWalletMember, walletProviderReadiness } from './_shared/wallet-member.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  try {
    const loaded = await loadWalletMember(request);
    if (loaded.response) return loaded.response;

    return json({
      eligible: true,
      ...loaded.card,
      providers: walletProviderReadiness()
    });
  } catch (error) {
    console.error('Member Wallet card error:', error);
    return json({ error: 'Your digital LymphAware ID could not be prepared.' }, 500);
  }
};

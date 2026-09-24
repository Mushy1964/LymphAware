function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async () => {
  const supabaseUrl = String(Netlify.env.get('SUPABASE_URL') || '').trim();
  const supabaseSecret = String(Netlify.env.get('SUPABASE_SECRET_KEY') || '').trim();
  const stripeSecret = String(Netlify.env.get('STRIPE_SECRET_KEY') || '').trim();

  const result = {
    env: {
      SUPABASE_URL: Boolean(supabaseUrl),
      SUPABASE_SECRET_KEY: Boolean(supabaseSecret),
      STRIPE_SECRET_KEY: Boolean(stripeSecret)
    },
    supabase: {},
    stripe: {}
  };

  const serviceHeaders = supabaseSecret ? {
    apikey: supabaseSecret,
    Authorization: `Bearer ${supabaseSecret}`,
    'Content-Type': 'application/json'
  } : {};

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/system_settings?setting_key=eq.registration_mode&select=setting_value&limit=1`,
      { headers: serviceHeaders }
    );
    result.supabase.registration_mode_status = response.status;
    result.supabase.registration_mode_body = response.ok ? await response.json() : null;
  } catch (error) {
    result.supabase.registration_mode_error = error instanceof Error ? error.message : String(error);
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/pilot_invites?invite_code=eq.LYMPHAWAREIDTRIAL&active=eq.true&select=id,email&limit=1`,
      { headers: serviceHeaders }
    );
    const body = await response.json().catch(() => null);
    result.supabase.invite_status = response.status;
    result.supabase.invite_found = Array.isArray(body) && Boolean(body[0]?.id);
  } catch (error) {
    result.supabase.invite_error = error instanceof Error ? error.message : String(error);
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/registration_email_exists`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ p_email: 'diagnostic-registration@example.com' })
    });
    const body = await response.json().catch(() => null);
    result.supabase.email_rpc_status = response.status;
    result.supabase.email_rpc_result = response.ok ? body : null;
  } catch (error) {
    result.supabase.email_rpc_error = error instanceof Error ? error.message : String(error);
  }

  try {
    const params = new URLSearchParams({ code: 'LYMPHAWAREIDTRIAL', active: 'true', limit: '1' });
    params.append('expand[]', 'data.promotion.coupon');
    const response = await fetch(`https://api.stripe.com/v1/promotion_codes?${params}`, {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        'Stripe-Version': '2026-07-29.dahlia'
      }
    });
    const body = await response.json().catch(() => null);
    result.stripe.promotion_status = response.status;
    result.stripe.promotion_found = Array.isArray(body?.data) && Boolean(body.data[0]?.id);
    result.stripe.promotion_code = body?.data?.[0]?.code || null;
    result.stripe.percent_off = body?.data?.[0]?.promotion?.coupon?.percent_off ?? null;
    result.stripe.duration = body?.data?.[0]?.promotion?.coupon?.duration ?? null;
  } catch (error) {
    result.stripe.promotion_error = error instanceof Error ? error.message : String(error);
  }

  return json(result);
};

export const config = { path: '/api/registration-diagnostic-240926' };

import { brandedEmailHtml } from './_shared/email-branding.mjs';
import { serviceHeaders } from './_shared/membership-contract.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function sendEmail({ to, subject, text }) {
  const apiKey = String(Netlify.env.get('RESEND_API_KEY') || '').trim();
  if (!apiKey || !to) return { ok: false, error: 'Email delivery is not configured.' };
  const from = String(Netlify.env.get('ORDER_NOTIFICATION_FROM') || 'LymphAware ID <notifications@lymphawareid.com>').trim();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html: brandedEmailHtml({ title: subject, text })
    })
  });
  if (!response.ok) return { ok: false, error: await response.text() };
  return { ok: true };
}

async function stopFutureRenewal(subscriptionId) {
  if (!subscriptionId) return;
  const key = String(Netlify.env.get('STRIPE_SECRET_KEY') || '').trim();
  if (!key) return;
  const body = new URLSearchParams({ cancel_at_period_end: 'true' });
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2026-07-29.dahlia'
    },
    body: body.toString()
  });
  if (!response.ok) throw new Error('Automatic renewal could not be stopped while the cancellation request was submitted.');
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const token = authHeader.slice(7).trim();

    const userResponse = await fetch(`${Netlify.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: {
        apikey: Netlify.env.get('SUPABASE_PUBLISHABLE_KEY'),
        Authorization: `Bearer ${token}`
      }
    });
    if (!userResponse.ok) return json({ error: 'Unable to verify your LymphAware ID account.' }, 401);
    const user = await userResponse.json();
    if (!user?.id || !user?.email) return json({ error: 'Unable to verify your LymphAware ID account.' }, 401);

    const base = Netlify.env.get('SUPABASE_URL');
    const headers = serviceHeaders();
    const membershipResponse = await fetch(
      `${base}/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}&select=id,membership_status,payment_status,membership_start,stripe_subscription_id,auto_renew_enabled,initial_cooling_off_cancellation_requested_at,initial_cooling_off_cancellation_status&limit=1`,
      { headers }
    );
    if (!membershipResponse.ok) throw new Error('Unable to load your membership.');
    const membership = (await membershipResponse.json())?.[0];
    if (!membership || !['ACTIVE','PILOT','SPONSORED'].includes(String(membership.membership_status || '').toUpperCase())) {
      return json({ error: 'There is no active membership available for an initial cooling-off cancellation request.' }, 400);
    }
    if (membership.initial_cooling_off_cancellation_requested_at) {
      return json({ requested: true, alreadyRequested: true, status: membership.initial_cooling_off_cancellation_status || 'REQUESTED' });
    }

    const start = new Date(membership.membership_start || 0);
    const deadline = new Date(start);
    deadline.setUTCDate(deadline.getUTCDate() + 14);
    if (!Number.isFinite(start.getTime()) || deadline.getTime() < Date.now()) {
      return json({ error: 'The initial 14-day cooling-off period has ended. Please contact admin@lymphawareid.com if you still need help.' }, 400);
    }

    const orderResponse = await fetch(
      `${base}/rest/v1/orders?user_id=eq.${encodeURIComponent(user.id)}&order_type=eq.INITIAL_MEMBERSHIP&select=id,order_number,order_status,payment_status,total_pence&order=paid_at.desc&limit=1`,
      { headers }
    );
    if (!orderResponse.ok) throw new Error('Unable to load your initial membership order.');
    const order = (await orderResponse.json())?.[0] || null;

    const now = new Date().toISOString();
    await stopFutureRenewal(membership.stripe_subscription_id);

    const membershipUpdate = await fetch(
      `${base}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({
          initial_cooling_off_cancellation_requested_at: now,
          initial_cooling_off_cancellation_status: 'REQUESTED',
          auto_renew_enabled: false,
          auto_renew_cancelled_at: membership.auto_renew_enabled ? now : null,
          updated_at: now
        })
      }
    );
    if (!membershipUpdate.ok) throw new Error('Your cancellation request could not be recorded.');

    if (order?.id && !['COMPLETED','CANCELLED','REFUNDED'].includes(String(order.order_status || '').toUpperCase())) {
      const orderUpdate = await fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({ order_status: 'CANCELLATION_REQUESTED', updated_at: now })
      });
      if (!orderUpdate.ok) throw new Error('Your request was recorded, but the order needs administrator attention.');
    }

    const orderRef = order?.order_number ? `ORD-${String(order.order_number).padStart(6, '0')}` : 'Initial membership order';
    const deadlineText = deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

    const customerText =
      `We have received your request to cancel your LymphAware ID membership during the initial cooling-off period.\n\n` +
      `Order: ${orderRef}\nRequest received: ${new Date(now).toLocaleString('en-GB')}\nCooling-off deadline: ${deadlineText}\n\n` +
      `We have stopped any future automatic renewal and paused the initial order from further fulfilment while the request is reviewed. Because LymphAware ID may include personalised physical items and services already supplied, the refund due can depend on what has already been prepared or provided. We will confirm the cancellation outcome and any refund separately.\n\n` +
      `If you need help, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team`;

    const adminText =
      `An initial cooling-off cancellation request has been submitted.\n\n` +
      `Member: ${user.email}\nOrder: ${orderRef}\nMembership: ${membership.id}\nOrder status before request: ${order?.order_status || 'Not recorded'}\nPaid total: £${(Number(order?.total_pence || 0) / 100).toFixed(2)}\nCooling-off deadline: ${deadlineText}\n\n` +
      `The order has been placed on CANCELLATION_REQUESTED and future automatic renewal has been stopped. Review any personalised items/services already supplied before confirming the refund and closing the membership.`;

    const [customerEmail, adminEmail] = await Promise.all([
      sendEmail({ to: user.email, subject: 'Your LymphAware ID cooling-off cancellation request', text: customerText }),
      sendEmail({ to: 'admin@lymphawareid.com', subject: `Cooling-off cancellation request – ${orderRef}`, text: adminText })
    ]);
    if (!customerEmail.ok) console.error('Unable to send customer cooling-off acknowledgement:', customerEmail.error);
    if (!adminEmail.ok) console.error('Unable to send admin cooling-off notification:', adminEmail.error);

    return json({ requested: true, deadline: deadline.toISOString() });
  } catch (error) {
    console.error('Initial cooling-off cancellation request error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unable to submit the cancellation request.' }, 500);
  }
};

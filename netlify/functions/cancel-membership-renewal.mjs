function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Authentication required.' }, 401);
    const token = authHeader.slice(7).trim();
    const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Unable to verify your LymphAware account.' }, 401);
    const user = await userResponse.json();
    const headers = { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
    const membershipResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(user.id)}&select=id,stripe_subscription_id,auto_renew_enabled,membership_end&limit=1`, { headers });
    const membership = (await membershipResponse.json())?.[0];
    if (!membershipResponse.ok || !membership?.stripe_subscription_id || !membership.auto_renew_enabled) return json({ error: 'Automatic renewal is not currently active.' }, 400);
    const form = new URLSearchParams({ cancel_at_period_end: 'true' });
    const stripeResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(membership.stripe_subscription_id)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2026-07-29.dahlia' }, body: form.toString()
    });
    const subscription = await stripeResponse.json();
    if (!stripeResponse.ok) return json({ error: 'Unable to cancel automatic renewal.' }, 500);
    const update = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ auto_renew_enabled: false, auto_renew_cancelled_at: new Date().toISOString(), stripe_subscription_status: subscription.status || 'active', updated_at: new Date().toISOString() })
    });
    if (!update.ok) return json({ error: 'Renewal was cancelled but the portal could not be refreshed. Please reload the page.' }, 500);
    await recordContractEvent({
      membershipId: membership.id,
      userId: user.id,
      eventType: 'AUTO_RENEW_CANCELLED',
      stripeReference: membership.stripe_subscription_id,
      details: { effective_at_period_end: true, membership_end: membership.membership_end }
    });
    const emailResult = await sendMembershipEmail({
      to: user.email,
      subject: 'Your LymphAware automatic renewal is cancelled',
      idempotencyKey: `renewal-cancelled-${membership.stripe_subscription_id}`,
      text: `Automatic renewal has been cancelled. No further automatic-renewal payment will be taken for this membership.\n\nYour current LymphAware membership remains active until ${dateUK(membership.membership_end)}.\n\nYou can review its status in your Patient Portal:\nhttps://lymphaware.com/portal/\n\nIf you did not make this change, contact admin@lymphaware.com.\n\nThe LymphAware Team`
    });
    if (!emailResult.ok) console.error('Unable to send renewal cancellation confirmation:', emailResult.error);
    return json({ cancelled: true, membershipEnd: membership.membership_end });
  } catch (error) {
    console.error('Unable to cancel membership renewal:', error);
    return json({ error: 'Unable to cancel automatic renewal.' }, 500);
  }
};
import { dateUK, recordContractEvent, sendMembershipEmail } from './_shared/membership-contract.mjs';

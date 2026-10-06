import { memberEmail, membershipExpiredNoticeText, sendMembershipEmail } from './_shared/membership-contract.mjs';

function serviceHeaders(prefer = '') {
  return {
    apikey: Netlify.env.get('SUPABASE_SECRET_KEY'),
    Authorization: `Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function expiredMemberships() {
  const now = new Date().toISOString();
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/memberships?membership_status=in.(ACTIVE,PILOT,SPONSORED)&membership_end=not.is.null&membership_end=lte.${encodeURIComponent(now)}&select=id,user_id,membership_status,membership_end`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load expired memberships: ${await response.text()}`);
  return response.json();
}

async function markLapsed(membership) {
  const now = new Date().toISOString();
  const response = await fetch(
    `${Netlify.env.get('SUPABASE_URL')}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({
        membership_status: 'LAPSED',
        updated_at: now
      })
    }
  );
  if (!response.ok) throw new Error(`Unable to lapse membership ${membership.id}: ${await response.text()}`);
}

export default async () => {
  const failures = [];
  let lapsed = 0;

  for (const membership of await expiredMemberships()) {
    try {
      await markLapsed(membership);
      lapsed += 1;
      try {
        const email = await memberEmail(membership.user_id);
        if (email) {
          const result = await sendMembershipEmail({
            to: email,
            subject: 'Your LymphAware ID membership has expired',
            text: membershipExpiredNoticeText(membership),
            idempotencyKey: `membership-expired-${membership.id}-${new Date(membership.membership_end).toISOString().slice(0, 10)}`
          });
          if (!result.ok) console.error('Unable to send membership expiry email:', result.error);
        }
      } catch (emailError) {
        console.error('Unable to send membership expiry email:', emailError);
      }
    } catch (error) {
      failures.push({
        membership: membership.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (failures.length) console.error('Expired membership reconciliation failures:', failures);
  console.log(`Expired membership reconciliation complete: ${lapsed} lapsed, ${failures.length} failures.`);
  return new Response(null, { status: 204 });
};

export const config = { schedule: '17 * * * *' };

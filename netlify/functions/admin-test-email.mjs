import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { recordAdminActivity } from './_shared/admin-audit.mjs';
import { getControlSettings } from './_shared/control-settings.mjs';
import {
  MEMBERSHIP_RENEWAL_URL,
  RENEWAL_HERO_URL,
  sendMembershipEmail
} from './_shared/membership-contract.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function exampleDate(daysFromNow) {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const admin = await verifyAdminRequest(request);
    if (!admin) return json({ error: 'Administrator access required.' }, 403);

    const { type } = await request.json().catch(() => ({}));
    const kind = String(type || '').trim();
    const controls = await getControlSettings({ strict: true });
    const to = controls.communications_admin_notification_email || admin.email;
    const key = `admin-test-${kind}-${Date.now()}`;

    let email;
    if (kind === 'renewal_manual') {
      email = {
        subject: '[TEST] Your membership is approaching expiry',
        htmlTitle: 'Your membership is approaching expiry',
        text: `This is a TEST of the manual-renewal email.\n\nA real member would see their actual expiry date, renewal price and projected new expiry date.\n\nRenew now:\n${MEMBERSHIP_RENEWAL_URL}`,
        preheader: 'Test of the LymphAware ID manual-renewal email.',
        actionUrl: MEMBERSHIP_RENEWAL_URL,
        actionLabel: 'Renew now',
        heroImageUrl: RENEWAL_HERO_URL,
        heroImageAlt: 'LymphAware ID renewal',
        heroLinkUrl: MEMBERSHIP_RENEWAL_URL,
        showHeaderLogo: false,
        detailRows: [
          { label: 'Membership expires on', value: exampleDate(50) },
          { label: 'Renewal period', value: '1 year' },
          { label: 'Renewal price', value: '£18.99' },
          { label: 'New expiry if renewed now', value: exampleDate(415) }
        ]
      };
    } else if (kind === 'renewal_auto') {
      email = {
        subject: '[TEST] Your membership renews automatically',
        htmlTitle: 'Your membership renews automatically',
        text: `This is a TEST of the automatic-renewal email.\n\nA real member would see their actual next renewal date, amount and projected new expiry date.\n\nReview membership:\n${MEMBERSHIP_RENEWAL_URL}`,
        preheader: 'Test of the LymphAware ID automatic-renewal email.',
        actionUrl: MEMBERSHIP_RENEWAL_URL,
        actionLabel: 'Review my membership',
        heroImageUrl: RENEWAL_HERO_URL,
        heroImageAlt: 'LymphAware ID renewal',
        heroLinkUrl: MEMBERSHIP_RENEWAL_URL,
        showHeaderLogo: false,
        detailRows: [
          { label: 'Next renewal date', value: exampleDate(50) },
          { label: 'Renewal period', value: '1 year' },
          { label: 'Renewal amount', value: '£18.99' },
          { label: 'Expected new expiry date', value: exampleDate(415) }
        ]
      };
    } else if (kind === 'profile_review') {
      email = {
        subject: '[TEST] Time to review your LymphAware ID profile',
        htmlTitle: 'Time to review your LymphAware ID profile',
        text: `This is a TEST of the six-monthly Profile Health Check reminder.\n\nA member would be asked to confirm that the information they have chosen to share is still current.\n\nReview my profile:\nhttps://lymphawareid.com/portal/#profile-review`,
        preheader: 'Test of the LymphAware ID Profile Health Check reminder.',
        actionUrl: 'https://lymphawareid.com/portal/#profile-review',
        actionLabel: 'Review my profile'
      };
    } else if (kind === 'expiry') {
      email = {
        subject: '[TEST] Your LymphAware ID membership has expired',
        htmlTitle: 'Your LymphAware ID membership has expired',
        text: `This is a TEST of the membership-expiry email.\n\nA real member would be told that their QR-linked profile is unavailable while membership is inactive and that they can renew from the Patient Portal.\n\nhttps://lymphawareid.com/portal/`,
        actionUrl: 'https://lymphawareid.com/portal/#membership-panel',
        actionLabel: 'Review my membership'
      };
    } else if (kind === 'order_admin') {
      email = {
        subject: '[TEST] New LymphAware ID order notification',
        htmlTitle: 'New LymphAware ID order notification',
        text: `This is a TEST of the administrator order notification.\n\nOrder: ORD-000123\nCustomer: Example Member\nTotal paid: £27.98\n\nItems:\n1 × LymphAware ID Standard membership\n1 × LymphAware ID card\n\nOpen Administration:\nhttps://lymphawareid.com/admin/`,
        actionUrl: 'https://lymphawareid.com/admin/',
        actionLabel: 'Open Administration'
      };
    } else {
      return json({ error: 'Unknown test email type.' }, 400);
    }

    const result = await sendMembershipEmail({ to, ...email, idempotencyKey: key });
    if (!result.ok) throw new Error(result.error || 'Test email could not be sent.');

    await recordAdminActivity({
      admin,
      actionType: 'TEST_EMAIL_SENT',
      entityType: 'COMMUNICATION',
      entityId: kind,
      summary: `Test email sent: ${kind}.`,
      details: { recipient: to }
    });

    return json({ sent: true, to, type: kind });
  } catch (error) {
    console.error('Admin test email error:', error);
    return json({ error: error instanceof Error ? error.message : 'Test email could not be sent.' }, 500);
  }
};

export const config = { path: '/api/admin-test-email' };

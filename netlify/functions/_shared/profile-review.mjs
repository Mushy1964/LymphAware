import { brandedEmailHtml } from './email-branding.mjs';

const SITE_URL = 'https://lymphawareid.com';
const REVIEW_MONTHS = 6;
const FOLLOWUP_DAYS = 14;
const RENEWAL_QUIET_DAYS = 30;

function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export function serviceHeaders(prefer = '') {
  const secret = env('SUPABASE_SECRET_KEY');
  const headers = {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

export async function getAuthenticatedUser(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const response = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      apikey: env('SUPABASE_PUBLISHABLE_KEY'),
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

export function addMonthsClamped(value, months = REVIEW_MONTHS) {
  const source = new Date(value);
  if (!Number.isFinite(source.getTime())) return null;
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const hours = source.getUTCHours();
  const minutes = source.getUTCMinutes();
  const seconds = source.getUTCSeconds();
  const milliseconds = source.getUTCMilliseconds();

  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(day, lastDay),
    hours,
    minutes,
    seconds,
    milliseconds
  ));
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

export function membershipIsCurrent(membership) {
  if (!membership) return false;
  const status = String(membership.membership_status || '').toUpperCase();
  const payment = String(membership.payment_status || '').toUpperCase();
  const entitled =
    (status === 'ACTIVE' && payment === 'PAID') ||
    status === 'PILOT' ||
    status === 'SPONSORED';

  if (!entitled) return false;
  if (!membership.membership_end) return true;

  const end = new Date(membership.membership_end).getTime();
  return Number.isFinite(end) && end > Date.now();
}

export function membershipInRenewalQuietZone(membership) {
  if (!membership?.membership_end) return false;
  const end = new Date(membership.membership_end).getTime();
  if (!Number.isFinite(end)) return false;
  const quietStart = Date.now();
  const quietEnd = quietStart + (RENEWAL_QUIET_DAYS * 86400000);
  return end > quietStart && end <= quietEnd;
}

export async function loadMembership(userId) {
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&select=id,membership_status,payment_status,membership_end,package_type&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load membership: ${await response.text()}`);
  return (await response.json())?.[0] || null;
}

export async function memberEmail(userId) {
  const response = await fetch(
    `${env('SUPABASE_URL')}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) return '';
  return String((await response.json())?.email || '').trim();
}

export function profileReviewEmailText(kind, dueAt) {
  const dueDate = formatDate(dueAt);
  const followup = kind === 'followup';

  return `${followup ? 'A friendly reminder to review your LymphAware ID profile.' : 'It is time for your six-monthly LymphAware ID profile review.'}\n\nPlease take a moment to check that the information you have chosen to share through your LymphAware ID profile is still accurate and up to date.\n\n${dueDate ? `Your profile review became due on ${dueDate}.\n\n` : ''}You can update anything that has changed, preview what other people will see, or simply confirm that everything is still current.\n\nReview my profile:\n${SITE_URL}/portal/#profile-review\n\nThis reminder does not affect your membership or switch off your QR profile if you do not complete it. It is simply there to help you keep your LymphAware ID information current.\n\nLymphAware ID does not clinically verify the information you enter.\n\nThe LymphAware ID Team`;
}

export async function sendProfileReviewEmail({ to, kind, dueAt, idempotencyKey }) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey || !to) return { ok: false, error: 'Profile review email is not configured.' };

  const subject = kind === 'followup'
    ? 'Reminder: please review your LymphAware ID profile'
    : 'Time to review your LymphAware ID profile';

  const text = profileReviewEmailText(kind, dueAt);
  const actionUrl = `${SITE_URL}/portal/#profile-review`;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  if (String(idempotencyKey || '').trim()) {
    headers['Idempotency-Key'] = String(idempotencyKey).trim();
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: env('ORDER_NOTIFICATION_FROM') || 'LymphAware ID <notifications@lymphawareid.com>',
      to: [to],
      reply_to: ['admin@lymphawareid.com'],
      subject,
      text,
      html: brandedEmailHtml({
        title: subject,
        text,
        actionUrl,
        actionLabel: 'Review my profile'
      })
    })
  });

  return response.ok ? { ok: true } : { ok: false, error: await response.text() };
}

export const PROFILE_REVIEW_INTERVAL_MONTHS = REVIEW_MONTHS;
export const PROFILE_REVIEW_FOLLOWUP_DAYS = FOLLOWUP_DAYS;
export const PROFILE_REVIEW_RENEWAL_QUIET_DAYS = RENEWAL_QUIET_DAYS;

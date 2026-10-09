import {
  memberEmail,
  loadMembership,
  membershipIsCurrent,
  membershipInRenewalQuietZone,
  PROFILE_REVIEW_FOLLOWUP_DAYS,
  sendProfileReviewEmail,
  serviceHeaders
} from './_shared/profile-review.mjs';
import { getControlSettings, communicationControls } from './_shared/system-controls.mjs';

function supabaseUrl() {
  return String(Netlify.env.get('SUPABASE_URL') || '').trim();
}

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

async function dueProfiles() {
  const now = new Date().toISOString();
  const response = await fetch(
    `${supabaseUrl()}/rest/v1/profiles?is_demo=eq.false&is_archived=eq.false&profile_next_review_due_at=lte.${encodeURIComponent(now)}&select=id,user_id,profile_next_review_due_at,profile_review_reminder_sent_at,profile_review_followup_sent_at&order=profile_next_review_due_at.asc&limit=500`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load due profile reviews: ${await response.text()}`);
  return response.json();
}

async function markReminder(profile, column) {
  const sentAt = new Date().toISOString();
  const response = await fetch(
    `${supabaseUrl()}/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({ [column]: sentAt })
    }
  );
  if (!response.ok) throw new Error(`Unable to mark profile review reminder: ${await response.text()}`);
}

export default async () => {
  const controls = communicationControls(await getControlSettings());
  if (!controls.profileReviewReminders) {
    console.log(JSON.stringify({ profile_review_reminders_disabled: true }));
    return new Response(null, { status: 204 });
  }
  const failures = [];
  let firstReminders = 0;
  let followups = 0;
  let skippedRenewalWindow = 0;

  for (const profile of await dueProfiles()) {
    try {
      const membership = await loadMembership(profile.user_id);
      if (!membershipIsCurrent(membership)) continue;

      if (membershipInRenewalQuietZone(membership)) {
        skippedRenewalWindow += 1;
        continue;
      }

      let kind = '';
      let column = '';
      if (!profile.profile_review_reminder_sent_at) {
        kind = 'first';
        column = 'profile_review_reminder_sent_at';
      } else if (!profile.profile_review_followup_sent_at) {
        const firstSent = new Date(profile.profile_review_reminder_sent_at);
        if (!Number.isFinite(firstSent.getTime())) continue;
        if (daysBetween(new Date(), firstSent) < PROFILE_REVIEW_FOLLOWUP_DAYS) continue;
        kind = 'followup';
        column = 'profile_review_followup_sent_at';
      } else {
        continue;
      }

      const email = await memberEmail(profile.user_id);
      if (!email) throw new Error('No member email address is available.');

      const dueDateKey = new Date(profile.profile_next_review_due_at).toISOString().slice(0, 10);
      const result = await sendProfileReviewEmail({
        to: email,
        kind,
        dueAt: profile.profile_next_review_due_at,
        idempotencyKey: `profile-review-${kind}-${profile.id}-${dueDateKey}`
      });
      if (!result.ok) throw new Error(result.error);

      await markReminder(profile, column);
      if (kind === 'first') firstReminders += 1;
      else followups += 1;
    } catch (error) {
      failures.push({
        profile_id: profile.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (failures.length) console.error('Profile review reminder failures:', failures);
  console.log(JSON.stringify({
    first_reminders: firstReminders,
    followups,
    skipped_renewal_window: skippedRenewalWindow,
    failures: failures.length
  }));
};

export const config = { schedule: '30 9 * * *' };

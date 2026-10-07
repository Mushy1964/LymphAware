import {
  addMonthsClamped,
  getAuthenticatedUser,
  json,
  loadMembership,
  membershipIsCurrent,
  serviceHeaders
} from './_shared/profile-review.mjs';

function supabaseUrl() {
  return String(Netlify.env.get('SUPABASE_URL') || '').trim();
}

async function loadProfile(userId) {
  const response = await fetch(
    `${supabaseUrl()}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,is_demo,is_archived,profile_last_reviewed_at,profile_next_review_due_at,profile_review_reminder_sent_at,profile_review_followup_sent_at&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to load profile review status: ${await response.text()}`);
  return (await response.json())?.[0] || null;
}

function reviewState(profile) {
  if (!profile) return null;
  const dueAt = profile.profile_next_review_due_at ? new Date(profile.profile_next_review_due_at) : null;
  const due = Boolean(dueAt && Number.isFinite(dueAt.getTime()) && dueAt.getTime() <= Date.now());
  return {
    last_reviewed_at: profile.profile_last_reviewed_at || null,
    next_review_due_at: profile.profile_next_review_due_at || null,
    reminder_sent_at: profile.profile_review_reminder_sent_at || null,
    followup_sent_at: profile.profile_review_followup_sent_at || null,
    review_due: due
  };
}

export default async (request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return json({ error: 'Authentication required.' }, 401);

    const membership = await loadMembership(user.id);
    if (!membershipIsCurrent(membership)) {
      return json({ error: 'An active LymphAware ID membership is required.' }, 403);
    }

    const profile = await loadProfile(user.id);
    if (!profile || profile.is_archived === true || profile.is_demo === true) {
      return json({ error: 'Your profile review status is not available.' }, 404);
    }

    if (request.method === 'GET') {
      return json({
        ...reviewState(profile),
        interval_months: 6,
        followup_days: 14
      });
    }

    const reviewedAt = new Date();
    const nextDue = addMonthsClamped(reviewedAt, 6);
    if (!nextDue) return json({ error: 'The next review date could not be calculated.' }, 500);

    const updateResponse = await fetch(
      `${supabaseUrl()}/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}&user_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'PATCH',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({
          profile_last_reviewed_at: reviewedAt.toISOString(),
          profile_next_review_due_at: nextDue.toISOString(),
          profile_review_reminder_sent_at: null,
          profile_review_followup_sent_at: null
        })
      }
    );
    if (!updateResponse.ok) {
      throw new Error(`Unable to confirm profile review: ${await updateResponse.text()}`);
    }

    const eventResponse = await fetch(
      `${supabaseUrl()}/rest/v1/profile_review_events`,
      {
        method: 'POST',
        headers: serviceHeaders('return=minimal'),
        body: JSON.stringify({
          profile_id: profile.id,
          user_id: user.id,
          reviewed_at: reviewedAt.toISOString(),
          source: 'PORTAL_CONFIRMATION'
        })
      }
    );
    if (!eventResponse.ok) {
      console.error('Unable to record profile review history:', await eventResponse.text());
    }

    return json({
      confirmed: true,
      last_reviewed_at: reviewedAt.toISOString(),
      next_review_due_at: nextDue.toISOString(),
      review_due: false
    });
  } catch (error) {
    console.error('Member profile review error:', error);
    return json({ error: 'Your profile review status could not be updated.' }, 500);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function finishAfter(startedAt, minimumDuration = 350) {
  const remaining = minimumDuration - (Date.now() - startedAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
}

export default async request => {
  const startedAt = Date.now();
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      await finishAfter(startedAt);
      return json({ error: 'Please enter a valid email address.' }, 400);
    }

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/registration_email_exists`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ p_email: email })
    });
    if (!response.ok) throw new Error('The account check could not be completed.');

    const accountExists = Boolean(await response.json());
    await finishAfter(startedAt);
    if (accountExists) {
      return json({
        error: 'An account may already exist for this email address. Please sign in to continue, or use Forgotten password.'
      }, 409);
    }
    return json({ available: true });
  } catch (error) {
    console.error('Registration email check failed:', error instanceof Error ? error.message : error);
    await finishAfter(startedAt);
    return json({ error: 'We could not check this email address. Please try again.' }, 500);
  }
};

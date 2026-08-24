export default async (request) => {

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Method not allowed'
      }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }

  try {

    const authHeader =
      request.headers.get('authorization');

    if (
      !authHeader ||
      !authHeader.startsWith('Bearer ')
    ) {
      return new Response(
        JSON.stringify({
          error: 'Authentication required.'
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const accessToken =
      authHeader.replace('Bearer ', '').trim();


    const userResponse = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            process.env.SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );


    if (!userResponse.ok) {
      return new Response(
        JSON.stringify({
          error: 'Unable to verify your account.'
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const user =
      await userResponse.json();


    const adminEmail =
      String(
        process.env.LYMPHAWARE_ADMIN_EMAIL || ''
      )
        .trim()
        .toLowerCase();


    if (
      !user?.email ||
      user.email.toLowerCase() !== adminEmail
    ) {
      return new Response(
        JSON.stringify({
          error: 'Administrator access required.'
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const body =
      await request.json();

    const profileId =
      body?.profile_id;


    if (!profileId) {
      return new Response(
        JSON.stringify({
          error: 'Profile ID required.'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const updateResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(profileId)}`,
      {
        method: 'PATCH',

        headers: {
          apikey:
            process.env.SUPABASE_SECRET_KEY,

          Authorization:
            `Bearer ${process.env.SUPABASE_SECRET_KEY}`,

          'Content-Type':
            'application/json',

          Prefer:
            'return=minimal'
        },

        body: JSON.stringify({
          card_production_status:
            'PRINTED',

          card_printed_at:
            new Date().toISOString()
        })
      }
    );


    if (!updateResponse.ok) {

      console.error(
        'Unable to mark card as printed:',
        await updateResponse.text()
      );

      return new Response(
        JSON.stringify({
          error:
            'The card could not be marked as printed.'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    return new Response(
      JSON.stringify({
        success: true
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      }
    );


  } catch (error) {

    console.error(
      'Mark card printed error:',
      error
    );

    return new Response(
      JSON.stringify({
        error:
          'The card could not be marked as printed.'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
};

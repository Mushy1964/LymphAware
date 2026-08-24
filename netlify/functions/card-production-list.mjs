export default async (request) => {

  if (request.method !== 'GET') {
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


    /*
     * Show only cards that still need production action.
     * PRINTED cards are deliberately excluded.
     */
    const profileResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?select=id,lymphaware_id,display_name,photo_path,qr_token,qr_profile_active,card_production_status,card_ready_at,card_prepared_at` +
      `&card_production_status=in.(READY,PREPARED)` +
      `&order=card_ready_at.asc`,
      {
        headers: {
          apikey:
            process.env.SUPABASE_SECRET_KEY,

          Authorization:
            `Bearer ${process.env.SUPABASE_SECRET_KEY}`,

          Accept:
            'application/json'
        }
      }
    );


    if (!profileResponse.ok) {

      console.error(
        'Unable to retrieve card-production records:',
        await profileResponse.text()
      );

      return new Response(
        JSON.stringify({
          error:
            'Card-production records could not be loaded.'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const profiles =
      await profileResponse.json();


    return new Response(
      JSON.stringify({
        profiles: profiles || []
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
      'Card production list error:',
      error
    );

    return new Response(
      JSON.stringify({
        error:
          'Unable to load card-production records.'
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

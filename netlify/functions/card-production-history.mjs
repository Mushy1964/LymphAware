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


    /*
     * Confirm the signed-in user.
     */
    const userResponse =
      await fetch(
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
     * Retrieve the 20 most recently printed cards.
     */
    const historyResponse =
      await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles` +
        `?select=id,lymphaware_id,display_name,card_printed_at` +
        `&card_production_status=eq.PRINTED` +
        `&order=card_printed_at.desc` +
        `&limit=20`,
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


    if (!historyResponse.ok) {

      console.error(
        'Unable to retrieve card history:',
        await historyResponse.text()
      );

      return new Response(
        JSON.stringify({
          error:
            'Printed-card history could not be loaded.'
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
      await historyResponse.json();


    return new Response(
      JSON.stringify({
        profiles
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
      'Card history error:',
      error
    );

    return new Response(
      JSON.stringify({
        error:
          'Printed-card history could not be loaded.'
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

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


    /*
     * Verify the signed-in administrator.
     */
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
          error:
            'Unable to verify your LymphAware account.'
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
          error:
            'Administrator access required.'
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
     * Identify the patient whose card is being produced.
     */
    const body =
      await request.json();

    const profileId =
      body?.profile_id;


    if (!profileId) {
      return new Response(
        JSON.stringify({
          error:
            'Profile ID required.'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    /*
     * Retrieve ONLY the fields required
     * for producing this patient's card.
     */
    const profileResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(profileId)}` +
      `&select=id,lymphaware_id,display_name,qr_token,photo_path` +
      `&limit=1`,
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
        'Unable to retrieve EasyBadge record:',
        await profileResponse.text()
      );

      return new Response(
        JSON.stringify({
          error:
            'Unable to retrieve the card record.'
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

    const profile =
      profiles?.[0];


    /*
     * Name, photograph, LymphAware ID and QR token
     * are required for card production.
     */
    if (
      !profile ||
      !profile.lymphaware_id ||
      !profile.display_name ||
      !profile.qr_token ||
      !profile.photo_path
    ) {
      return new Response(
        JSON.stringify({
          error:
            'The profile does not contain all information required for card production.'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const qrProfileUrl =
      `https://lymphaware.com/p/${profile.qr_token}`;

    const imageUrl =
      `https://lymphaware.com/ebp/${profile.qr_token}`;
    
    /*
     * Protect CSV values containing commas or quotation marks.
     */
    function csvValue(value) {

      const text =
        String(value ?? '');

      return `"${text.replace(/"/g, '""')}"`;
    }


    /*
     * One EasyBadge export = one patient's card.
     */
    const csv =
      [
        [
          'LymphAware ID',
          'Display Name',
          'QR Profile URL',
          'ImageURL'
        ].join(','),

        [
          csvValue(profile.lymphaware_id),
          csvValue(profile.display_name),
          csvValue(qrProfileUrl),
          csvValue(imageUrl)
        ].join(',')
      ].join('\r\n');

    /*
     * Record that this card has been prepared
     * for EasyBadge production.
     */
    const preparedResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(profile.id)}`,
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
            'PREPARED',
    
          card_prepared_at:
            new Date().toISOString()
        })
      }
    );
    
    
    if (!preparedResponse.ok) {
    
      console.error(
        'Unable to mark card as prepared:',
        await preparedResponse.text()
      );
    
      return new Response(
        JSON.stringify({
          error:
            'The EasyBadge file was created, but the card-production status could not be updated.'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }
        

    

    /*
     * Keep the EasyBadge-linked filename fixed.
     */
    return new Response(
      csv,
      {
        status: 200,

        headers: {
          'Content-Type':
            'text/csv; charset=utf-8',

          'Content-Disposition':
            'attachment; filename="LymphAware_EasyBadge_Test.csv"',

          'Cache-Control':
            'no-store'
        }
      }
    );


  } catch (error) {

    console.error(
      'Unable to create EasyBadge export:',
      error
    );

    return new Response(
      JSON.stringify({
        error:
          'Unable to create the EasyBadge export.'
      }),
      {
        status: 500,

        headers: {
          'Content-Type':
            'application/json'
        }
      }
    );
  }
};

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
     * Verify signed-in administrator.
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
     * Retrieve every card currently READY.
     */
    const profileResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?select=id,lymphaware_id,display_name,qr_token,photo_path` +
      `&card_production_status=eq.READY` +
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
        'Unable to retrieve batch EasyBadge records:',
        await profileResponse.text()
      );

      return new Response(
        JSON.stringify({
          error:
            'Unable to retrieve cards awaiting production.'
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


    if (!profiles?.length) {
      return new Response(
        JSON.stringify({
          error:
            'There are currently no cards ready for EasyBadge.'
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
     * Make sure every selected card has
     * the minimum information required.
     */
    const incompleteProfile =
      profiles.find(
        profile =>
          !profile.lymphaware_id ||
          !profile.display_name ||
          !profile.qr_token ||
          !profile.photo_path
      );


    if (incompleteProfile) {
      return new Response(
        JSON.stringify({
          error:
            'One or more cards do not contain all information required for production.'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    function csvValue(value) {

      const text =
        String(value ?? '');

      return `"${text.replace(/"/g, '""')}"`;
    }


    /*
     * Header row.
     */
    const rows = [
      [
        'LymphAware ID',
        'Display Name',
        'QR Profile URL',
        'ImageURL'
      ].join(',')
    ];


    /*
     * One CSV row for every READY card.
     */
    profiles.forEach((profile) => {

      const qrProfileUrl =
        `https://lymphaware.com/p/${profile.qr_token}`;

      const imageUrl =
        `https://lymphaware.com/ebp/${profile.qr_token}`;


      rows.push(
        [
          csvValue(profile.lymphaware_id),
          csvValue(profile.display_name),
          csvValue(qrProfileUrl),
          csvValue(imageUrl)
        ].join(',')
      );
    });


    const csv =
      rows.join('\r\n');


    /*
     * Mark every exported record PREPARED.
     */
    const preparedAt =
      new Date().toISOString();


    for (const profile of profiles) {

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
              preparedAt
          })
        }
      );


      if (!preparedResponse.ok) {

        console.error(
          `Unable to mark ${profile.lymphaware_id} as prepared:`,
          await preparedResponse.text()
        );

        return new Response(
          JSON.stringify({
            error:
              'The EasyBadge batch was created, but one or more card statuses could not be updated.'
          }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }
    }


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
            'no-store',

          'X-LymphAware-Card-Count':
            String(profiles.length)
        }
      }
    );


  } catch (error) {

    console.error(
      'Batch EasyBadge export error:',
      error
    );

    return new Response(
      JSON.stringify({
        error:
          'Unable to create the EasyBadge batch.'
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

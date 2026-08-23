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


    // Verify the signed-in LymphAware user.
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
          error: 'Unable to verify your LymphAware account.'
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


    if (!user?.id) {
      return new Response(
        JSON.stringify({
          error: 'Unable to verify your LymphAware account.'
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    // Retrieve only the fields required for EasyBadge.
    const profileResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${user.id}&select=lymphaware_id,display_name,qr_token`,
      {
        headers: {
          apikey:
            process.env.SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${accessToken}`,

          Accept:
            'application/json'
        }
      }
    );


    if (!profileResponse.ok) {
      return new Response(
        JSON.stringify({
          error: 'Unable to retrieve the card record.'
        }),
        {
          status: 403,
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


    if (
      !profile ||
      !profile.lymphaware_id ||
      !profile.display_name ||
      !profile.qr_token
    ) {
      return new Response(
        JSON.stringify({
          error: 'The profile does not contain all information required for card production.'
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


    // Protect CSV values that may contain commas or quote marks.
    function csvValue(value) {

      const text =
        String(value ?? '');

      return `"${text.replace(/"/g, '""')}"`;
    }


    const csv =
      [
        [
          'LymphAware ID',
          'Display Name',
          'QR Profile URL'
        ].join(','),

        [
          csvValue(profile.lymphaware_id),
          csvValue(profile.display_name),
          csvValue(qrProfileUrl)
        ].join(',')
      ].join('\r\n');


    const safeFileId =
      profile.lymphaware_id
        .replace(/[^A-Za-z0-9_-]/g, '_');


    return new Response(
      csv,
      {
        status: 200,
        headers: {
          'Content-Type':
            'text/csv; charset=utf-8',

          'Content-Disposition':
            `attachment; filename="LymphAware_EasyBadge_${safeFileId}.csv"`,

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
        error: 'Unable to create the EasyBadge export.'
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

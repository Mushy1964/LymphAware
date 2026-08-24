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


    if (!user?.id) {
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


    // Retrieve only the fields required for EasyBadge.
    const profileResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?user_id=eq.${encodeURIComponent(user.id)}` +
      `&select=lymphaware_id,display_name,qr_token,photo_path`,
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
          error:
            'Unable to retrieve the card record.'
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


    /*
     * Create a temporary secure URL for the patient's
     * private Supabase photograph.
     *
     * The link lasts 8 hours, which is sufficient for
     * the EasyBadge card-production session.
     */
    const encodedPhotoPath =
      profile.photo_path
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');


    const photoResponse = await fetch(
      `${process.env.SUPABASE_URL}` +
      `/storage/v1/object/sign/patient-photos/${encodedPhotoPath}`,
      {
        method: 'POST',

        headers: {
          apikey:
            process.env.SUPABASE_PUBLISHABLE_KEY,

          Authorization:
            `Bearer ${accessToken}`,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          expiresIn: 28800
        })
      }
    );


    if (!photoResponse.ok) {
      console.error(
        'Unable to create EasyBadge photograph URL:',
        await photoResponse.text()
      );

      return new Response(
        JSON.stringify({
          error:
            'The patient photograph could not be prepared for EasyBadge.'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const photoData =
      await photoResponse.json();


    const signedPath =
      photoData?.signedURL ||
      photoData?.signedUrl;


    if (!signedPath) {
      return new Response(
        JSON.stringify({
          error:
            'The patient photograph URL could not be created.'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }


    const imageUrl =
      signedPath.startsWith('http')
        ? signedPath
        : `${process.env.SUPABASE_URL}/storage/v1${signedPath}`;


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
          'Content-Type': 'application/json'
        }
      }
    );
  }
};

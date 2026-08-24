export default async (request) => {

  if (request.method !== 'GET') {
    return new Response(
      'Method not allowed',
      {
        status: 405
      }
    );
  }

  try {

    const url =
      new URL(request.url);

    const token =
      url.searchParams.get('token');


    if (!token) {
      return new Response(
        'Photo token required.',
        {
          status: 400
        }
      );
    }


    /*
     * Find the patient profile from its QR token.
     *
     * This runs server-side using the existing
     * Supabase secret key.
     */
    const profileResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?qr_token=eq.${encodeURIComponent(token)}` +
      `&select=photo_path` +
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
        'Unable to locate EasyBadge photograph:',
        await profileResponse.text()
      );

      return new Response(
        'Photograph unavailable.',
        {
          status: 404
        }
      );
    }


    const profiles =
      await profileResponse.json();

    const profile =
      profiles?.[0];


    if (!profile?.photo_path) {
      return new Response(
        'Photograph unavailable.',
        {
          status: 404
        }
      );
    }


    /*
     * Preserve the folder separator in the
     * Supabase Storage object path.
     */
    const encodedPhotoPath =
      profile.photo_path
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');


    /*
     * Retrieve the private photograph directly
     * from Supabase Storage.
     */
    const photoResponse = await fetch(
      `${process.env.SUPABASE_URL}` +
      `/storage/v1/object/authenticated/patient-photos/${encodedPhotoPath}`,
      {
        headers: {
          apikey:
            process.env.SUPABASE_SECRET_KEY,

          Authorization:
            `Bearer ${process.env.SUPABASE_SECRET_KEY}`
        }
      }
    );


    if (!photoResponse.ok) {

      console.error(
        'Unable to retrieve EasyBadge photograph:',
        photoResponse.status,
        await photoResponse.text()
      );

      return new Response(
        'Photograph unavailable.',
        {
          status: 404
        }
      );
    }


    const photo =
      await photoResponse.arrayBuffer();


    const contentType =
      photoResponse.headers.get(
        'content-type'
      ) || 'image/jpeg';


    return new Response(
      photo,
      {
        status: 200,

        headers: {
          'Content-Type':
            contentType,

          /*
           * Do not retain the image indefinitely
           * in intermediary caches.
           */
          'Cache-Control':
            'private, max-age=300'
        }
      }
    );


  } catch (error) {

    console.error(
      'EasyBadge photograph error:',
      error
    );

    return new Response(
      'Photograph unavailable.',
      {
        status: 500
      }
    );
  }
};

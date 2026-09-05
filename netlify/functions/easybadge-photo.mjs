export default async (request) => {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const url = new URL(request.url);
    let token = url.searchParams.get('token');

    if (!token) {
      const pathParts = url.pathname.split('/').filter(Boolean);
      const ebpIndex = pathParts.indexOf('ebp');
      if (ebpIndex !== -1 && pathParts[ebpIndex + 1]) {
        token = pathParts[ebpIndex + 1];
      }
    }

    if (!token) {
      return new Response('Photo token required.', { status: 400 });
    }

    const serviceHeaders = {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      Accept: 'application/json'
    };

    let photoPath = null;

    const primaryResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles` +
      `?qr_token=eq.${encodeURIComponent(token)}` +
      `&select=photo_path` +
      `&limit=1`,
      { headers: serviceHeaders }
    );

    if (primaryResponse.ok) {
      const rows = await primaryResponse.json();
      photoPath = rows?.[0]?.photo_path || null;
    } else {
      console.error('Unable to locate primary EasyBadge photograph:', await primaryResponse.text());
    }

    if (!photoPath) {
      const languageResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles` +
        `?qr_token=eq.${encodeURIComponent(token)}` +
        `&select=source_profile_id` +
        `&limit=1`,
        { headers: serviceHeaders }
      );

      if (languageResponse.ok) {
        const languageRows = await languageResponse.json();
        const sourceProfileId = languageRows?.[0]?.source_profile_id;

        if (sourceProfileId) {
          const sourceResponse = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/profiles` +
            `?id=eq.${encodeURIComponent(sourceProfileId)}` +
            `&select=photo_path` +
            `&limit=1`,
            { headers: serviceHeaders }
          );

          if (sourceResponse.ok) {
            const sourceRows = await sourceResponse.json();
            photoPath = sourceRows?.[0]?.photo_path || null;
          } else {
            console.error('Unable to locate language-card source photograph:', await sourceResponse.text());
          }
        }
      } else {
        console.error('Unable to locate language EasyBadge photograph:', await languageResponse.text());
      }
    }

    if (!photoPath) {
      return new Response('Photograph unavailable.', { status: 404 });
    }

    const encodedPhotoPath = photoPath
      .split('/')
      .map(part => encodeURIComponent(part))
      .join('/');

    const photoResponse = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/authenticated/patient-photos/${encodedPhotoPath}`,
      {
        headers: {
          apikey: process.env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`
        }
      }
    );

    if (!photoResponse.ok) {
      console.error('Unable to retrieve EasyBadge photograph:', photoResponse.status, await photoResponse.text());
      return new Response('Photograph unavailable.', { status: 404 });
    }

    const photo = await photoResponse.arrayBuffer();
    const contentType = photoResponse.headers.get('content-type') || 'image/jpeg';

    return new Response(photo, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300'
      }
    });
  } catch (error) {
    console.error('EasyBadge photograph error:', error);
    return new Response('Photograph unavailable.', { status: 500 });
  }
};

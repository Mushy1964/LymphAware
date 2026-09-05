function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function serviceHeaders(prefer = '') {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function requireAdmin(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: json({ error: 'Authentication required.' }, 401) };
  }

  const accessToken = authHeader.replace('Bearer ', '').trim();
  const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!userResponse.ok) return { error: json({ error: 'Unable to verify your account.' }, 401) };

  const user = await userResponse.json();
  const adminEmail = String(process.env.LYMPHAWARE_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!user?.email || user.email.toLowerCase() !== adminEmail) {
    return { error: json({ error: 'Administrator access required.' }, 403) };
  }

  return { user };
}

function cleanText(value, max = 4000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function normaliseTranslatedContent(input = {}) {
  return {
    lymphoedema_type: cleanText(input.lymphoedema_type, 1000),
    lymphoedema_location: cleanText(input.lymphoedema_location, 1000),
    compression_information: cleanText(input.compression_information, 4000),
    treatment_considerations: cleanText(input.treatment_considerations, 4000),
    assistance_needs: cleanText(input.assistance_needs, 4000),
    emergency_contact_relationship: cleanText(input.emergency_contact_relationship, 500),
    additional_statement: cleanText(input.additional_statement, 4000)
  };
}

function hasReviewableContent(t = {}) {
  return Boolean(
    cleanText(t.lymphoedema_type) ||
    cleanText(t.lymphoedema_location) ||
    cleanText(t.compression_information) ||
    cleanText(t.treatment_considerations) ||
    cleanText(t.assistance_needs) ||
    cleanText(t.emergency_contact_relationship) ||
    cleanText(t.additional_statement)
  );
}

async function getLanguageProfile(id) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/language_profiles?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

async function getSourceProfile(id) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,display_name,lymphaware_id,photo_path,lymphoedema_type,lymphoedema_location,compression_information,treatment_considerations,assistance_needs,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,additional_statement&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

async function getSelectedAssistance(profileId) {
  const selectedResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profile_assistance?profile_id=eq.${encodeURIComponent(profileId)}&select=option_id&order=option_id.asc`,
    { headers: serviceHeaders() }
  );
  if (!selectedResponse.ok) return [];
  const selected = await selectedResponse.json();
  const ids = (selected || []).map((row) => row.option_id).filter(Boolean);
  if (!ids.length) return [];

  const filter = encodeURIComponent(`(${ids.join(',')})`);
  const optionResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/assistance_options?id=in.${filter}&select=id,slug,statement,icon_key,sort_order&order=sort_order.asc`,
    { headers: serviceHeaders() }
  );
  if (!optionResponse.ok) return [];
  return await optionResponse.json();
}

export default async (request) => {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  try {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const id = String(url.searchParams.get('id') || '').trim();
      if (!id) return json({ error: 'Language profile ID is required.' }, 400);

      const languageProfile = await getLanguageProfile(id);
      if (!languageProfile) return json({ error: 'Language profile not found.' }, 404);

      const sourceProfile = await getSourceProfile(languageProfile.source_profile_id);
      if (!sourceProfile) return json({ error: 'Source profile not found.' }, 404);

      const assistance = await getSelectedAssistance(sourceProfile.id);
      return json({ language_profile: languageProfile, source_profile: sourceProfile, assistance });
    }

    if (request.method === 'POST') {
      const payload = await request.json();
      const id = cleanText(payload?.id, 100);
      const action = cleanText(payload?.action, 40) || 'save';
      if (!id) return json({ error: 'Language profile ID is required.' }, 400);

      const languageProfile = await getLanguageProfile(id);
      if (!languageProfile) return json({ error: 'Language profile not found.' }, 404);
      if (languageProfile.language_code !== 'FR') {
        return json({ error: 'A preparation pack has not yet been approved for this language.' }, 400);
      }

      if (action === 'approve') {
        if (languageProfile.setup_status !== 'IN_REVIEW') {
          return json({ error: 'The French profile must be saved for review before it can be approved.' }, 400);
        }
        if (!hasReviewableContent(languageProfile.translated_content || {})) {
          return json({ error: 'There is no reviewed French content to approve.' }, 400);
        }

        const sourceProfile = await getSourceProfile(languageProfile.source_profile_id);
        if (!sourceProfile?.display_name || !sourceProfile?.lymphaware_id || !sourceProfile?.photo_path) {
          return json({ error: 'The source patient profile must include a display name, LymphAware ID and photograph before a translated profile can be activated.' }, 400);
        }

        const now = new Date().toISOString();
        const approvalUpdate = {
          setup_status: 'APPROVED',
          qr_profile_active: true,
          updated_at: now
        };

        if (!languageProfile.card_production_status) {
          approvalUpdate.card_production_status = 'READY';
          approvalUpdate.card_ready_at = now;
        }

        const updateResponse = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/language_profiles?id=eq.${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            headers: serviceHeaders('return=representation'),
            body: JSON.stringify(approvalUpdate)
          }
        );

        if (!updateResponse.ok) {
          console.error('Unable to approve language profile:', await updateResponse.text());
          return json({ error: 'The French profile could not be approved.' }, 500);
        }

        const rows = await updateResponse.json();
        return json({ ok: true, approved: true, language_profile: rows?.[0] || null });
      }

      const translatedContent = normaliseTranslatedContent(payload?.translated_content || {});
      const now = new Date().toISOString();
      const draftUpdate = {
        translated_content: translatedContent,
        setup_status: 'IN_REVIEW',
        qr_profile_active: false,
        updated_at: now
      };

      if (languageProfile.card_production_status === 'READY') {
        draftUpdate.card_production_status = null;
        draftUpdate.card_ready_at = null;
      }

      const updateResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/language_profiles?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: serviceHeaders('return=representation'),
          body: JSON.stringify(draftUpdate)
        }
      );

      if (!updateResponse.ok) {
        console.error('Unable to save language profile draft:', await updateResponse.text());
        return json({ error: 'The French draft could not be saved.' }, 500);
      }

      const rows = await updateResponse.json();
      return json({ ok: true, language_profile: rows?.[0] || null });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Language profile preparation error:', error);
    return json({ error: 'Unable to process the language profile.' }, 500);
  }
};

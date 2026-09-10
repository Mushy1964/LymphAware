import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors'

const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, secretKeys['default'])
const DEMO_PROFILE_TOKEN = '1babe83a-9ad9-4999-a7c4-658b1400b044'

const FR_ASSISTANCE: Record<string,string> = {
  standing: 'Je peux avoir des difficultés à rester debout pendant de longues périodes.',
  seating: 'Je peux avoir besoin d’un endroit où m’asseoir.',
  time: 'Je peux avoir besoin de plus de temps.',
  mobility: 'Je peux avoir besoin d’aide pour me déplacer.',
  'extra-space': 'Je peux avoir besoin de plus d’espace en raison d’un gonflement ou de vêtements de compression.',
  understanding: 'Merci de faire preuve de patience et de compréhension.'
}

async function signedPhoto(path?: string | null) {
  if (!path) return null
  const { data } = await supabaseAdmin.storage.from('patient-photos').createSignedUrl(path, 300)
  return data?.signedUrl ?? null
}

async function hasActiveHealthConsent(profileId: string, isDemo = false) {
  if (isDemo) return true
  const { data, error } = await supabaseAdmin.rpc('has_active_profile_health_consent', { p_profile_id: profileId })
  if (error) {
    console.error('Health consent check failed:', error)
    return false
  }
  return data === true
}

async function hasEmergencyNotice(profileId: string, isDemo = false) {
  if (isDemo) return true
  const { data, error } = await supabaseAdmin.rpc('has_current_emergency_contact_notice', { p_profile_id: profileId })
  if (error) {
    console.error('Emergency contact notice check failed:', error)
    return false
  }
  return data === true
}

async function selectedResources(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('profile_information_resources')
    .select('information_resources(id,slug,organisation,title,description,url,category,language_code,sort_order,active)')
    .eq('profile_id', profileId)

  if (error) {
    console.error('Information resource lookup failed:', error)
    return []
  }

  return (data ?? [])
    .map((item: any) => item.information_resources)
    .filter((resource: any) => resource?.active === true)
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map(({ active: _active, sort_order: _sortOrder, ...resource }: any) => resource)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (!token) return Response.json({ error: 'Profile token required' }, { status: 400, headers: corsHeaders })

    const { data: languageProfile, error: languageError } = await supabaseAdmin
      .from('language_profiles')
      .select('id,source_profile_id,language_code,language_name,translated_content,setup_status,qr_profile_active')
      .eq('qr_token', token)
      .eq('setup_status', 'APPROVED')
      .eq('qr_profile_active', true)
      .maybeSingle()

    if (languageError) console.error(languageError)

    if (languageProfile) {
      const { data: source, error: sourceError } = await supabaseAdmin
        .from('profiles')
        .select('id,display_name,lymphaware_id,photo_path,emergency_contact_name,emergency_contact_phone,qr_profile_active,is_demo')
        .eq('id', languageProfile.source_profile_id)
        .maybeSingle()
      if (sourceError || !source || source.qr_profile_active !== true) {
        return Response.json({ error: 'Profile not available' }, { status: 404, headers: corsHeaders })
      }

      const isDemo = source.is_demo === true || token === DEMO_PROFILE_TOKEN
      const consentOk = await hasActiveHealthConsent(source.id, isDemo)
      if (!consentOk) return Response.json({ error: 'Profile not available' }, { status: 404, headers: corsHeaders })

      const emergencyOk = await hasEmergencyNotice(source.id, isDemo)
      const t = languageProfile.translated_content ?? {}
      const publicProfile: Record<string, unknown> = {
        language_code: languageProfile.language_code,
        language_name: languageProfile.language_name,
        display_name: source.display_name,
        lymphaware_id: source.lymphaware_id,
        lymphoedema_type: t.lymphoedema_type ?? '',
        lymphoedema_location: t.lymphoedema_location ?? '',
        compression_information: t.compression_information ?? '',
        treatment_considerations: t.treatment_considerations ?? '',
        assistance_needs: t.assistance_needs ?? '',
        emergency_contact: emergencyOk ? {
          name: source.emergency_contact_name,
          relationship: t.emergency_contact_relationship ?? '',
          phone: source.emergency_contact_phone
        } : { name: null, relationship: '', phone: null },
        additional_statement: t.additional_statement ?? ''
      }

      const photo = await signedPhoto(source.photo_path)
      if (photo) publicProfile.photo_url = photo

      const { data: assistance } = await supabaseAdmin
        .from('profile_assistance')
        .select('assistance_options(statement,icon_key)')
        .eq('profile_id', source.id)

      publicProfile.assistance = (assistance ?? []).map((item:any) => {
        const option = item.assistance_options
        if (!option) return null
        return {
          statement: languageProfile.language_code === 'FR' ? (FR_ASSISTANCE[option.icon_key] ?? option.statement) : option.statement,
          icon_key: option.icon_key
        }
      }).filter(Boolean)
      publicProfile.resources = await selectedResources(source.id)

      return Response.json(publicProfile, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id,display_name,lymphaware_id,photo_path,lymphoedema_type,lymphoedema_location,compression_information,treatment_considerations,assistance_needs,emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,additional_statement,is_demo')
      .eq(token.includes('-') ? 'qr_token' : 'public_code', token)
      .eq('qr_profile_active', true)
      .maybeSingle()

    if (profileError) return Response.json({ error: 'Unable to load profile' }, { status: 500, headers: corsHeaders })
    if (!profile) return Response.json({ error: 'Profile not available' }, { status: 404, headers: corsHeaders })

    const isDemo = profile.is_demo === true || token === DEMO_PROFILE_TOKEN
    const consentOk = await hasActiveHealthConsent(profile.id, isDemo)
    if (!consentOk) return Response.json({ error: 'Profile not available' }, { status: 404, headers: corsHeaders })

    const emergencyOk = await hasEmergencyNotice(profile.id, isDemo)
    const publicProfile: Record<string, unknown> = {
      language_code: 'EN',
      display_name: profile.display_name,
      lymphaware_id: profile.lymphaware_id,
      lymphoedema_type: profile.lymphoedema_type,
      lymphoedema_location: profile.lymphoedema_location,
      compression_information: profile.compression_information,
      treatment_considerations: profile.treatment_considerations,
      assistance_needs: profile.assistance_needs,
      emergency_contact: emergencyOk ? {
        name: profile.emergency_contact_name,
        relationship: profile.emergency_contact_relationship,
        phone: profile.emergency_contact_phone
      } : { name: null, relationship: null, phone: null },
      additional_statement: profile.additional_statement
    }

    const photo = await signedPhoto(profile.photo_path)
    if (photo) publicProfile.photo_url = photo

    const { data: assistance, error: assistanceError } = await supabaseAdmin
      .from('profile_assistance')
      .select('assistance_options(statement,icon_key)')
      .eq('profile_id', profile.id)
    publicProfile.assistance = assistanceError ? [] : (assistance ?? []).map((item:any) => item.assistance_options).filter(Boolean)
    publicProfile.resources = await selectedResources(profile.id)

    return Response.json(publicProfile, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Unexpected error' }, { status: 500, headers: corsHeaders })
  }
})

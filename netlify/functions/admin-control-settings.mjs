import { verifyAdminRequest } from './_shared/admin-auth.mjs';

const KEYS = Object.freeze({
  registration_mode: { type: 'enum', values: ['OPEN','INVITE_ONLY','CLOSED'], fallback: 'INVITE_ONLY' },
  renewal_first_reminder_days: { type: 'int', min: 14, max: 120, fallback: '60' },
  renewal_final_reminder_days: { type: 'int', min: 3, max: 30, fallback: '14' },
  announcement_enabled: { type: 'bool', fallback: 'false' },
  announcement_message: { type: 'text', max: 320, fallback: '' },
  announcement_start_at: { type: 'datetime', fallback: '' },
  announcement_end_at: { type: 'datetime', fallback: '' },
  communications_admin_notification_email: { type: 'email', max: 254, fallback: 'admin@lymphawareid.com' },
  communications_expiry_notices_enabled: { type: 'bool', fallback: 'true' },
  communications_profile_review_reminders_enabled: { type: 'bool', fallback: 'true' },
  communications_renewal_reminders_enabled: { type: 'bool', fallback: 'true' },
  feature_additional_items_enabled: { type: 'bool', fallback: 'true' },
  feature_additional_languages_enabled: { type: 'bool', fallback: 'true' },
  feature_auto_renew_signup_enabled: { type: 'bool', fallback: 'true' },
  feature_package_standard_enabled: { type: 'bool', fallback: 'true' },
  feature_package_plus_enabled: { type: 'bool', fallback: 'true' },
  feature_package_multilingual_enabled: { type: 'bool', fallback: 'true' },
  feature_term_1y_enabled: { type: 'bool', fallback: 'true' },
  feature_term_2y_enabled: { type: 'bool', fallback: 'true' },
  feature_term_3y_enabled: { type: 'bool', fallback: 'true' },
  feature_language_fr_enabled: { type: 'bool', fallback: 'true' },
  feature_language_es_enabled: { type: 'bool', fallback: 'true' },
  feature_language_de_enabled: { type: 'bool', fallback: 'true' },
  admin_mfa_required: { type: 'bool', fallback: 'false' }
});

function env(name){return String(Netlify.env.get(name)||'').trim()}
function headers(prefer=''){return {apikey:env('SUPABASE_SECRET_KEY'),Authorization:`Bearer ${env('SUPABASE_SECRET_KEY')}`,'Content-Type':'application/json',Accept:'application/json',...(prefer?{Prefer:prefer}:{})}}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
function normalise(key,value){
  const rule=KEYS[key]; if(!rule) throw new Error('Unsupported setting.');
  const raw=String(value??'').trim();
  if(rule.type==='enum'){const v=raw.toUpperCase();if(!rule.values.includes(v))throw new Error(`Invalid value for ${key}.`);return v}
  if(rule.type==='bool') return ['true','1','yes','on'].includes(raw.toLowerCase())?'true':'false';
  if(rule.type==='int'){const n=Number(raw);if(!Number.isInteger(n)||n<rule.min||n>rule.max)throw new Error(`${key} must be between ${rule.min} and ${rule.max}.`);return String(n)}
  if(rule.type==='email'){if(raw.length>rule.max||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))throw new Error(`${key} must be a valid email address.`);return raw.toLowerCase()}
  if(rule.type==='datetime'){if(!raw)return '';const d=new Date(raw);if(!Number.isFinite(d.getTime()))throw new Error(`${key} must be a valid date and time.`);return d.toISOString()}
  if(raw.length>rule.max) throw new Error(`${key} is too long.`);
  return raw;
}
async function log(admin,summary,details={}){
  await fetch(`${env('SUPABASE_URL')}/rest/v1/admin_activity_log`,{method:'POST',headers:headers('return=minimal'),body:JSON.stringify({actor_user_id:admin.id,actor_email:admin.email,action_type:'CONTROL_SETTINGS_UPDATED',entity_type:'system_settings',summary,details})}).catch(()=>{});
}
export default async request=>{
  if(!['GET','PUT'].includes(request.method))return json({error:'Method not allowed.'},405);
  try{
    const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
    if(request.method==='GET'){
      const filter=`in.(${Object.keys(KEYS).join(',')})`;
      const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/system_settings?setting_key=${encodeURIComponent(filter)}&select=setting_key,setting_value,updated_at`,{headers:headers()});
      if(!r.ok)throw new Error('Control settings could not be read.');
      const settings={};for(const [k,rule] of Object.entries(KEYS))settings[k]=rule.fallback;
      for(const row of await r.json())if(KEYS[row.setting_key])settings[row.setting_key]=row.setting_value;
      return json({settings});
    }
    const body=await request.json().catch(()=>({}));const input=body.settings||{};const rows=[];const changed={};
    for(const key of Object.keys(KEYS)){if(!(key in input))continue;const value=normalise(key,input[key]);rows.push({setting_key:key,setting_value:value,updated_at:new Date().toISOString()});changed[key]=value}
    if(!rows.length)return json({error:'No supported settings were supplied.'},400);
    if(changed.admin_mfa_required==='true' && admin.aal!=='aal2') {
      return json({error:'Verify administrator multi-factor authentication before requiring MFA.'},400);
    }
    const startAt=changed.announcement_start_at;
    const endAt=changed.announcement_end_at;
    if(startAt&&endAt&&new Date(endAt).getTime()<=new Date(startAt).getTime()) {
      return json({error:'Announcement end time must be after its start time.'},400);
    }
    const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/system_settings?on_conflict=setting_key`,{method:'POST',headers:headers('resolution=merge-duplicates,return=minimal'),body:JSON.stringify(rows)});
    if(!r.ok)throw new Error('Control settings could not be saved.');
    await log(admin,'Admin Control Centre settings updated',{keys:Object.keys(changed),registration_mode:changed.registration_mode});
    return json({saved:true,settings:changed});
  }catch(error){console.error('Admin control settings error:',error);return json({error:error instanceof Error?error.message:'Control settings could not be updated.'},500)}
};
export const config={path:'/api/admin-control-settings'};
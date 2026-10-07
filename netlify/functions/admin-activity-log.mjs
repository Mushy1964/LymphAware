import { verifyAdminRequest } from './_shared/admin-auth.mjs';
function env(name){return String(Netlify.env.get(name)||'').trim()}
function headers(){return {apikey:env('SUPABASE_SECRET_KEY'),Authorization:`Bearer ${env('SUPABASE_SECRET_KEY')}`,Accept:'application/json'}}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
export default async request=>{
 if(request.method!=='GET')return json({error:'Method not allowed.'},405);
 try{
  const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
  const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/admin_activity_log?select=id,actor_email,action_type,entity_type,entity_id,summary,details,created_at&order=created_at.desc&limit=100`,{headers:headers()});
  if(!r.ok)throw new Error('Admin activity could not be loaded.');
  return json({activity:await r.json()});
 }catch(error){return json({error:error instanceof Error?error.message:'Admin activity could not be loaded.'},500)}
};
export const config={path:'/api/admin-activity-log'};
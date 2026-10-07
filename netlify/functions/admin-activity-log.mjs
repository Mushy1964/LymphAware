import { verifyAdminRequest } from './_shared/admin-auth.mjs';

function env(name){return String(Netlify.env.get(name)||'').trim()}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
function headers(){return{apikey:env('SUPABASE_SECRET_KEY'),Authorization:'Bearer '+env('SUPABASE_SECRET_KEY'),Accept:'application/json'}}

export default async request=>{
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  try{
    const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
    const url=new URL(request.url),q=String(url.searchParams.get('q')||'').trim().toLowerCase(),limit=Math.min(250,Math.max(1,Number(url.searchParams.get('limit')||100)));
    const response=await fetch(env('SUPABASE_URL')+'/rest/v1/admin_activity_log?select=id,actor_email,action_type,entity_type,entity_id,summary,details,created_at&order=created_at.desc&limit=250',{headers:headers()});
    if(!response.ok)throw new Error('Activity log could not be loaded.');
    let rows=await response.json();
    if(q)rows=rows.filter(row=>[row.actor_email,row.action_type,row.entity_type,row.entity_id,row.summary,JSON.stringify(row.details||{})].some(v=>String(v||'').toLowerCase().includes(q)));
    return json({activities:rows.slice(0,limit),total:rows.length,generated_at:new Date().toISOString()});
  }catch(error){console.error('Admin activity log error:',error);return json({error:error instanceof Error?error.message:'Activity log could not be loaded.'},500)}
};

export const config={path:'/api/admin-activity-log'};

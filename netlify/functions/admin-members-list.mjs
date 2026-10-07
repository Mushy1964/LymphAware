import { verifyAdminRequest } from './_shared/admin-auth.mjs';
function env(name){return String(Netlify.env.get(name)||'').trim()}
function headers(){return {apikey:env('SUPABASE_SECRET_KEY'),Authorization:`Bearer ${env('SUPABASE_SECRET_KEY')}`,Accept:'application/json','Content-Type':'application/json'}}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
async function authUser(userId){
  const r=await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users/${encodeURIComponent(userId)}`,{headers:headers()});
  if(!r.ok)return null;const u=await r.json();return {email:u.email||'',lastSignInAt:u.last_sign_in_at||null,createdAt:u.created_at||null}
}
export default async request=>{
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  try{
    const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
    const url=new URL(request.url);const q=String(url.searchParams.get('q')||'').trim().toLowerCase();
    const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/memberships?select=id,user_id,membership_status,payment_status,package_type,membership_term_years,membership_start,membership_end,auto_renew_enabled,next_renewal_at,renewal_price_pence,pending_renewal_price_pence,stripe_subscription_status,profiles(display_name,lymphaware_id,qr_profile_active,profile_next_review_due_at)&order=created_at.desc&limit=100`,{headers:headers()});
    if(!r.ok)throw new Error('Members could not be loaded.');
    const rows=await r.json();const out=[];
    for(const row of rows){
      const auth=await authUser(row.user_id);const profile=Array.isArray(row.profiles)?row.profiles[0]:(row.profiles||{});
      const member={...row,display_name:profile?.display_name||'',lymphaware_id:profile?.lymphaware_id||'',qr_profile_active:Boolean(profile?.qr_profile_active),profile_next_review_due_at:profile?.profile_next_review_due_at||null,email:auth?.email||'',last_sign_in_at:auth?.lastSignInAt||null};
      const hay=[member.display_name,member.lymphaware_id,member.email,member.membership_status,member.package_type].join(' ').toLowerCase();
      if(!q||hay.includes(q))out.push(member);
    }
    return json({members:out});
  }catch(error){console.error('Admin members list error:',error);return json({error:error instanceof Error?error.message:'Members could not be loaded.'},500)}
};
export const config={path:'/api/admin-members-list'};
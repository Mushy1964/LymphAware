import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { brandedEmailHtml } from './_shared/email-branding.mjs';

function env(name){return String(globalThis.Netlify?.env?.get?.(name)||process.env[name]||'').trim()}
function headers(prefer=''){const secret=env('SUPABASE_SECRET_KEY');return{apikey:secret,Authorization:`Bearer ${secret}`,Accept:'application/json','Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})}}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
async function log(admin,userId,email){
  await fetch(`${env('SUPABASE_URL')}/rest/v1/admin_activity_log`,{method:'POST',headers:headers('return=minimal'),body:JSON.stringify({actor_user_id:admin.id,actor_email:admin.email,action_type:'ACCOUNT_ACCESS_LINK_SENT',entity_type:'member',entity_id:userId,summary:'Secure account access link sent to member',details:{recipient:email}})}).catch(()=>{});
}
export default async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  try{
    const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
    const body=await request.json().catch(()=>({}));const userId=String(body.userId||'').trim();
    if(!userId)return json({error:'Member is required.'},400);

    const membershipResponse=await fetch(`${env('SUPABASE_URL')}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,{headers:headers()});
    if(!membershipResponse.ok||!(await membershipResponse.json())?.length)return json({error:'Member record not found.'},404);

    const userResponse=await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users/${encodeURIComponent(userId)}`,{headers:headers()});
    if(!userResponse.ok)return json({error:'Member account could not be loaded.'},404);
    const user=await userResponse.json();const email=String(user?.email||'').trim().toLowerCase();
    if(!email)return json({error:'Member account has no email address.'},400);

    const linkResponse=await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/generate_link`,{
      method:'POST',headers:headers(),body:JSON.stringify({type:'recovery',email,redirect_to:'https://lymphawareid.com/complete-account/'})
    });
    const linkResult=await linkResponse.json().catch(()=>({}));
    if(!linkResponse.ok)throw new Error(linkResult?.msg||linkResult?.message||'Secure account link could not be prepared.');
    const actionLink=String(linkResult?.properties?.action_link||linkResult?.action_link||'').trim();
    if(!actionLink)throw new Error('Secure account link was not returned.');

    const apiKey=env('RESEND_API_KEY');if(!apiKey)throw new Error('Email service is not configured.');
    const subject='Your secure LymphAware ID account access link';
    const text='A new secure account access link has been requested for your LymphAware ID account.\n\nUse the button below to confirm access and choose a new password. The link is personal to your account and should not be shared.\n\nIf you did not expect this message, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team';
    const send=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({
      from:env('ORDER_NOTIFICATION_FROM')||'LymphAware ID <notifications@lymphawareid.com>',
      to:[email],reply_to:['admin@lymphawareid.com'],subject,text,
      html:brandedEmailHtml({title:subject,text,actionUrl:actionLink,actionLabel:'Secure account access'})
    })});
    if(!send.ok)throw new Error('The account access email could not be sent.');
    await log(admin,userId,email);
    return json({sent:true,email});
  }catch(error){console.error('Admin account-access link error:',error);return json({error:error instanceof Error?error.message:'The account access email could not be sent.'},500)}
};
export const config={path:'/api/admin-send-account-access-link'};

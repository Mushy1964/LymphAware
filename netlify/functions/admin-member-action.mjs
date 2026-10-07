import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { dateUK, recordContractEvent, sendMembershipEmail } from './_shared/membership-contract.mjs';
function env(name){return String(Netlify.env.get(name)||'').trim()}
function headers(prefer=''){return {apikey:env('SUPABASE_SECRET_KEY'),Authorization:`Bearer ${env('SUPABASE_SECRET_KEY')}`,'Content-Type':'application/json',Accept:'application/json',...(prefer?{Prefer:prefer}:{})}}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
async function log(admin,membershipId,userId,summary,details={}){
 await fetch(`${env('SUPABASE_URL')}/rest/v1/admin_activity_log`,{method:'POST',headers:headers('return=minimal'),body:JSON.stringify({actor_user_id:admin.id,actor_email:admin.email,action_type:'MEMBER_OPERATION',entity_type:'membership',entity_id:membershipId,summary,details:{user_id:userId,...details}})}).catch(()=>{});
}
async function emailFor(userId){const r=await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users/${encodeURIComponent(userId)}`,{headers:headers()});if(!r.ok)return'';return String((await r.json())?.email||'')}
export default async request=>{
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 try{
  const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
  const body=await request.json().catch(()=>({}));if(body.action!=='CANCEL_AUTO_RENEW')return json({error:'Unsupported member action.'},400);
  const membershipId=String(body.membershipId||'').trim();if(!membershipId)return json({error:'Membership is required.'},400);
  const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/memberships?id=eq.${encodeURIComponent(membershipId)}&select=id,user_id,stripe_subscription_id,auto_renew_enabled,membership_end,stripe_subscription_status&limit=1`,{headers:headers()});
  const membership=(await r.json())?.[0];if(!r.ok||!membership)return json({error:'Membership was not found.'},404);
  if(!membership.auto_renew_enabled||!membership.stripe_subscription_id)return json({error:'Automatic renewal is not currently active.'},400);
  const stripe=await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(membership.stripe_subscription_id)}`,{method:'POST',headers:{Authorization:`Bearer ${env('STRIPE_SECRET_KEY')}`,'Content-Type':'application/x-www-form-urlencoded','Stripe-Version':'2026-07-29.dahlia'},body:new URLSearchParams({cancel_at_period_end:'true'}).toString()});
  const subscription=await stripe.json().catch(()=>({}));if(!stripe.ok)throw new Error('Stripe could not cancel automatic renewal.');
  const now=new Date().toISOString();
  const update=await fetch(`${env('SUPABASE_URL')}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`,{method:'PATCH',headers:headers('return=minimal'),body:JSON.stringify({auto_renew_enabled:false,auto_renew_cancelled_at:now,stripe_subscription_status:subscription.status||membership.stripe_subscription_status||'active',updated_at:now})});
  if(!update.ok)throw new Error('Renewal was cancelled in Stripe but the membership record could not be refreshed.');
  await recordContractEvent({membershipId:membership.id,userId:membership.user_id,eventType:'AUTO_RENEW_CANCELLED',stripeReference:membership.stripe_subscription_id,details:{effective_at_period_end:true,membership_end:membership.membership_end,source:'ADMIN'}});
  const email=await emailFor(membership.user_id);
  if(email)await sendMembershipEmail({to:email,subject:'Your LymphAware ID automatic renewal is cancelled',idempotencyKey:`admin-renewal-cancelled-${membership.stripe_subscription_id}`,text:`Automatic renewal has been cancelled by the LymphAware ID administration team. No further automatic-renewal payment will be taken for this membership.\n\nYour current membership remains active until ${dateUK(membership.membership_end)}.\n\nYou can review its status in your Patient Portal:\nhttps://lymphawareid.com/portal/\n\nIf you have any questions, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team`});
  await log(admin,membership.id,membership.user_id,'Automatic renewal cancelled by administrator',{effective_at_period_end:true,membership_end:membership.membership_end});
  return json({cancelled:true,membershipEnd:membership.membership_end});
 }catch(error){console.error('Admin member action error:',error);return json({error:error instanceof Error?error.message:'Member action could not be completed.'},500)}
};
export const config={path:'/api/admin-member-action'};
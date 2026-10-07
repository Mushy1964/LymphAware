import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import {
  MEMBERSHIP_RENEWAL_URL, RENEWAL_HERO_URL, dateUK, manualRenewalNoticeHtmlText,
  manualRenewalNoticeText, money, projectedRenewalEnd, renewalNoticeHtmlText,
  renewalNoticeText, sendMembershipEmail
} from './_shared/membership-contract.mjs';
import { sendProfileReviewEmail } from './_shared/profile-review.mjs';

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
function sampleMembership(){
 const due=new Date(Date.now()+60*86400000);const end=new Date(due);end.setUTCFullYear(end.getUTCFullYear()+1);
 return {membership_term_years:1,renewal_price_pence:1899,next_renewal_at:due.toISOString(),membership_end:due.toISOString(),package_type:'STANDARD'};
}
async function log(admin,template){
 const headers={apikey:Netlify.env.get('SUPABASE_SECRET_KEY'),Authorization:`Bearer ${Netlify.env.get('SUPABASE_SECRET_KEY')}`,'Content-Type':'application/json',Prefer:'return=minimal'};
 await fetch(`${Netlify.env.get('SUPABASE_URL')}/rest/v1/admin_activity_log`,{method:'POST',headers,body:JSON.stringify({actor_user_id:admin.id,actor_email:admin.email,action_type:'TEST_EMAIL_SENT',entity_type:'email_template',entity_id:template,summary:`Test email sent: ${template}`,details:{recipient:admin.email}})}).catch(()=>{});
}
export default async request=>{
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 try{
  const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
  const {template}=await request.json().catch(()=>({}));const m=sampleMembership();let result;
  if(template==='AUTO_RENEW_FIRST'||template==='AUTO_RENEW_FINAL'){
   const first=template.endsWith('FIRST');const heading=first?'Advance automatic-renewal reminder':'Final automatic-renewal reminder';
   result=await sendMembershipEmail({to:admin.email,subject:`TEST – ${first?'Advance notice of your LymphAware ID membership renewal':'Your LymphAware ID membership renews soon'}`,text:renewalNoticeText(m,heading),htmlTitle:first?'Your membership renews automatically':'Your membership renews soon',htmlText:renewalNoticeHtmlText(m),preheader:`TEST – renewal due ${dateUK(m.next_renewal_at)}.`,actionUrl:MEMBERSHIP_RENEWAL_URL,actionLabel:'Review my membership',heroImageUrl:RENEWAL_HERO_URL,heroImageAlt:'LymphAware ID card, phone and membership identity',heroLinkUrl:MEMBERSHIP_RENEWAL_URL,showHeaderLogo:false,detailRows:[{label:'Next renewal date',value:dateUK(m.next_renewal_at)},{label:'Renewal period',value:'1 year'},{label:'Renewal amount',value:money(m.renewal_price_pence)},{label:'Expected new expiry date',value:dateUK(projectedRenewalEnd(m))}]});
  }else if(template==='MANUAL_FIRST'||template==='MANUAL_FINAL'){
   const first=template.endsWith('FIRST');const heading=first?'Membership expiry reminder':'Final membership expiry reminder';
   result=await sendMembershipEmail({to:admin.email,subject:`TEST – ${first?'Your LymphAware ID membership is approaching expiry':'Your LymphAware ID membership expires soon'}`,text:manualRenewalNoticeText(m,heading),htmlTitle:first?'Your membership is approaching expiry':'Your membership expires soon',htmlText:manualRenewalNoticeHtmlText(m),preheader:`TEST – membership expires ${dateUK(m.membership_end)}.`,actionUrl:MEMBERSHIP_RENEWAL_URL,actionLabel:'Renew now',heroImageUrl:RENEWAL_HERO_URL,heroImageAlt:'LymphAware ID card, phone and membership identity',heroLinkUrl:MEMBERSHIP_RENEWAL_URL,showHeaderLogo:false});
  }else if(template==='PROFILE_REVIEW_FIRST'||template==='PROFILE_REVIEW_FOLLOWUP'){
   result=await sendProfileReviewEmail({to:admin.email,kind:template.endsWith('FOLLOWUP')?'followup':'first',dueAt:new Date().toISOString(),idempotencyKey:''});
  }else return json({error:'Unknown email template.'},400);
  if(!result?.ok)throw new Error(result?.error||'Test email could not be sent.');
  await log(admin,template);return json({sent:true,to:admin.email});
 }catch(error){console.error('Admin test email error:',error);return json({error:error instanceof Error?error.message:'Test email could not be sent.'},500)}
};
export const config={path:'/api/admin-test-email'};
import { brandedEmailHtml } from './_shared/email-branding.mjs';
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
async function sendAdminTest({to,subject,text,actionUrl='',actionLabel=''}) {
 const apiKey=String(Netlify.env.get('RESEND_API_KEY')||'').trim();
 if(!apiKey)return {ok:false,error:'Email service is not configured.'};
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',
  headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
  body:JSON.stringify({
   from:String(Netlify.env.get('ORDER_NOTIFICATION_FROM')||'LymphAware ID <notifications@lymphawareid.com>').trim(),
   to:[to],
   reply_to:['admin@lymphawareid.com'],
   subject,
   text,
   html:brandedEmailHtml({title:subject,text,actionUrl,actionLabel})
  })
 });
 if(!response.ok)return {ok:false,error:await response.text()};
 const body=await response.json().catch(()=>({}));
 return {ok:true,id:body?.id||null};
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
  }else if(template==='STARTUP_WELCOME'){
   const text=
    'Thank you for joining LymphAware ID. Your order has been received and your secure account is ready to complete.\n\n'+
    'Please confirm your email address, then sign in and add the display name and photograph you want shown on your LymphAware ID card.\n\n'+
    'Once you save your display name and photograph, LymphAware ID will be notified automatically that your card details are ready. We will then begin preparing your ID card, lanyard and holder, together with any additional cards or language versions included in your order.\n\n'+
    'We aim to prepare and dispatch your order within 7–10 working days after your required card details have been completed. Delivery time after dispatch will depend on the postal service and destination.\n\n'+
    'YOUR INITIAL COOLING-OFF PERIOD\n\nYou may tell us that you want to cancel within 14 days of joining. Contact admin@lymphawareid.com. Any refund and deduction for services or personalised items already supplied will be handled in accordance with your statutory rights and the Terms.';
   const testText=text+'\n\nTEST NOTE\nThe live customer email contains a secure, one-time account-confirmation button generated specifically for that customer. The button is deliberately omitted from this administrator test copy so no invalid or misleading activation link is created.';
   result=await sendAdminTest({to:admin.email,subject:'TEST – Welcome to LymphAware ID – complete your secure account',text:testText});
  }else if(template==='STARTUP_PRODUCTION'){
   const text=
    'Your LymphAware ID order ORD-000123 has entered card production.\n\n'+
    'We will email you again when the complete order has been packed and dispatched. You can review your details in the Patient Portal:\nhttps://lymphawareid.com/portal/';
   result=await sendAdminTest({to:admin.email,subject:'TEST – Your LymphAware ID cards are now in production – ORD-000123',text,actionUrl:'https://lymphawareid.com/portal/',actionLabel:'Open Patient Portal'});
  }else if(template==='STARTUP_DISPATCH'){
   const text=
    'Your LymphAware ID order ORD-000123 has been completed, packed and dispatched.\n\n'+
    'Thank you for being a LymphAware ID member. You can continue to update your QR profile at any time from the Patient Portal:\nhttps://lymphawareid.com/portal/';
   result=await sendAdminTest({to:admin.email,subject:'TEST – Your LymphAware ID order has been dispatched – ORD-000123',text,actionUrl:'https://lymphawareid.com/portal/',actionLabel:'Open Patient Portal'});
  }else return json({error:'Unknown email template.'},400);
  if(!result?.ok)throw new Error(result?.error||'Test email could not be sent.');
  await log(admin,template);return json({sent:true,to:admin.email});
 }catch(error){console.error('Admin test email error:',error);return json({error:error instanceof Error?error.message:'Test email could not be sent.'},500)}
};
export const config={path:'/api/admin-test-email'};
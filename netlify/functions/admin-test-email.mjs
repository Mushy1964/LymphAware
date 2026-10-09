import { brandedEmailHtml } from './_shared/email-branding.mjs';
import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import {
  MEMBERSHIP_RENEWAL_URL, RENEWAL_HERO_URL, dateUK, manualRenewalNoticeHtmlText,
  manualRenewalNoticeText, money, projectedRenewalEnd, renewalNoticeHtmlText,
  renewalNoticeText, sendMembershipEmail
} from './_shared/membership-contract.mjs';
import { sendProfileReviewEmail } from './_shared/profile-review.mjs';
import { buildInitialMembershipWelcome, buildOrderStatusCommunication } from './_shared/customer-communication-content.mjs';

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
   const welcome=buildInitialMembershipWelcome({membershipTermYears:1,isTrial:false,accountSetupLink:'',languageName:'',autoRenew:true,renewalPricePence:1899});
   const text=
    'Thank you for your LymphAware ID purchase.\n\nOrder: ORD-000123\n\nItems:\n• 1 × LymphAware ID Standard – 1-Year\n• 1 × Lanyard & holder\n\nPostage & packing (before any promotion discount): £2.99\nTotal paid: £27.98\n\n'+
    welcome.nextSteps+
    '\n\nIf you need help, contact admin@lymphawareid.com.\n\nThe LymphAware ID Team\n\nTEST NOTE\nThe live customer email contains a secure, one-time account-confirmation button generated specifically for that customer. The button is deliberately omitted from this administrator test copy.';
   result=await sendAdminTest({to:admin.email,subject:'TEST – '+welcome.subject,text});
  }else if(template==='ADMIN_PROFILE_READY'){
   const subject='TEST – LymphAware ID profile details ready for card production – LA-000003';
   const text=
    'A LymphAware ID member has now saved the two mandatory details needed for ID card production.\n\n'+
    'Order: ORD-000123\n'+
    'LymphAware ID: LA-000003\n'+
    'Display name: Alex Morgan\n'+
    'Customer email: alex.morgan@example.com\n\n'+
    'Order contents:\n'+
    '• 2 × LymphAware ID cards – English\n'+
    '• 2 × Lanyards & holders\n\n'+
    'The order will now appear at the appropriate stage in LymphAware ID Administration. If the order includes an additional language, that language version may still be preparing before the complete order is ready to print.\n\n'+
    'Open LymphAware ID Administration:\nhttps://lymphawareid.com/admin/?stage=PROCESS';
   result=await sendAdminTest({to:admin.email,subject,text,actionUrl:'https://lymphawareid.com/admin/?stage=PROCESS',actionLabel:'Open LymphAware ID Administration'});
  }else if(template==='STARTUP_PRODUCTION'){
   const communication=buildOrderStatusCommunication({order_number:123},'production');
   result=await sendAdminTest({to:admin.email,subject:'TEST – '+communication.subject,text:communication.text,actionUrl:'https://lymphawareid.com/portal/',actionLabel:'Open Patient Portal'});
  }else if(template==='STARTUP_DISPATCH'){
   const communication=buildOrderStatusCommunication({order_number:123},'completion');
   result=await sendAdminTest({to:admin.email,subject:'TEST – '+communication.subject,text:communication.text,actionUrl:'https://lymphawareid.com/portal/',actionLabel:'Open Patient Portal'});
  }else return json({error:'Unknown email template.'},400);
  if(!result?.ok)throw new Error(result?.error||'Test email could not be sent.');
  await log(admin,template);return json({sent:true,to:admin.email});
 }catch(error){console.error('Admin test email error:',error);return json({error:error instanceof Error?error.message:'Test email could not be sent.'},500)}
};
export const config={path:'/api/admin-test-email'};
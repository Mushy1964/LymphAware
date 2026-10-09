import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { retryFailedOrderCustomerNotification } from './_shared/order-notifications.mjs';

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
async function log(admin,summary,details={}){
  const secret=String(Netlify.env.get('SUPABASE_SECRET_KEY')||'').trim();
  await fetch(`${Netlify.env.get('SUPABASE_URL')}/rest/v1/admin_activity_log`,{method:'POST',headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({actor_user_id:admin.id,actor_email:admin.email,action_type:'CUSTOMER_NOTIFICATION_RETRIED',entity_type:'order',summary,details})}).catch(()=>{});
}
export default async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  try{
    const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
    const body=await request.json().catch(()=>({}));const orderId=String(body.orderId||'').trim();const kind=String(body.kind||'').trim().toUpperCase();
    if(!orderId||!['PRODUCTION','COMPLETION'].includes(kind))return json({error:'Order and failed notification type are required.'},400);
    const result=await retryFailedOrderCustomerNotification(orderId,kind==='PRODUCTION'?'production':'completion');
    if(!result?.ok)throw new Error(result?.error||'The notification could not be sent.');
    await log(admin,`Failed ${kind.toLowerCase()} email retried`,{order_id:orderId,kind});
    return json({sent:true});
  }catch(error){console.error('Admin customer-notification retry error:',error);return json({error:error instanceof Error?error.message:'The notification could not be retried.'},500)}
};
export const config={path:'/api/admin-retry-customer-notification'};

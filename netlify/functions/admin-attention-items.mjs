import { verifyAdminRequest } from './_shared/admin-auth.mjs';

function env(name){return String(globalThis.Netlify?.env?.get?.(name)||process.env[name]||'').trim()}
function headers(){const secret=env('SUPABASE_SECRET_KEY');return{apikey:secret,Authorization:`Bearer ${secret}`,Accept:'application/json'}}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
async function table(path){const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`,{headers:headers()});if(!r.ok)throw new Error(`Unable to load operational attention data: ${await r.text()}`);return r.json()}
function when(value){const t=new Date(value||0).getTime();return Number.isFinite(t)?t:0}
function ref(n){return n==null?'Order':`ORD-${String(n).padStart(6,'0')}`}

export default async request=>{
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  try{
    const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
    const [orders,memberships,profiles,languages]=await Promise.all([
      table('orders?select=id,user_id,order_number,order_status,is_archived,notification_status,customer_confirmation_status,production_notification_status,completion_notification_status,created_at,updated_at&order=created_at.desc&limit=500'),
      table('memberships?select=id,user_id,membership_status,payment_status,stripe_subscription_status,auto_renew_enabled,next_renewal_at,initial_cooling_off_cancellation_requested_at,initial_cooling_off_cancellation_status,cooling_off_cancellation_requested_at,pending_renewal_price_pence,pending_renewal_price_effective_after,updated_at&limit=500'),
      table('profiles?select=user_id,display_name,lymphaware_id,is_demo,is_archived&limit=1000'),
      table('language_profiles?select=id,user_id,language_name,setup_status,translation_error,updated_at&translation_error=not.is.null&limit=200')
    ]);
    const profileByUser=new Map((profiles||[]).filter(p=>!p.is_demo).map(p=>[p.user_id,p]));
    const memberLabel=userId=>{const p=profileByUser.get(userId);return p?.display_name||p?.lymphaware_id||'Member'};
    const items=[];
    const now=Date.now();
    for(const o of orders||[]){
      if(o.is_archived===true)continue;
      const label=ref(o.order_number),url=`/admin/orders/?order=${encodeURIComponent(o.id)}#order-${encodeURIComponent(o.id)}`;
      if(o.order_status==='ADDRESS_REVIEW_REQUIRED')items.push({type:'ADDRESS_REVIEW',severity:'high',title:`${label} needs delivery-address review`,detail:'Selected delivery country and Stripe delivery address need checking before fulfilment continues.',url,created_at:o.updated_at||o.created_at});
      if(['PAID_AWAITING_PROFILE','READY_TO_PRINT','IN_PRODUCTION'].includes(o.order_status)&&now-when(o.created_at)>10*86400000)items.push({type:'FULFILMENT_OLD',severity:'medium',title:`${label} has been open for more than 10 days`,detail:'Review the order and card-production status.',url,created_at:o.created_at});
      if(o.notification_status==='FAILED')items.push({type:'ADMIN_EMAIL_FAILED',severity:'medium',title:`${label} administrator notification failed`,detail:'The operational new-order email needs attention.',url,order_id:o.id,retry_kind:'ADMIN_ORDER',created_at:o.updated_at||o.created_at});
      if(o.customer_confirmation_status==='FAILED')items.push({type:'CUSTOMER_CONFIRMATION_FAILED',severity:'high',title:`${label} customer welcome/order email failed`,detail:'The customer did not receive the normal confirmation. Open the order to review it; a secure account-access link can also be sent from Member management if needed.',url,member_user_id:o.user_id,created_at:o.updated_at||o.created_at});
      if(o.production_notification_status==='FAILED')items.push({type:'PRODUCTION_EMAIL_FAILED',severity:'medium',title:`${label} production email failed`,detail:'The customer production notification can be retried safely.',url,order_id:o.id,retry_kind:'PRODUCTION',created_at:o.updated_at||o.created_at});
      if(o.completion_notification_status==='FAILED')items.push({type:'DISPATCH_EMAIL_FAILED',severity:'medium',title:`${label} dispatch email failed`,detail:'The customer dispatch notification can be retried safely.',url,order_id:o.id,retry_kind:'COMPLETION',created_at:o.updated_at||o.created_at});
    }
    for(const m of memberships||[]){
      const name=memberLabel(m.user_id);
      if(m.auto_renew_enabled&&['past_due','unpaid','incomplete'].includes(String(m.stripe_subscription_status||'').toLowerCase()))items.push({type:'RENEWAL_PAYMENT',severity:'high',title:`${name} has a renewal payment problem`,detail:`Stripe subscription status: ${m.stripe_subscription_status}.`,url:'/admin/control-centre/',created_at:m.updated_at});
      if(m.initial_cooling_off_cancellation_requested_at&&String(m.initial_cooling_off_cancellation_status||'').toUpperCase()!=='COMPLETED')items.push({type:'INITIAL_CANCELLATION',severity:'high',title:`${name} has requested initial cooling-off cancellation`,detail:'Review the cancellation request in Order Management.',url:'/admin/',created_at:m.initial_cooling_off_cancellation_requested_at});
      if(m.cooling_off_cancellation_requested_at)items.push({type:'RENEWAL_CANCELLATION',severity:'high',title:`${name} has requested renewal cancellation`,detail:'Review the renewed-membership cooling-off request.',url:'/admin/',created_at:m.cooling_off_cancellation_requested_at});
      if(m.pending_renewal_price_pence)items.push({type:'DEFERRED_PRICE',severity:'info',title:`${name} has a queued future renewal price`,detail:'The protected future price change is queued for a later renewal cycle.',url:'/admin/control-centre/',created_at:m.updated_at});
    }
    for(const l of languages||[]){
      if(!String(l.translation_error||'').trim())continue;
      items.push({type:'TRANSLATION_ERROR',severity:'medium',title:`${memberLabel(l.user_id)} – ${l.language_name||'language'} translation needs attention`,detail:String(l.translation_error||'Translation preparation failed.').slice(0,240),url:'/admin/languages/',created_at:l.updated_at});
    }
    items.sort((a,b)=>({high:3,medium:2,info:1}[b.severity]-({high:3,medium:2,info:1}[a.severity])||when(b.created_at)-when(a.created_at)));
    const actionable=items.filter(i=>i.severity!=='info');
    return json({items:items.slice(0,50),summary:{actionable:actionable.length,high:items.filter(i=>i.severity==='high').length,medium:items.filter(i=>i.severity==='medium').length,info:items.filter(i=>i.severity==='info').length}});
  }catch(error){console.error('Admin attention summary error:',error);return json({error:error instanceof Error?error.message:'Attention summary could not be loaded.'},500)}
};
export const config={path:'/api/admin-attention-items'};

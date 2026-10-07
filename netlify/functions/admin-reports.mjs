import { verifyAdminRequest } from './_shared/admin-auth.mjs';

function env(name){return String(Netlify.env.get(name)||'').trim()}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
function headers(range=''){return{apikey:env('SUPABASE_SECRET_KEY'),Authorization:'Bearer '+env('SUPABASE_SECRET_KEY'),Accept:'application/json',...(range?{Range:range}:{})}}
async function fetchAll(path){const rows=[],size=1000;for(let offset=0;;offset+=size){const response=await fetch(env('SUPABASE_URL')+path,{headers:headers(offset+'-'+(offset+size-1))});if(!response.ok)throw new Error('Report data could not be loaded.');const page=await response.json();rows.push(...page);if(page.length<size)return rows}}
async function authUsers(){const rows=[];for(let page=1;page<=20;page++){const response=await fetch(env('SUPABASE_URL')+'/auth/v1/admin/users?page='+page+'&per_page=1000',{headers:headers()});if(!response.ok)return rows;const data=await response.json(),batch=Array.isArray(data?.users)?data.users:[];rows.push(...batch);if(batch.length<1000)return rows}return rows}
function csvCell(v){const s=String(v??'');return '"'+s.replaceAll('"','""')+'"'}
function csv(rows,columns){return [columns.map(c=>csvCell(c.label)).join(','),...rows.map(row=>columns.map(c=>csvCell(row[c.key])).join(','))].join('\n')}
function ref(n){return n?'ORD-'+String(n).padStart(6,'0'):''}
function profileMaps(profiles,users){return{profiles:new Map(profiles.map(p=>[p.user_id,p])),emails:new Map(users.map(u=>[u.id,u.email||'']))}}

export default async request=>{
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  try{
    const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
    const url=new URL(request.url),type=String(url.searchParams.get('type')||'summary').toLowerCase(),format=String(url.searchParams.get('format')||'json').toLowerCase();
    const [memberships,orders,profiles,users]=await Promise.all([
      fetchAll('/rest/v1/memberships?select=user_id,package_type,membership_status,payment_status,membership_start,membership_end,membership_term_years,auto_renew_enabled,next_renewal_at,renewal_price_pence,pending_renewal_price_pence'),
      fetchAll('/rest/v1/orders?select=id,user_id,order_number,order_type,order_status,payment_status,total_pence,paid_at,created_at,workflow_stage,is_archived&order=created_at.desc'),
      fetchAll('/rest/v1/profiles?is_demo=eq.false&select=user_id,display_name,lymphaware_id,is_archived'),
      authUsers()
    ]);
    const maps=profileMaps(profiles.filter(p=>p.is_archived!==true),users),now=Date.now(),days60=now+60*86400000;
    const entitled=memberships.filter(m=>['ACTIVE','PILOT','SPONSORED'].includes(String(m.membership_status||'').toUpperCase())&&(!m.membership_end||new Date(m.membership_end).getTime()>now));
    const paidOrders=orders.filter(o=>String(o.payment_status||'').toUpperCase()==='PAID');
    const openFulfilment=orders.filter(o=>!o.is_archived&&!['COMPLETED','CLOSED','CANCELLED','REFUNDED'].includes(String(o.workflow_stage||o.order_status||'').toUpperCase()));
    const upcomingRenewals=memberships.filter(m=>m.auto_renew_enabled&&m.next_renewal_at&&new Date(m.next_renewal_at).getTime()>=now&&new Date(m.next_renewal_at).getTime()<=days60);
    const upcomingExpiries=memberships.filter(m=>!m.auto_renew_enabled&&m.membership_end&&new Date(m.membership_end).getTime()>=now&&new Date(m.membership_end).getTime()<=days60);

    if(type==='summary')return json({summary:{active_memberships:entitled.length,auto_renew_active:memberships.filter(m=>m.auto_renew_enabled).length,renewals_next_60_days:upcomingRenewals.length,expiries_next_60_days:upcomingExpiries.length,paid_order_revenue_pence:paidOrders.reduce((s,o)=>s+Number(o.total_pence||0),0,open_fulfilment:openFulfilment.length,total_paid_orders:paidOrders.length},generated_at:new Date().toISOString()});

    let rows=[],columns=[];
    if(type==='memberships'){
      rows=memberships.map(m=>({name:maps.profiles.get(m.user_id)?.display_name||'',lymphaware_id:maps.profiles.get(m.user_id)?.lymphaware_id||'',email:maps.emails.get(m.user_id)||'',package:m.package_type||'',status:m.membership_status||'',payment:m.payment_status||'',term_years:m.membership_term_years||'',start:m.membership_start||'',end:m.membership_end||'',auto_renew:m.auto_renew_enabled?'Yes':'No',next_renewal:m.next_renewal_at||''}));
      columns=[['name','Name'],['lymphaware_id','LymphAware ID'],['email','Email'],['package','Package'],['status','Status'],['payment','Payment'],['term_years','Term years'],['start','Start'],['end','End'],['auto_renew','Auto renew'],['next_renewal','Next renewal']].map(([key,label])=>({key,label}));
    }else if(type==='renewals'){
      rows=memberships.filter(m=>m.membership_end||m.next_renewal_at).map(m=>({name:maps.profiles.get(m.user_id)?.display_name||'',lymphaware_id:maps.profiles.get(m.user_id)?.lymphaware_id||'',email:maps.emails.get(m.user_id)||'',package:m.package_type||'',term_years:m.membership_term_years||'',auto_renew:m.auto_renew_enabled?'Yes':'No',current_price_pence:m.renewal_price_pence||'',pending_price_pence:m.pending_renewal_price_pence||'',next_renewal:m.next_renewal_at||'',membership_end:m.membership_end||''})).sort((a,b)=>new Date(a.next_renewal||a.membership_end||0)-new Date(b.next_renewal||b.membership_end||0));
      columns=[['name','Name'],['lymphaware_id','LymphAware ID'],['email','Email'],['package','Package'],['term_years','Term years'],['auto_renew','Auto renew'],['current_price_pence','Renewal price pence'],['pending_price_pence','Pending future price pence'],['next_renewal','Next renewal'],['membership_end','Membership end']].map(([key,label])=>({key,label}));
    }else if(type==='auto-renew'){
      rows=memberships.filter(m=>m.auto_renew_enabled).map(m=>({name:maps.profiles.get(m.user_id)?.display_name||'',lymphaware_id:maps.profiles.get(m.user_id)?.lymphaware_id||'',email:maps.emails.get(m.user_id)||'',package:m.package_type||'',term_years:m.membership_term_years||'',renewal_price_pence:m.renewal_price_pence||'',pending_price_pence:m.pending_renewal_price_pence||'',next_renewal:m.next_renewal_at||''}));
      columns=[['name','Name'],['lymphaware_id','LymphAware ID'],['email','Email'],['package','Package'],['term_years','Term years'],['renewal_price_pence','Renewal price pence'],['pending_price_pence','Pending future price pence'],['next_renewal','Next renewal']].map(([key,label])=>({key,label}));
    }else if(type==='orders'){
      rows=orders.map(o=>({reference:ref(o.order_number),order_type:o.order_type||'',order_status:o.order_status||'',payment_status:o.payment_status||'',total_pence:o.total_pence||0,paid_at:o.paid_at||'',created_at:o.created_at||'',workflow_stage:o.workflow_stage||''}));
      columns=[['reference','Order'],['order_type','Order type'],['order_status','Order status'],['payment_status','Payment status'],['total_pence','Total pence'],['paid_at','Paid at'],['created_at','Created at'],['workflow_stage','Workflow stage']].map(([key,label])=>({key,label}));
    }else if(type==='fulfilment'){
      rows=openFulfilment.map(o=>({reference:ref(o.order_number),order_type:o.order_type||'',order_status:o.order_status||'',workflow_stage:o.workflow_stage||'',payment_status:o.payment_status||'',created_at:o.created_at||''}));
      columns=[['reference','Order'],['order_type','Order type'],['order_status','Order status'],['workflow_stage','Workflow stage'],['payment_status','Payment status'],['created_at','Created at']].map(([key,label])=>({key,label}));
    }else return json({error:'Unknown report type.'},400);

    if(format==='csv'){
      return new Response(csv(rows,columns),{status:200,headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="lymphaware-'+type+'-'+new Date().toISOString().slice(0,10)+'.csv"','Cache-Control':'no-store'}});
    }
    return json({type,rows,count:rows.length,generated_at:new Date().toISOString()});
  }catch(error){console.error('Admin reports error:',error);return json({error:error instanceof Error?error.message:'Report could not be generated.'},500)}
};

export const config={path:'/api/admin-reports'};

import { verifyAdminRequest } from './_shared/admin-auth.mjs';

function env(name){return String(globalThis.Netlify?.env?.get?.(name)||process.env[name]||'').trim()}
function headers(prefer=''){const secret=env('SUPABASE_SECRET_KEY');return{apikey:secret,Authorization:`Bearer ${secret}`,Accept:'application/json','Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})}}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}
function text(v,max){const s=String(v??'').trim();if(!s||s.length>max)throw new Error('One or more resource fields are invalid.');return s}
async function log(admin,summary,details={}){
  await fetch(`${env('SUPABASE_URL')}/rest/v1/admin_activity_log`,{method:'POST',headers:headers('return=minimal'),body:JSON.stringify({actor_user_id:admin.id,actor_email:admin.email,action_type:'INFORMATION_RESOURCE_UPDATED',entity_type:'information_resources',summary,details})}).catch(()=>{});
}
export default async request=>{
  if(!['GET','PATCH'].includes(request.method))return json({error:'Method not allowed.'},405);
  try{
    const admin=await verifyAdminRequest(request);if(!admin)return json({error:'Administrator access required.'},403);
    if(request.method==='GET'){
      const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/information_resources?select=id,slug,organisation,title,description,url,category,language_code,active,sort_order,updated_at&order=sort_order.asc,id.asc`,{headers:headers()});
      if(!r.ok)throw new Error('Information resources could not be loaded.');
      return json({resources:await r.json()});
    }
    const body=await request.json().catch(()=>({}));const id=Number(body.id);
    if(!Number.isInteger(id)||id<=0)return json({error:'Resource ID is required.'},400);
    const url=text(body.url,1000);let parsed;try{parsed=new URL(url)}catch{return json({error:'Enter a valid resource web address.'},400)}
    if(parsed.protocol!=='https:')return json({error:'Resource links must use https.'},400);
    const sortOrder=Number(body.sort_order);if(!Number.isInteger(sortOrder)||sortOrder<0||sortOrder>9999)return json({error:'Sort order must be a whole number between 0 and 9999.'},400);
    const update={organisation:text(body.organisation,160),title:text(body.title,240),url,active:body.active===true,sort_order:sortOrder,updated_at:new Date().toISOString()};
    const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/information_resources?id=eq.${id}`,{method:'PATCH',headers:headers('return=representation'),body:JSON.stringify(update)});
    if(!r.ok)throw new Error('Information resource could not be updated.');
    const resource=(await r.json())?.[0];if(!resource)return json({error:'Information resource not found.'},404);
    await log(admin,'Information resource updated',{resource_id:id,active:update.active,sort_order:sortOrder,url});
    return json({saved:true,resource});
  }catch(error){console.error('Admin information-resource error:',error);return json({error:error instanceof Error?error.message:'Information resource could not be updated.'},500)}
};
export const config={path:'/api/admin-information-resources'};

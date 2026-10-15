import { db, response, verifyUnsubscribeToken } from './_shared/prelaunch-interest.mjs';
export default async request => {
  if(request.method!=='POST')return response({error:'Method not allowed.'},405);
  try {
    const body=JSON.parse((await request.text()).slice(0,1000)||'{}'),id=verifyUnsubscribeToken(body.token);
    if(!id)return response({error:'Invalid or expired unsubscribe link.'},400);
    await db('prelaunch_interest','id=eq.'+id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({unsubscribed_at:new Date().toISOString(),first_name:'',suggestion:'',admin_notes:'',updated_at:new Date().toISOString()})});
    return response({ok:true});
  }catch(error){console.error('Unsubscribe failed',error?.message);return response({error:'Unable to process the request.'},500);}
};
export const config={path:'/api/prelaunch-unsubscribe',rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:600,windowLimit:20}};

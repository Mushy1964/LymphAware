import { db, response, sha, clean } from './_shared/prelaunch-interest.mjs';
export default async request => {
  if(request.method!=='POST')return response({error:'Method not allowed.'},405);
  try {
    const body=JSON.parse((await request.text()).slice(0,1000)||'{}'),token=clean(body.token,128);
    if(!/^[a-f0-9]{64}$/.test(token))return response({error:'Invalid link.'},400);
    const rows=await db('prelaunch_interest','select=id&unsubscribe_hash=eq.'+sha(token)+'&limit=1');
    if(rows[0])await db('prelaunch_interest','id=eq.'+rows[0].id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({unsubscribed_at:new Date().toISOString(),first_name:'',suggestion:'',admin_notes:''})});
    return response({ok:true});
  }catch(error){console.error('Unsubscribe failed',error?.message);return response({error:'Unable to process the request.'},500);}
};
export const config={path:'/api/prelaunch-unsubscribe',rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:600,windowLimit:20}};

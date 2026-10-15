import { db, response, sha, clean } from './_shared/prelaunch-interest.mjs';
export default async request => {
  if(request.method!=='POST')return response({error:'Method not allowed.'},405);
  try {
    const body=JSON.parse((await request.text()).slice(0,1000)||'{}');
    const token=clean(body.token,128);
    if(!/^[a-f0-9]{64}$/.test(token))return response({error:'This confirmation link is invalid.'},400);
    const rows=await db('prelaunch_interest','select=id,confirmed_at,unsubscribed_at,confirmation_expires_at&confirmation_hash=eq.'+sha(token)+'&limit=1');
    const row=rows[0];
    if(!row||row.unsubscribed_at||!row.confirmation_expires_at||new Date(row.confirmation_expires_at)<new Date())return response({error:'This link is no longer valid. Please register again to receive a fresh confirmation email.'},400);
    if(!row.confirmed_at)await db('prelaunch_interest','id=eq.'+row.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({confirmed_at:new Date().toISOString(),confirmation_hash:null,confirmation_expires_at:null})});
    return response({ok:true});
  }catch(error){console.error('Interest confirmation failed',error?.message);return response({error:'Confirmation is temporarily unavailable.'},500);}
};
export const config={path:'/api/prelaunch-confirm',rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:600,windowLimit:20}};

import { db, env, response, sha, randomToken, clean, isEnabled, sendConfirm } from './_shared/prelaunch-interest.mjs';

const generic='Thank you. If this registration needs confirmation, we will email a link shortly. If you have already confirmed, there is nothing further to do. Please check your inbox and junk folder.';
export default async request => {
  try {
    if(request.method!=='POST')return response({error:'Method not allowed.'},405);
    if(!(await isEnabled()))return response({error:'Pre-launch registrations are currently closed.'},410);
    const origin=request.headers.get('origin');
    if(origin && new URL(origin).hostname!=='lymphawareid.com' && new URL(origin).hostname!=='www.lymphawareid.com' && !new URL(origin).hostname.endsWith('.netlify.app'))return response({error:'Invalid origin.'},403);
    const raw=await request.text();if(raw.length>6000)return response({error:'The form is too long.'},413);
    const body=JSON.parse(raw||'{}');
    if(body.botField)return response({ok:true,message:generic});
    const email=clean(body.email,254).toLowerCase(),first_name=clean(body.firstName,80),
      suggestion=clean(body.suggestion,1200),interest_level=clean(body.interestLevel,20),
      source=['website','forum','social','other'].includes(body.source)?body.source:'website';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254)return response({error:'Enter a valid email address.'},400);
    if(!['','yes','possibly','unsure'].includes(interest_level))return response({error:'Invalid interest selection.'},400);
    if(body.emailConsent!==true)return response({error:'Please tick the email consent checkbox.'},400);
    const prior=await db('prelaunch_interest','select=id,confirmed_at,unsubscribed_at&email=eq.'+encodeURIComponent(email)+'&limit=1');
    if(prior.length && (prior[0].confirmed_at||prior[0].unsubscribed_at))return response({ok:true,message:generic});
    const confirmation=randomToken(),now=new Date(),expires=new Date(now.getTime()+48*3600000).toISOString();
    const row={email,first_name,suggestion,interest_level,source,consent_at:now.toISOString(),consent_version:'prelaunch-email-v1',confirmation_hash:sha(confirmation),confirmation_expires_at:expires,updated_at:now.toISOString()};
    if(prior.length){
      await db('prelaunch_interest','id=eq.'+prior[0].id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
    } else {
      row.unsubscribe_hash=sha(randomToken());
      await db('prelaunch_interest','',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
    }
    await sendConfirm(email,first_name,confirmation);
    return response({ok:true,message:generic});
  }catch(error){
    console.error('Prelaunch interest registration failed:',error instanceof Error?error.message:error);
    return response({error:'We could not complete the registration. Please try again later.'},500);
  }
};
export const config={path:'/api/prelaunch-interest',method:'POST',rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:600,windowLimit:8}};

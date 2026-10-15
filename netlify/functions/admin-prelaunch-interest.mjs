import { verifyAdminRequest } from './_shared/admin-auth.mjs';
import { db, isEnabled, setEnabled, response, clean } from './_shared/prelaunch-interest.mjs';

export default async request => {
  const admin=await verifyAdminRequest(request);
  if(!admin)return response({error:'Administrator access required.'},403);
  try {
    if(request.method==='GET'){
      const enabled=await isEnabled();
      const rows=await db('prelaunch_interest','select=id,first_name,email,interest_level,suggestion,source,consent_at,consent_version,confirmed_at,unsubscribed_at,review_status,admin_notes,created_at&order=created_at.desc&limit=1000');
      return response({enabled,rows});
    }
    if(request.method!=='PATCH'&&request.method!=='DELETE')return response({error:'Method not allowed.'},405);
    const raw=await request.text();if(raw.length>5000)return response({error:'Request too long.'},413);
    const body=JSON.parse(raw||'{}');
    if(request.method==='PATCH' && body.action==='toggle'){
      if(typeof body.enabled!=='boolean')return response({error:'Invalid setting.'},400);
      await setEnabled(body.enabled);
      return response({ok:true,enabled:body.enabled});
    }
    const id=clean(body.id,64);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return response({error:'Invalid registration.'},400);
    if(request.method==='DELETE'){
      await db('prelaunch_interest','id=eq.'+id,{method:'DELETE',headers:{Prefer:'return=minimal'}});
      return response({ok:true});
    }
    if(body.action==='review'){
      if(!['new','reviewed','follow_up','archived'].includes(body.status))return response({error:'Invalid status.'},400);
      await db('prelaunch_interest','id=eq.'+id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({review_status:body.status,admin_notes:clean(body.notes,2000),updated_at:new Date().toISOString()})});
      return response({ok:true});
    }
    if(body.action==='unsubscribe'){
      await db('prelaunch_interest','id=eq.'+id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({unsubscribed_at:new Date().toISOString(),first_name:'',suggestion:'',admin_notes:'',updated_at:new Date().toISOString()})});
      return response({ok:true});
    }
    return response({error:'Unknown action.'},400);
  }catch(error){console.error('Admin prelaunch interest failed',error?.message);return response({error:'The request could not be completed.'},500);}
};
export const config={path:'/api/admin-prelaunch-interest'};

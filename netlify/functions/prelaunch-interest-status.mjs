import { isEnabled, response } from './_shared/prelaunch-interest.mjs';
export default async request => {
  if(request.method!=='GET')return response({error:'Method not allowed.'},405);
  try{return response({enabled:await isEnabled()});}
  catch(error){console.error('Prelaunch status unavailable',error?.message);return response({enabled:false},503);}
};
export const config={path:'/api/prelaunch-interest-status',method:'GET'};

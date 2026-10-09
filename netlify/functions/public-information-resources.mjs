function env(name){return String(globalThis.Netlify?.env?.get?.(name)||process.env[name]||'').trim()}
function headers(){const secret=env('SUPABASE_SECRET_KEY');return{apikey:secret,Authorization:`Bearer ${secret}`,Accept:'application/json'}}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}

export default async request=>{
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  try{
    const url=`${env('SUPABASE_URL')}/rest/v1/information_resources?active=eq.true&language_code=eq.EN&select=id,slug,organisation,title,description,url,category,language_code,sort_order&order=sort_order.asc,id.asc`;
    const response=await fetch(url,{headers:headers()});
    if(!response.ok)throw new Error('Approved information resources could not be loaded.');
    return json({resources:await response.json()});
  }catch(error){
    console.error('Public information resources error:',error);
    return json({resources:[],error:'Approved information resources could not be loaded.'},500);
  }
};

export const config={path:'/api/public-information-resources'};

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function env(name) { return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || '').trim(); }
export function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } });
}
export function sha(value) { return createHash('sha256').update(String(value)).digest('hex'); }
export function randomToken() { return randomBytes(32).toString('hex'); }
export function unsubscribeLink(id) {
  const sig=createHmac('sha256',secret()).update('unsubscribe:'+id).digest('hex');
  return 'https://lymphawareid.com/register-interest/unsubscribe/?token='+encodeURIComponent(id+'.'+sig);
}
export function verifyUnsubscribeToken(value) {
  const token=String(value||'').trim();
  const match=/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([a-f0-9]{64})$/i.exec(token);
  if(!match)return null;
  const sig=createHmac('sha256',secret()).update('unsubscribe:'+match[1]).digest();
  const supplied=Buffer.from(match[2],'hex');
  return timingSafeEqual(sig,supplied)?match[1]:null;
}
export function clean(value, max) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max); }
function secret() { const key=env('SUPABASE_SECRET_KEY'); if(!key || !env('SUPABASE_URL')) throw new Error('Private database connection is unavailable'); return key; }
export async function db(table, params = '', options = {}) {
  const key=secret();
  const url=env('SUPABASE_URL').replace(/\/$/,'') + '/rest/v1/' + table + (params ? '?' + params : '');
  const result=await fetch(url,{ ...options, headers: {
    'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json',
    'Accept':'application/json', ...(options.headers||{})
  }});
  if(!result.ok) { console.error('Prelaunch database request failed',table,result.status,(await result.text()).slice(0,150));throw new Error('Database request failed'); }
  if(result.status===204)return [];
  return result.json();
}
export async function isEnabled() {
  const data=await db('prelaunch_interest_config','select=enabled&id=eq.true&limit=1');
  return data[0]?.enabled===true;
}
export async function setEnabled(enabled) {
  await db('prelaunch_interest_config','id=eq.true',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({enabled,updated_at:new Date().toISOString()})});
}
export async function sendConfirm(email, firstName, confirmToken) {
  const apiKey=env('RESEND_API_KEY'); if(!apiKey) throw new Error('Email confirmation is unavailable');
  const origin='https://lymphawareid.com';
  const confirm=origin+'/register-interest/confirm/?token='+encodeURIComponent(confirmToken);
  const name=firstName ? firstName+', ' : '';
  const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({
    from: env('CONTACT_NOTIFICATION_FROM') || env('ORDER_NOTIFICATION_FROM') || 'LymphAware ID <notifications@lymphawareid.com>',
    to:[email],subject:'Confirm your LymphAware ID launch updates',
    text:'Hello '+name+'\n\nPlease confirm that you would like to receive LymphAware ID launch and related service updates by opening this link and selecting Confirm my interest:\n'+confirm+'\n\nIf you did not register, you do not need to do anything.\n\nPrivacy: '+origin+'/privacy/\n\nLymphAware ID',
    html:'<p>Hello '+escapeHtml(name||'there,')+'</p><p>Please confirm that you would like to receive LymphAware ID launch and related service updates.</p><p><a href="'+confirm+'">Confirm my interest</a></p><p>If you did not register, you can ignore this email.</p><p><a href="'+origin+'/privacy/">Privacy Notice</a></p><p>LymphAware ID</p>'
  })});
  if(!result.ok){console.error('Prelaunch confirmation email failed',result.status);throw new Error('Confirmation email could not be delivered');}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

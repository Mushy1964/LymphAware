import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { brandedEmailHtml } from './email-branding.mjs';

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
  // PostgREST legitimately returns an empty body for successful
  // POST/PATCH/DELETE operations with Prefer: return=minimal. Calling
  // result.json() on that response throws after the record was saved,
  // preventing the confirmation email from being sent.
  const responseText = await result.text();
  if (!responseText.trim()) return [];
  return JSON.parse(responseText);
}
export async function isEnabled() {
  const data=await db('prelaunch_interest_config','select=enabled&id=eq.true&limit=1');
  return data[0]?.enabled===true;
}
export async function setEnabled(enabled) {
  await db('prelaunch_interest_config','id=eq.true',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({enabled,updated_at:new Date().toISOString()})});
}
export async function sendConfirm(email, firstName, confirmToken) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) throw new Error('Email confirmation is unavailable');

  const origin = 'https://lymphawareid.com';
  const confirmUrl = origin + '/register-interest/confirm/?token=' + encodeURIComponent(confirmToken);
  const privacyUrl = origin + '/privacy/';
  const firstNameSafe = clean(firstName, 80);
  const greeting = firstNameSafe ? 'Hello ' + firstNameSafe + ',' : 'Hello,';
  const subject = 'LymphAware ID – please confirm your interest';
  const text = [
    greeting,
    'Thank you for registering your interest in LymphAware ID.',
    'Created from lived experience, LymphAware ID combines an identification card with a QR-linked digital profile, helping people living with lymphoedema share information they choose and be better understood.',
    'Please confirm that you would like to receive an email when LymphAware ID launches and occasional related service updates:',
    confirmUrl,
    'LymphAware ID is coming soon, although no launch date has been confirmed. Registering your interest is free and does not create a membership or commit you to buying anything.',
    'This confirmation link is valid for 48 hours. If you did not request these updates, you can ignore this message. We will not send launch updates unless you confirm.',
    'You can unsubscribe from future updates at any time. Read our Privacy Notice: ' + privacyUrl,
    'Thank you for your interest and support.',
    'The LymphAware ID Team'
  ].join('\\n\\n');

  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env('CONTACT_NOTIFICATION_FROM') ||
        env('ORDER_NOTIFICATION_FROM') ||
        'LymphAware ID <notifications@lymphawareid.com>',
      to: [email],
      subject,
      text,
      html: brandedEmailHtml({
        title: 'Please confirm your interest',
        preheader: 'One quick step to hear when LymphAware ID launches.',
        text,
        actionUrl: confirmUrl,
        actionLabel: 'Confirm my interest'
      })
    })
  });

  if (!result.ok) {
    console.error('Prelaunch confirmation email failed', result.status);
    throw new Error('Confirmation email could not be delivered');
  }
}
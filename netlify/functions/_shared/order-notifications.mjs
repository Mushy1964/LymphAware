import { brandedEmailHtml } from './email-branding.mjs';
import { buildOrderStatusCommunication, orderReference } from './customer-communication-content.mjs';
function env(name) {
  return String(Netlify.env.get(name) || '').trim();
}

function serviceHeaders(prefer = '') {
  const secret = env('SUPABASE_SECRET_KEY');
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function patchOrder(orderId, values) {
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
    }
  );
  if (!response.ok) throw new Error(`Unable to update order: ${await response.text()}`);
}

async function sendEmail({ to, subject, text }) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey || !to) return { ok: false, error: 'Customer email notification is not configured.' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('ORDER_NOTIFICATION_FROM') || 'LymphAware ID <notifications@lymphawareid.com>',
      to: [to],
      subject,
      text,
      html: brandedEmailHtml({ title: subject, text })
    })
  });
  if (!response.ok) return { ok: false, error: await response.text() };
  const result = await response.json().catch(() => ({}));
  return { ok: true, id: result?.id || null };
}

async function auditedOrderEmail(order, kind) {
  const columns = {
    production: {
      status: 'production_notification_status',
      error: 'production_notification_error',
      sent: 'production_notification_sent_at'
    },
    completion: {
      status: 'completion_notification_status',
      error: 'completion_notification_error',
      sent: 'completion_notification_sent_at'
    }
  }[kind];
  if (!columns) throw new Error('Unknown customer notification type.');
  if (String(order[columns.status] || '').toUpperCase() === 'SENT') return { ok: true, already_sent: true };
  const communication = buildOrderStatusCommunication(order, kind);
  const result = await sendEmail({ to: order.customer_email, subject: communication.subject, text: communication.text });
  await patchOrder(order.id, result.ok
    ? { [columns.status]: 'SENT', [columns.error]: null, [columns.sent]: new Date().toISOString() }
    : { [columns.status]: 'FAILED', [columns.error]: result.error, [columns.sent]: null });
  return result;
}

export async function markLinkedOrdersInProduction(userId, orderId = '') {
  if (!userId && !orderId) return [];
  const filter = orderId
    ? `id=eq.${encodeURIComponent(orderId)}`
    : `user_id=eq.${encodeURIComponent(userId)}`;
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/orders?${filter}&payment_status=eq.PAID&order_status=in.(PAID_AWAITING_PROFILE,READY_TO_PRINT,IN_PRODUCTION)&select=*`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to find linked orders: ${await response.text()}`);
  const orders = await response.json();
  const outcomes = [];
  for (const order of orders) {
    if (order.order_status !== 'IN_PRODUCTION') await patchOrder(order.id, { order_status: 'IN_PRODUCTION' });
    outcomes.push({ order_id: order.id, notification: await auditedOrderEmail(order, 'production') });
  }
  return outcomes;
}

export async function retryFailedOrderCustomerNotification(orderId, kind) {
  if (!['production','completion'].includes(kind)) throw new Error('Unsupported notification type.');
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('Unable to load the order for notification recovery.');
  const order = (await response.json())?.[0];
  if (!order) throw new Error('Order not found.');
  const statusColumn = kind === 'production' ? 'production_notification_status' : 'completion_notification_status';
  if (String(order[statusColumn] || '').toUpperCase() !== 'FAILED') {
    throw new Error('Only a failed customer notification can be retried from Attention Required.');
  }
  return auditedOrderEmail(order, kind);
}

export async function notifyOrderCompleted(orderId) {
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) throw new Error('Unable to load the completed order for notification.');
  const order = (await response.json())?.[0];
  if (!order) throw new Error('Completed order not found.');
  return auditedOrderEmail(order, 'completion');
}

export async function sendLanguageReadyEmail({ languageProfileId, customerEmail, languageName }) {
  const response = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/language_profiles?id=eq.${encodeURIComponent(languageProfileId)}&select=first_ready_notification_status&limit=1`,
    { headers: serviceHeaders() }
  );
  const row = response.ok ? (await response.json())?.[0] : null;
  if (String(row?.first_ready_notification_status || '').toUpperCase() === 'SENT') return { ok: true, already_sent: true };
  const result = await sendEmail({
    to: customerEmail,
    subject: `Your ${languageName} LymphAware ID profile is ready`,
    text:
      `Your ${languageName} LymphAware ID QR profile has been prepared from your English profile and is now ready.\n\n` +
      'Whenever you update your English profile, LymphAware ID will automatically refresh the translated version. Your existing translated profile remains available while an update is being prepared.\n\n' +
      'View your Patient Portal:\nhttps://lymphawareid.com/portal/'
  });
  const patch = await fetch(
    `${env('SUPABASE_URL')}/rest/v1/language_profiles?id=eq.${encodeURIComponent(languageProfileId)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders('return=minimal'),
      body: JSON.stringify(result.ok
        ? { first_ready_notification_status: 'SENT', first_ready_notification_error: null, first_ready_notification_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : { first_ready_notification_status: 'FAILED', first_ready_notification_error: result.error, first_ready_notification_sent_at: null, updated_at: new Date().toISOString() })
    }
  );
  if (!patch.ok) throw new Error('Unable to record the language-ready notification.');
  return result;
}

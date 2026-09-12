import crypto from 'node:crypto';

const INITIAL_PACKAGE_PRICES = {
  STANDARD: { 1: 1999, 2: 2499, 3: 2999, 5: 2999 },
  PLUS: { 1: 2999, 2: 3499, 3: 3999, 5: 3999 },
  MULTILINGUAL: { 1: 3999, 2: 4499, 3: 4999, 5: 4999 }
};

const RENEWAL_PRICES = {
  STANDARD: { 1: 1499, 2: 1899, 3: 2299 },
  PLUS: { 1: 2299, 2: 2699, 3: 2999 },
  MULTILINGUAL: { 1: 2999, 2: 3399, 3: 3799 }
};

const RENEWAL_STRIPE_PRICES = {
  MULTILINGUAL: { 1: 'price_1UEsAyPMYhQKb2OT8Ut5gfFS', 2: 'price_1UEsAzPMYhQKb2OTMNX78xlV', 3: 'price_1UEsB0PMYhQKb2OTucRp4zc3' }
};

function verifyStripeSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(',');
  let timestamp = '';
  const signatures = [];
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const expectedSignature = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  return signatures.some((signature) => {
    try {
      const receivedBuffer = Buffer.from(signature, 'hex');
      return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  });
}

function supabaseHeaders(prefer = '') {
  const headers = {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function stripeRequest(path, method = 'GET', values = null) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(values ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    },
    body: values ? new URLSearchParams(values).toString() : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || 'Stripe request failed');
  return result;
}

async function patchMembershipBySubscription(subscriptionId, values) {
  if (!subscriptionId) return;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Membership renewal update failed: ${await response.text()}`);
}

function invoiceSubscriptionId(invoice) {
  const value = invoice?.subscription || invoice?.parent?.subscription_details?.subscription;
  return typeof value === 'string' ? value : value?.id || null;
}

async function sendRenewalReminder(invoice) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const customerEmail = String(invoice?.customer_email || '').trim();
  if (!apiKey || !customerEmail) return;
  const from = String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware <notifications@lymphaware.com>').trim();
  const amount = `£${(Number(invoice.amount_due || 0) / 100).toFixed(2)}`;
  const renewalDate = invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'the date shown in your Patient Portal';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [customerEmail],
      reply_to: ['admin@lymphaware.com'],
      subject: 'Your LymphAware membership will renew soon',
      text: `Your LymphAware digital membership is due to renew for ${amount} on ${renewalDate}.\n\nThis renewal continues your digital membership only. It does not include new cards, lanyards or postage.\n\nIf you do not want it to renew, cancel automatic renewal before the renewal date in your Patient Portal:\nhttps://lymphaware.com/portal/`
    })
  });
  if (!response.ok) console.error('Unable to send renewal reminder:', await response.text());
}

async function handleRecurringEvent(event) {
  const object = event.data?.object || {};
  if (event.type === 'invoice.upcoming') {
    await sendRenewalReminder(object);
    return true;
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const active = event.type !== 'customer.subscription.deleted' && !object.cancel_at_period_end && !['canceled', 'unpaid', 'incomplete_expired'].includes(object.status);
    await patchMembershipBySubscription(object.id, {
      auto_renew_enabled: active,
      stripe_subscription_status: object.status || (active ? 'active' : 'canceled'),
      next_renewal_at: object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null
    });
    return true;
  }
  if (event.type === 'invoice.payment_failed') {
    await patchMembershipBySubscription(invoiceSubscriptionId(object), { stripe_subscription_status: 'past_due' });
    return true;
  }
  if (event.type === 'invoice.paid') {
    const subscriptionId = invoiceSubscriptionId(object);
    if (!subscriptionId || !['subscription_cycle', 'subscription_update'].includes(object.billing_reason)) return true;
    const periodEnd = object.lines?.data?.map(line => line.period?.end).filter(Boolean).sort((a, b) => b - a)[0];
    await patchMembershipBySubscription(subscriptionId, {
      membership_status: 'ACTIVE',
      payment_status: 'PAID',
      stripe_subscription_status: 'active',
      paid_at: new Date((object.status_transitions?.paid_at || event.created) * 1000).toISOString(),
      ...(periodEnd ? { membership_end: new Date(periodEnd * 1000).toISOString(), next_renewal_at: new Date(periodEnd * 1000).toISOString() } : {})
    });
    return true;
  }
  return false;
}

async function moveRenewalToMultilingual(userId) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&auto_renew_enabled=eq.true&select=id,membership_term_years,stripe_subscription_item_id&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) throw new Error(`Unable to read membership renewal: ${await response.text()}`);
  const membership = (await response.json())?.[0];
  const term = Number(membership?.membership_term_years);
  const price = RENEWAL_STRIPE_PRICES.MULTILINGUAL[term];
  if (!membership?.stripe_subscription_item_id || !price) return;
  await stripeRequest(`subscription_items/${encodeURIComponent(membership.stripe_subscription_item_id)}`, 'POST', {
    price,
    proration_behavior: 'none'
  });
  const update = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships?id=eq.${encodeURIComponent(membership.id)}`, {
    method: 'PATCH',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify({ package_type: 'MULTILINGUAL', renewal_price_pence: RENEWAL_PRICES.MULTILINGUAL[term], updated_at: new Date().toISOString() })
  });
  if (!update.ok) throw new Error(`Unable to update multilingual renewal: ${await update.text()}`);
}

function normaliseItem(item) {
  return {
    item_type: item.item_type,
    description: item.description,
    quantity: item.quantity,
    unit_price_pence: item.unit_price_pence,
    line_total_pence: item.line_total_pence,
    language_code: item.language_code || null,
    language_name: item.language_name || null
  };
}

function parseCardSelectionsMetadata(value, fallbackQuantity = 0) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) throw new Error('Invalid card selections');
    const selections = parsed.map(item => ({
      languageCode: String(item?.[0] || '').trim().toUpperCase(),
      languageName: String(item?.[1] || '').trim(),
      quantity: Number(item?.[2] || 0)
    })).filter(item => item.languageCode && item.languageName && Number.isInteger(item.quantity) && item.quantity > 0);
    if (selections.length) return selections;
  } catch {
    // Older checkout sessions used one unlabelled card quantity, which represented English cards.
  }
  return fallbackQuantity > 0 ? [{ languageCode: 'EN', languageName: 'English', quantity: fallbackQuantity }] : [];
}

async function patchOrder(orderId, values) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
    method: 'PATCH',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  if (!response.ok) console.error('Unable to update LymphAware order:', await response.text());
}

async function sendOrderNotification(order, session, items) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const orderRef = `ORD-${String(order.order_number).padStart(6, '0')}`;
  if (!apiKey) {
    const error = 'RESEND_API_KEY is not configured.';
    await patchOrder(order.id, { notification_status: 'FAILED', notification_error: error, notification_sent_at: null });
    return { ok: false, error };
  }

  const to = String(process.env.ORDER_NOTIFICATION_EMAIL || 'admin@lymphaware.com').trim();
  const from = String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware <notifications@lymphaware.com>').trim();
  const itemLines = items.map((item) => {
    const language = item.language_name ? ` – ${item.language_name}` : '';
    return `${item.quantity} × ${item.description}${language}`;
  }).join('\n');
  const customerName = session.customer_details?.name || session.customer_email || 'Customer';
  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const totalPaid = `£${((session.amount_total || 0) / 100).toFixed(2)}`;
  const postageChargePence = Number(session.metadata?.shipping_pence || session.total_details?.amount_shipping || 0);
  const postagePaid = `£${(postageChargePence / 100).toFixed(2)}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: ['admin@lymphaware.com'],
        subject: `New LymphAware order – ${orderRef}`,
        text:
          `A new LymphAware order has been paid and requires attention.\n\n` +
          `Order: ${orderRef}\nCustomer: ${customerName}\nEmail: ${customerEmail}\nPostage & packing (before any promotion discount): ${postagePaid}\nTotal paid: ${totalPaid}\n\n` +
          `Items:\n${itemLines || 'No item detail recorded'}\n\n` +
          `Open LymphAware Administration to manage fulfilment:\nhttps://lymphaware.com/admin/orders/`
      })
    });
    if (!response.ok) {
      const error = await response.text();
      await patchOrder(order.id, { notification_status: 'FAILED', notification_error: error, notification_sent_at: null });
      return { ok: false, error };
    }
    const result = await response.json();
    await patchOrder(order.id, { notification_status: 'SENT', notification_error: null, notification_sent_at: new Date().toISOString() });
    return { ok: true, id: result?.id || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchOrder(order.id, { notification_status: 'FAILED', notification_error: message, notification_sent_at: null });
    return { ok: false, error: message };
  }
}

async function sendCustomerConfirmation(order, session, items, paymentType, languageName) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const customerEmail = String(session.customer_details?.email || session.customer_email || '').trim();
  if (!apiKey || !customerEmail) return { ok: false, error: 'Customer email notification is not configured.' };

  const from = String(process.env.ORDER_NOTIFICATION_FROM || 'LymphAware <notifications@lymphaware.com>').trim();
  const orderRef = `ORD-${String(order.order_number).padStart(6, '0')}`;
  const itemLines = items.map((item) => `• ${item.quantity} × ${item.description}${item.language_name ? ` – ${item.language_name}` : ''}`).join('\n');
  const postageChargePence = Number(session.metadata?.shipping_pence || session.total_details?.amount_shipping || 0);
  const postagePaid = `£${(postageChargePence / 100).toFixed(2)}`;
  const totalPaid = `£${((session.amount_total || 0) / 100).toFixed(2)}`;
  const membershipTermYears = [1, 2, 3, 5].includes(Number(session.metadata?.membership_term_years))
    ? Number(session.metadata.membership_term_years)
    : 5;
  let subject = `Your LymphAware order is confirmed – ${orderRef}`;
  let nextSteps =
    `Your order has been received. We will use the current name and photograph in your LymphAware profile for any ID card included in this order.\n\n` +
    `You can review your profile and delivery progress from your Patient Portal:\nhttps://lymphaware.com/portal/`;

  if (paymentType === 'initial_membership') {
    subject = `Welcome to LymphAware – your membership is now active`;
    nextSteps =
      `Your ${membershipTermYears}-year LymphAware membership is now active.\n\n` +
      `WHAT YOU NEED TO DO NEXT\n\n` +
      `Before your LymphAware ID card can be produced, please complete these two mandatory details in your Patient Portal:\n\n` +
      `1. Your display name – this is the name that will appear on your LymphAware ID card and QR profile.\n` +
      `2. A clear, recent photograph – this will appear on your ID card and at the top of your QR profile.\n\n` +
      `Both details are required before your card can enter production.\n\n` +
      `The remaining QR profile sections are optional and can be completed now or at any time that suits you. You can add as much or as little information as you wish. If you leave a section empty, it will still appear when your QR code is scanned and will state that no information has been added to that section.\n\n` +
      `Once you save your display name and photograph, LymphAware will be notified automatically that your card details are ready. We will then begin preparing your ID card, lanyard and holder, together with any additional cards or language versions included in your order.\n\n` +
      `We aim to prepare and dispatch your order within 7–10 working days after your required card details have been completed. Delivery time after dispatch will depend on the postal service and destination.\n\n` +
      `You can continue to update your QR profile at any time, including after your physical card has been produced.\n\n` +
      `Complete your profile:\nhttps://lymphaware.com/profile/`;
    if (languageName) {
      nextSteps +=
        `\n\nYour package includes a ${languageName} profile and card. Keep your main English profile accurate and LymphAware will automatically prepare the ${languageName} version from it and keep it updated when your English information changes. You do not need to translate anything yourself. Empty English sections will also remain empty in the translated profile.`;
    }
    if (String(session.metadata?.auto_renew || '') === '1') {
      const renewalPence = Number(session.metadata?.renewal_price_pence || 0);
      nextSteps += `\n\nAUTOMATIC RENEWAL\n\nYou chose automatic renewal. At the end of this ${membershipTermYears}-year term, your digital membership will renew for £${(renewalPence / 100).toFixed(2)} for another ${membershipTermYears} year${membershipTermYears === 1 ? '' : 's'}. No new cards, lanyards or postage are included. You can cancel automatic renewal from your Patient Portal before the renewal date.`;
    }
  } else if (paymentType === 'additional_items') {
    subject = `Your LymphAware additional order is confirmed – ${orderRef}`;
    if (languageName) {
      nextSteps +=
        `\n\nYour order includes a ${languageName} language package. You do not need to translate your profile yourself. LymphAware will prepare the ${languageName} version from your main English profile and automatically keep it updated when your English profile changes. Any English sections left empty will also be empty in the translated profile.`;
    }
  } else if (paymentType === 'additional_language') {
    subject = `Your ${languageName || 'additional-language'} LymphAware package is confirmed`;
    nextSteps =
      `You do not need to translate your profile yourself. LymphAware will prepare the ${languageName || 'selected-language'} version for you from the information in your main English profile and automatically keep it updated when your English profile changes.\n\n` +
      `Please make sure your main English profile is accurate and complete. Any English sections left empty will also be empty in the translated profile.\n\n` +
      `Review your main profile:\nhttps://lymphaware.com/profile/`;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `lymphaware-customer-${session.id}`
      },
      body: JSON.stringify({
        from,
        to: [customerEmail],
        reply_to: ['admin@lymphaware.com'],
        subject,
        text:
          `Thank you for your LymphAware purchase.\n\nOrder: ${orderRef}\n\nItems:\n${itemLines || 'Your selected LymphAware package'}\n\nPostage & packing (before any promotion discount): ${postagePaid}\nTotal paid: ${totalPaid}\n\n` +
          `${nextSteps}\n\nIf you need help, contact admin@lymphaware.com.\n\nThe LymphAware Team`
      })
    });
    if (!response.ok) return { ok: false, error: await response.text() };
    const result = await response.json();
    return { ok: true, id: result?.id || null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getExistingOrder(sessionId) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/orders?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

async function ensureOrderItems(orderId, items) {
  const existingResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/order_items?order_id=eq.${orderId}&select=item_type,language_name`,
    { headers: supabaseHeaders() }
  );
  if (!existingResponse.ok) return { ok: false, error: await existingResponse.text() };
  const existing = await existingResponse.json();
  const existingKeys = new Set(existing.map((item) => `${item.item_type}|${item.language_name || ''}`));
  const missing = items.map(normaliseItem)
    .filter((item) => !existingKeys.has(`${item.item_type}|${item.language_name || ''}`))
    .map((item) => ({ ...item, order_id: orderId }));
  if (!missing.length) return { ok: true };
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/order_items`, {
    method: 'POST',
    headers: supabaseHeaders('return=minimal'),
    body: JSON.stringify(missing)
  });
  if (!response.ok) return { ok: false, error: await response.text() };
  return { ok: true };
}

function buildInitialItems(packageType, languageCode, languageName, membershipTermYears, packagePricePence) {
  const termLabel = `${membershipTermYears}-Year`;
  if (packageType === 'PLUS') {
    return [
      normaliseItem({ item_type: 'MEMBERSHIP', description: `LymphAware ${termLabel} Plus`, quantity: 1, unit_price_pence: packagePricePence, line_total_pence: packagePricePence }),
      normaliseItem({ item_type: 'EXTRA_CARD', description: 'Additional English ID Card – included in Plus package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 }),
      normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Additional Lanyard & Holder – included in Plus package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 })
    ];
  }
  if (packageType === 'MULTILINGUAL') {
    return [
      normaliseItem({ item_type: 'MEMBERSHIP', description: `LymphAware ${termLabel} Multilingual`, quantity: 1, unit_price_pence: packagePricePence, line_total_pence: packagePricePence }),
      normaliseItem({ item_type: 'EXTRA_CARD', description: 'Second English ID Card – included in Multilingual package', quantity: 1, unit_price_pence: 0, line_total_pence: 0 }),
      normaliseItem({ item_type: 'LANGUAGE_PACKAGE', description: 'Multilingual translated ID Cards & QR Profile', quantity: 2, unit_price_pence: 0, line_total_pence: 0, language_code: languageCode, language_name: languageName }),
      normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Translated-language Lanyard & Holder – included in Multilingual package', quantity: 1, unit_price_pence: 0, line_total_pence: 0, language_code: languageCode, language_name: languageName })
    ];
  }
  return [normaliseItem({ item_type: 'MEMBERSHIP', description: `LymphAware ${termLabel} Membership`, quantity: 1, unit_price_pence: packagePricePence, line_total_pence: packagePricePence })];
}

function buildAdditionalLanguageItems(languageCode, languageName) {
  return [
    normaliseItem({ item_type: 'LANGUAGE_PACKAGE', description: 'Additional Language Package', quantity: 1, unit_price_pence: 1999, line_total_pence: 1999, language_code: languageCode, language_name: languageName }),
    normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Lanyard & Holder – included in Additional Language Package', quantity: 1, unit_price_pence: 0, line_total_pence: 0, language_code: languageCode, language_name: languageName })
  ];
}

function buildReplacementItems(cardSelected, lanyardSelected) {
  const items = [];
  if (cardSelected) {
    items.push(normaliseItem({ item_type: 'EXTRA_CARD', description: 'Replacement LymphAware ID Card', quantity: 1, unit_price_pence: 650, line_total_pence: 650 }));
  }
  if (lanyardSelected) {
    items.push(normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Replacement Lanyard & Holder', quantity: 1, unit_price_pence: 650, line_total_pence: 650 }));
  }
  return items;
}

function buildAdditionalPurchaseItems(cardSelections, lanyardQuantity, languageCode, languageName) {
  const items = [];
  for (const selection of cardSelections) {
    items.push(normaliseItem({
      item_type: 'EXTRA_CARD',
      description: 'Additional or Replacement LymphAware ID Card',
      quantity: selection.quantity,
      unit_price_pence: 650,
      line_total_pence: selection.quantity * 650,
      language_code: selection.languageCode,
      language_name: selection.languageName
    }));
  }
  if (lanyardQuantity > 0) {
    items.push(normaliseItem({ item_type: 'LANYARD_HOLDER', description: 'Additional or Replacement Lanyard & Holder', quantity: lanyardQuantity, unit_price_pence: 650, line_total_pence: lanyardQuantity * 650 }));
  }
  if (languageName) items.push(...buildAdditionalLanguageItems(languageCode, languageName));
  return items;
}

async function recordLanguageTranslationConsent(orderId, consentAt) {
  if (!consentAt) return;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/language_profiles?order_id=eq.${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders('return=minimal'),
      body: JSON.stringify({ translation_consent_at: consentAt, updated_at: consentAt })
    }
  );
  if (!response.ok) console.error('Unable to record language translation consent:', await response.text());
}

async function reopenPrimaryCardForReplacement(userId) {
  const profileResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=id,display_name,photo_path,qr_token,qr_profile_active&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!profileResponse.ok) return;
  const rows = await profileResponse.json();
  const profile = rows?.[0];
  if (!profile?.id || !profile.display_name?.trim() || !profile.photo_path?.trim() || !profile.qr_token || profile.qr_profile_active !== true) return;

  const now = new Date().toISOString();
  const updateResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders('return=minimal'),
      body: JSON.stringify({
        card_production_status: 'READY',
        card_ready_at: now,
        card_prepared_at: null,
        card_printed_at: null,
        updated_at: now
      })
    }
  );
  if (!updateResponse.ok) console.error('Unable to reopen replacement card job:', await updateResponse.text());
}

async function reopenLanguageCardsForReplacement(userId, cardSelections) {
  const now = new Date().toISOString();
  for (const selection of cardSelections.filter(item => item.languageCode !== 'EN')) {
    const updateResponse = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/language_profiles?user_id=eq.${encodeURIComponent(userId)}&language_code=eq.${encodeURIComponent(selection.languageCode)}&qr_profile_active=eq.true`,
      {
        method: 'PATCH',
        headers: supabaseHeaders('return=minimal'),
        body: JSON.stringify({
          card_production_status: 'READY',
          card_ready_at: now,
          card_prepared_at: null,
          card_printed_at: null,
          updated_at: now
        })
      }
    );
    if (!updateResponse.ok) console.error(`Unable to reopen ${selection.languageName} replacement card job:`, await updateResponse.text());
  }
}

export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const payload = await request.text();
    const stripeSignature = request.headers.get('stripe-signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!verifyStripeSignature(payload, stripeSignature, webhookSecret)) return new Response('Invalid signature', { status: 400 });

    const event = JSON.parse(payload);
    if (await handleRecurringEvent(event)) {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (event.type !== 'checkout.session.completed') {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const session = event.data?.object;
    const userId = session?.metadata?.lymphaware_user_id;
    const membershipId = session?.metadata?.membership_id || null;
    const paymentType = String(session?.metadata?.payment_type || '').trim();
    if (!userId || !['initial_membership', 'additional_language', 'replacement_items', 'additional_items'].includes(paymentType)) {
      return new Response('Invalid payment metadata', { status: 400 });
    }

    const completedPayment = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
    if (!completedPayment) {
      return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const paidAt = new Date();
    const packageType = String(session.metadata?.package_type || 'STANDARD').trim().toUpperCase();
    const membershipTermYears = [1, 2, 3, 5].includes(Number(session.metadata?.membership_term_years))
      ? Number(session.metadata.membership_term_years)
      : 5;
    const packagePricePence = INITIAL_PACKAGE_PRICES[packageType]?.[membershipTermYears];
    if (paymentType === 'initial_membership' && !packagePricePence) return new Response('Invalid membership package metadata', { status: 400 });
    const languageName = String(session.metadata?.language_name || '').trim();
    const languageCode = String(session.metadata?.language_code || '').trim().toUpperCase();
    const replacementCard = String(session.metadata?.replacement_card || '') === '1';
    const replacementLanyard = String(session.metadata?.replacement_lanyard || '') === '1';
    const metadataCardQuantity = Number(session.metadata?.card_quantity || 0);
    const metadataLanyardQuantity = Number(session.metadata?.lanyard_quantity || 0);
    const cardQuantity = Number.isInteger(metadataCardQuantity) && metadataCardQuantity >= 0 ? metadataCardQuantity : (replacementCard ? 1 : 0);
    const cardSelections = parseCardSelectionsMetadata(session.metadata?.card_selections, cardQuantity);
    const lanyardQuantity = Number.isInteger(metadataLanyardQuantity) && metadataLanyardQuantity >= 0 ? metadataLanyardQuantity : (replacementLanyard ? 1 : 0);
    const translationConsent = String(session.metadata?.translation_consent || '') === '1';
    const autoRenew = String(session.metadata?.auto_renew || '') === '1' && typeof session.subscription === 'string';
    const renewalPricePence = autoRenew ? Number(session.metadata?.renewal_price_pence || RENEWAL_PRICES[packageType]?.[membershipTermYears] || 0) : null;

    if (paymentType === 'initial_membership') {
      const membershipEnd = new Date(paidAt);
      membershipEnd.setUTCFullYear(membershipEnd.getUTCFullYear() + membershipTermYears);
      let subscription = null;
      if (autoRenew) subscription = await stripeRequest(`subscriptions/${encodeURIComponent(session.subscription)}`);
      const membershipResponse = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: supabaseHeaders('return=minimal'),
          body: JSON.stringify({
            membership_status: 'ACTIVE', payment_status: 'PAID', payment_provider: 'STRIPE', payment_reference: session.id,
            paid_at: paidAt.toISOString(), membership_start: paidAt.toISOString(), membership_end: membershipEnd.toISOString(), initial_fee_pence: packagePricePence,
            package_type: packageType, membership_term_years: membershipTermYears, auto_renew_enabled: autoRenew,
            renewal_price_pence: renewalPricePence,
            stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
            stripe_subscription_id: autoRenew ? session.subscription : null,
            stripe_subscription_item_id: subscription?.items?.data?.[0]?.id || null,
            stripe_subscription_status: subscription?.status || null,
            next_renewal_at: subscription?.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : (autoRenew ? membershipEnd.toISOString() : null),
            updated_at: paidAt.toISOString()
          })
        }
      );
      if (!membershipResponse.ok) {
        console.error('Unable to update LymphAware membership:', await membershipResponse.text());
        return new Response('Membership update failed', { status: 500 });
      }
    }

    const items = paymentType === 'initial_membership'
      ? buildInitialItems(packageType, languageCode, languageName, membershipTermYears, packagePricePence)
      : paymentType === 'additional_language'
        ? buildAdditionalLanguageItems(languageCode, languageName)
        : paymentType === 'additional_items'
          ? buildAdditionalPurchaseItems(cardSelections, lanyardQuantity, languageCode, languageName)
          : buildReplacementItems(replacementCard, replacementLanyard);

    const expectedSubtotal = items.reduce((sum, item) => sum + item.line_total_pence, 0);
    const shipping = session.collected_information?.shipping_details || session.shipping_details || null;
    const address = shipping?.address || session.customer_details?.address || {};
    const deliveryName = shipping?.name || session.customer_details?.name || null;
    const orderType = paymentType === 'initial_membership'
      ? 'INITIAL_MEMBERSHIP'
      : paymentType === 'additional_language' || (paymentType === 'additional_items' && languageName && !cardQuantity && !lanyardQuantity)
        ? 'LANGUAGE_PACKAGE'
        : 'REPLACEMENT';

    const orderPayload = {
      user_id: userId,
      membership_id: membershipId,
      order_type: orderType,
      order_status: 'PAID_AWAITING_PROFILE',
      payment_status: 'PAID',
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      customer_email: session.customer_details?.email || session.customer_email || null,
      delivery_name: deliveryName,
      delivery_line1: address.line1 || null,
      delivery_line2: address.line2 || null,
      delivery_city: address.city || null,
      delivery_county: address.state || null,
      delivery_postcode: address.postal_code || null,
      delivery_country: address.country || null,
      subtotal_pence: session.amount_subtotal ?? expectedSubtotal,
      discount_pence: session.total_details?.amount_discount || 0,
      total_pence: session.amount_total ?? expectedSubtotal,
      currency: session.currency || 'gbp',
      paid_at: paidAt.toISOString(),
      translation_consent_at: translationConsent ? paidAt.toISOString() : null,
      updated_at: paidAt.toISOString()
    };

    let order = null;
    const orderResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: supabaseHeaders('return=representation'),
      body: JSON.stringify(orderPayload)
    });
    if (orderResponse.ok) {
      const createdOrders = await orderResponse.json();
      order = createdOrders?.[0] || null;
    } else {
      const errorText = await orderResponse.text();
      if (!errorText.includes('duplicate key')) {
        console.error('Unable to create LymphAware order:', errorText);
        return new Response('Order creation failed', { status: 500 });
      }
      order = await getExistingOrder(session.id);
    }
    if (!order?.id) return new Response('Order could not be resolved', { status: 500 });

    const itemResult = await ensureOrderItems(order.id, items);
    if (!itemResult.ok) {
      console.error('Unable to create LymphAware order items:', itemResult.error);
      return new Response('Order item creation failed', { status: 500 });
    }

    if (translationConsent && (paymentType === 'initial_membership' || paymentType === 'additional_language' || paymentType === 'additional_items')) {
      await recordLanguageTranslationConsent(order.id, paidAt.toISOString());
      if (paymentType === 'additional_language' || paymentType === 'additional_items') await moveRenewalToMultilingual(userId);
    }

    if ((paymentType === 'replacement_items' && replacementCard) || (paymentType === 'additional_items' && cardSelections.some(item => item.languageCode === 'EN'))) {
      await reopenPrimaryCardForReplacement(userId);
    }
    if (paymentType === 'additional_items') {
      await reopenLanguageCardsForReplacement(userId, cardSelections);
    }

    if (order.notification_status !== 'SENT') await sendOrderNotification(order, session, items);
    if (order.customer_confirmation_status !== 'SENT') {
      const customerNotification = await sendCustomerConfirmation(order, session, items, paymentType, languageName);
      await patchOrder(order.id, customerNotification.ok
        ? { customer_confirmation_status: 'SENT', customer_confirmation_error: null, customer_confirmation_sent_at: new Date().toISOString() }
        : { customer_confirmation_status: 'FAILED', customer_confirmation_error: customerNotification.error, customer_confirmation_sent_at: null });
      if (!customerNotification.ok) console.error('Unable to send customer order confirmation:', customerNotification.error);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return new Response('Webhook processing failed', { status: 500 });
  }
};

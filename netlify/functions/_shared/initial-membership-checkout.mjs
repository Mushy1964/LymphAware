export { MEMBERSHIP_CONTRACT_VERSION, FIRST_REMINDER_WINDOW, FINAL_REMINDER_WINDOW } from './membership-contract.mjs';
import { MEMBERSHIP_CONTRACT_VERSION, FIRST_REMINDER_WINDOW, FINAL_REMINDER_WINDOW } from './membership-contract.mjs';

export const APPROVED_LANGUAGES = {
  FR: 'French',
  ES: 'Spanish',
  DE: 'German'
};

export const PACKAGE_DEFINITIONS = {
  STANDARD: {
    name: 'LymphAware Membership',
    prices: { 1: 1999, 2: 2499, 3: 2999 },
    renewals: { 1: 1499, 2: 1899, 3: 2299 },
    stripePrices: { 1: 'price_1UEoS1PMYhQKb2OTJ1muyO9G', 2: 'price_1UEoSFPMYhQKb2OTUjWipeEt', 3: 'price_1UEoSGPMYhQKb2OTTiL95BYd' }
  },
  PLUS: {
    name: 'LymphAware Plus',
    prices: { 1: 2999, 2: 3499, 3: 3999 },
    renewals: { 1: 2299, 2: 2699, 3: 2999 },
    stripePrices: { 1: 'price_1UEoS2PMYhQKb2OT04lGzolV', 2: 'price_1UEoSGPMYhQKb2OTUgrnaFEu', 3: 'price_1UEoSHPMYhQKb2OTOOSq3K1Z' }
  },
  MULTILINGUAL: {
    name: 'LymphAware Multilingual',
    prices: { 1: 3999, 2: 4499, 3: 4999 },
    renewals: { 1: 2999, 2: 3399, 3: 3799 },
    stripePrices: { 1: 'price_1UEsAyPMYhQKb2OT8Ut5gfFS', 2: 'price_1UEsAzPMYhQKb2OTMNX78xlV', 3: 'price_1UEsB0PMYhQKb2OTucRp4zc3' }
  }
};

const EUROPE_COUNTRIES = new Set([
  'AL','AD','AT','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT',
  'XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','SM','RS','SK','SI',
  'ES','SE','CH','UA','VA'
]);

const CHECKOUT_COUNTRIES = new Set([
  'GB','IE','FR','ES','PT','DE','NL','BE','LU','IT','AT','DK','SE','NO','FI','CH','US','CA','AU','NZ',
  'CY','MT','GR','PL','CZ','SK','SI','HR','HU','RO','BG','EE','LV','LT','IS','AL','AD','BA','MD','MC',
  'ME','MK','RS','UA','AE','ZA','IN','JP','SG','HK'
]);

export function normaliseInitialSelection(body = {}) {
  const packageType = String(body.packageType || '').trim().toUpperCase();
  const packageDefinition = PACKAGE_DEFINITIONS[packageType];
  const membershipTermYears = Number(body.membershipTermYears);
  const deliveryCountry = String(body.deliveryCountry || '').trim().toUpperCase();
  const languageCode = String(body.languageCode || '').trim().toUpperCase();
  const languageName = APPROVED_LANGUAGES[languageCode] || '';
  const autoRenew = body.autoRenew === true;

  if (!packageDefinition) throw new Error('Please select a LymphAware membership package.');
  if (![1, 2, 3].includes(membershipTermYears)) throw new Error('Please select a membership length.');
  if (!CHECKOUT_COUNTRIES.has(deliveryCountry)) throw new Error('Please select a supported delivery country.');
  if (packageType === 'MULTILINGUAL' && !languageName) throw new Error('Please select an additional language.');
  if (packageType === 'MULTILINGUAL' && body.translationConsent !== true) throw new Error('Please confirm the translation agreement.');
  if (body.termsAccepted !== true) throw new Error('Please accept the Terms and Privacy Notice.');
  if (autoRenew && body.autoRenewAcknowledged !== true) throw new Error('Please confirm the automatic-renewal details.');

  const shippingBand = deliveryCountry === 'GB' ? 'UK' : EUROPE_COUNTRIES.has(deliveryCountry) ? 'EUROPE' : 'REST_OF_WORLD';
  const shippingPence = shippingBand === 'UK' ? 299 : shippingBand === 'EUROPE' ? 499 : 999;
  const packagePricePence = packageDefinition.prices[membershipTermYears];
  const renewalPricePence = packageDefinition.renewals[membershipTermYears];
  return {
    packageType,
    packageDefinition,
    membershipTermYears,
    deliveryCountry,
    shippingBand,
    shippingPence,
    packagePricePence,
    renewalPricePence,
    renewalStripePrice: packageDefinition.stripePrices[membershipTermYears],
    languageCode: packageType === 'MULTILINGUAL' ? languageCode : '',
    languageName: packageType === 'MULTILINGUAL' ? languageName : '',
    translationConsent: packageType === 'MULTILINGUAL',
    autoRenew
  };
}

function appendInlinePrice(form, index, name, amountPence, description = '') {
  form.append(`line_items[${index}][price_data][currency]`, 'gbp');
  form.append(`line_items[${index}][price_data][unit_amount]`, String(amountPence));
  form.append(`line_items[${index}][price_data][product_data][name]`, name);
  if (description) form.append(`line_items[${index}][price_data][product_data][description]`, description);
  form.append(`line_items[${index}][quantity]`, '1');
}

function packageDescription(selection) {
  const { packageType, membershipTermYears, languageName } = selection;
  if (packageType === 'MULTILINGUAL') return `${membershipTermYears}-year membership with English and ${languageName} profiles, 2 English cards, 2 ${languageName} cards and 2 lanyards & holders.`;
  if (packageType === 'PLUS') return `${membershipTermYears}-year membership with 2 English ID cards and 2 lanyards & holders.`;
  return `${membershipTermYears}-year membership with 1 English ID card and 1 lanyard & holder.`;
}

export async function createInitialMembershipCheckout({ userId, email, membershipId, selection }) {
  const form = new URLSearchParams();
  const checkoutName = `${selection.packageDefinition.name} – ${selection.membershipTermYears}-Year`;
  form.append('mode', selection.autoRenew ? 'subscription' : 'payment');

  let shippingIndex = 1;
  if (selection.autoRenew) {
    form.append('line_items[0][price]', selection.renewalStripePrice);
    form.append('line_items[0][quantity]', '1');
    const joiningPence = selection.packagePricePence - selection.renewalPricePence;
    if (joiningPence > 0) {
      appendInlinePrice(form, 1, `${checkoutName} – joining and card fulfilment`, joiningPence, 'One-time joining, card and lanyard fulfilment charge.');
      shippingIndex = 2;
    }
    form.append('payment_method_collection', 'always');
  } else {
    appendInlinePrice(form, 0, checkoutName, selection.packagePricePence, packageDescription(selection));
  }

  const shippingLabel = selection.shippingBand === 'UK' ? 'UK postage & packing' : selection.shippingBand === 'EUROPE' ? 'Europe postage & packing' : 'Rest of World postage & packing';
  appendInlinePrice(form, shippingIndex, shippingLabel, selection.shippingPence, 'Postage & packing for this LymphAware order.');

  form.append('allow_promotion_codes', 'true');
  form.append('billing_address_collection', 'required');
  form.append('shipping_address_collection[allowed_countries][0]', selection.deliveryCountry);
  form.append('client_reference_id', userId);
  form.append('customer_email', email);
  form.append('success_url', 'https://lymphaware.com/register/confirmation/?payment=success');
  form.append('cancel_url', 'https://lymphaware.com/register/payment-not-completed/');

  const metadata = {
    lymphaware_user_id: userId,
    membership_id: membershipId,
    payment_type: 'initial_membership',
    package_type: selection.packageType,
    membership_term_years: String(selection.membershipTermYears),
    package_price_pence: String(selection.packagePricePence),
    auto_renew: selection.autoRenew ? '1' : '0',
    renewal_price_pence: String(selection.renewalPricePence),
    language_code: selection.languageCode,
    language_name: selection.languageName,
    translation_consent: selection.translationConsent ? '1' : '0',
    replacement_card: '0',
    replacement_lanyard: '0',
    card_quantity: '0',
    card_selections: '[]',
    lanyard_quantity: '0',
    delivery_country_selected: selection.deliveryCountry,
    shipping_band: selection.shippingBand,
    shipping_pence: String(selection.shippingPence),
    shipping_charge_method: 'LINE_ITEM',
    contract_version: MEMBERSHIP_CONTRACT_VERSION,
    first_reminder_window: FIRST_REMINDER_WINDOW,
    final_reminder_window: FINAL_REMINDER_WINDOW,
    initial_cooling_off_days: '14',
    renewal_cooling_off_days: selection.autoRenew ? '14' : '0'
  };
  for (const [key, value] of Object.entries(metadata)) form.append(`metadata[${key}]`, value);
  if (selection.autoRenew) {
    for (const key of ['lymphaware_user_id','membership_id','package_type','membership_term_years','renewal_price_pence','contract_version']) {
      form.append(`subscription_data[metadata][${key}]`, metadata[key]);
    }
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2026-07-29.dahlia'
    },
    body: form.toString()
  });
  const session = await response.json();
  if (!response.ok || !session?.url) throw new Error(session?.error?.message || 'Unable to create the secure payment page.');
  return session;
}

export function contractSnapshot(selection) {
  return {
    version: MEMBERSHIP_CONTRACT_VERSION,
    package_type: selection.packageType,
    membership_term_years: selection.membershipTermYears,
    initial_package_price_pence: selection.packagePricePence,
    postage_pence: selection.shippingPence,
    auto_renew_selected: selection.autoRenew,
    renewal_price_pence: selection.autoRenew ? selection.renewalPricePence : null,
    renewal_frequency_years: selection.autoRenew ? selection.membershipTermYears : null,
    first_reminder_window: selection.autoRenew ? FIRST_REMINDER_WINDOW : null,
    final_reminder_window: selection.autoRenew ? FINAL_REMINDER_WINDOW : null,
    cancellation_method: 'Patient Portal or admin@lymphaware.com',
    initial_cooling_off_days: 14,
    renewal_cooling_off_days: selection.autoRenew ? 14 : null,
    renewal_scope: selection.autoRenew ? 'Digital membership only; no physical cards, lanyards, holders or postage.' : null
  };
}

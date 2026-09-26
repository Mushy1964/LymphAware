import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', '.netlify']);
const errors = [];
const warnings = [];
let standaloneScriptCount = 0;
let htmlFileCount = 0;
let inlineScriptCount = 0;

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function nodeCheck(file, label = relative(file)) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    errors.push(`${label}: ${String(result.stderr || result.stdout || 'JavaScript syntax check failed').trim()}`);
  }
}

function checkStandaloneScript(file) {
  standaloneScriptCount += 1;
  nodeCheck(file);
}

function checkInlineScripts(file, html) {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptNumber = 0;

  while ((match = scriptPattern.exec(html))) {
    const attributes = match[1] || '';
    const script = match[2] || '';
    if (/\bsrc\s*=\s*["']/i.test(attributes)) continue;

    const typeMatch = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const type = String(typeMatch?.[1] || 'text/javascript').toLowerCase();
    if (type.includes('json') || (!type.includes('javascript') && type !== 'module' && type !== 'text/ecmascript')) continue;
    if (!script.trim()) continue;

    scriptNumber += 1;
    inlineScriptCount += 1;
    const extension = type === 'module' ? '.mjs' : '.js';
    const temporaryFile = path.join(os.tmpdir(), `lymphaware-audit-${process.pid}-${htmlFileCount}-${scriptNumber}${extension}`);
    fs.writeFileSync(temporaryFile, script, 'utf8');
    nodeCheck(temporaryFile, `${relative(file)} inline script ${scriptNumber}`);
    fs.rmSync(temporaryFile, { force: true });
  }
}

function checkDuplicateIds(file, html) {
  const ids = new Map();
  const idPattern = /\bid\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = idPattern.exec(html))) {
    const id = match[1];
    // IDs generated inside JavaScript template strings are repeated in source by design,
    // but resolve to unique record IDs at runtime. Static literal IDs must still be unique.
    if (id.includes('${')) continue;
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  for (const [id, count] of ids) {
    if (count > 1) errors.push(`${relative(file)}: duplicate id="${id}" appears ${count} times.`);
  }
}

function checkHtml(file) {
  htmlFileCount += 1;
  const html = fs.readFileSync(file, 'utf8');
  checkInlineScripts(file, html);
  checkDuplicateIds(file, html);
}

function checkProjectConsistency() {
  const checkoutPath = path.join(root, 'netlify/functions/create-checkout-session.mjs');
  const portalPath = path.join(root, 'portal/index.html');
  const translationPath = path.join(root, 'netlify/functions/refresh-language-translations-background.mjs');
  const publicProfilePath = path.join(root, 'p-v3/index.html');
  const homePath = path.join(root, 'index.html');
  const webhookPath = path.join(root, 'netlify/functions/stripe-webhook.mjs');
  const registerPath = path.join(root, 'register/index.html');
  const registrationAccessPath = path.join(root, 'netlify/functions/_shared/registration-access.mjs');
  const startMembershipCheckoutPath = path.join(root, 'netlify/functions/start-membership-checkout.mjs');
  const initialMembershipCheckoutPath = path.join(root, 'netlify/functions/_shared/initial-membership-checkout.mjs');
  const adminOrdersPath = path.join(root, 'netlify/functions/admin-orders-list.mjs');
  const adminDashboardPath = path.join(root, 'admin/index.html');
  const adminOrderDetailPath = path.join(root, 'admin/orders/index.html');
  const signInPath = path.join(root, 'sign-in/index.html');
  const stylesPath = path.join(root, 'css/styles.css');
  const homeStylesPath = path.join(root, 'css/home.css');
  const publicChromePath = path.join(root, 'css/public-chrome.css');
  const profilePath = path.join(root, 'profile-v2/index.html');
  const understandingPath = path.join(root, 'understanding-lymphoedema/index.html');

  const checkout = fs.readFileSync(checkoutPath, 'utf8');
  const portal = fs.readFileSync(portalPath, 'utf8');
  const translation = fs.readFileSync(translationPath, 'utf8');
  const publicProfile = fs.readFileSync(publicProfilePath, 'utf8');
  const home = fs.readFileSync(homePath, 'utf8');
  const webhook = fs.readFileSync(webhookPath, 'utf8');
  const register = fs.readFileSync(registerPath, 'utf8');
  const registrationAccess = fs.readFileSync(registrationAccessPath, 'utf8');
  const startMembershipCheckout = fs.readFileSync(startMembershipCheckoutPath, 'utf8');
  const initialMembershipCheckout = fs.readFileSync(initialMembershipCheckoutPath, 'utf8');
  const adminOrders = fs.readFileSync(adminOrdersPath, 'utf8');
  const adminDashboard = fs.readFileSync(adminDashboardPath, 'utf8');
  const adminOrderDetail = fs.readFileSync(adminOrderDetailPath, 'utf8');
  const signIn = fs.readFileSync(signInPath, 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const homeStyles = fs.readFileSync(homeStylesPath, 'utf8');
  const publicChrome = fs.readFileSync(publicChromePath, 'utf8');
  const profile = fs.readFileSync(profilePath, 'utf8');
  const understanding = fs.readFileSync(understandingPath, 'utf8');

  for (const [code, name] of [['FR', 'French'], ['ES', 'Spanish'], ['DE', 'German']]) {
    if (!checkout.includes(`${code}: '${name}'`)) errors.push(`Checkout language configuration is missing ${name} (${code}).`);
    if (!portal.includes(`${code}:'${name}'`) && !portal.includes(`${code}: '${name}'`)) errors.push(`Portal language configuration is missing ${name} (${code}).`);
    if (!translation.includes(`${code}: '${name}'`)) errors.push(`Translation worker is missing ${name} (${code}).`);
    if (!publicProfile.includes(`${code}:{`)) errors.push(`Public QR profile is missing fixed ${name} (${code}) wording.`);
  }

  if (!checkout.includes("if (band === 'UK') return 299") || !checkout.includes("if (band === 'EUROPE') return 499") || !checkout.includes('return 999')) {
    errors.push('Checkout postage rates do not match £2.99 UK / £4.99 Europe / £9.99 Rest of World.');
  }
  if (!portal.includes('SHIPPING_PRICES={UK:299,EUROPE:499,REST_OF_WORLD:999}')) {
    errors.push('Portal postage rates do not match £2.99 UK / £4.99 Europe / £9.99 Rest of World.');
  }
  if (!checkout.includes('const ADDITIONAL_CARD_PRICE_PENCE = 699;')) errors.push('Checkout additional card price is not £6.99.');
  if (!checkout.includes('const LANYARD_HOLDER_PRICE_PENCE = 799;')) errors.push('Checkout lanyard and holder price is not £7.99.');
  if (!checkout.includes('const ADDITIONAL_LANGUAGE_PRICE_PENCE = 2499;')) errors.push('Checkout additional-language package price is not £24.99.');
  if (!portal.includes('ADDITIONAL_ITEM_PRICES={CARD:699,LANYARD:799,LANGUAGE:2499}')) errors.push('Portal additional-item prices do not match checkout.');
  if (!portal.includes('£6.99 each') || !portal.includes('£7.99 each') || !portal.includes('Add another language – £24.99')) errors.push('Portal does not display the agreed additional-item prices.');
  if (!webhook.includes('const ADDITIONAL_CARD_PRICE_PENCE = 699;') || !webhook.includes('const LANYARD_HOLDER_PRICE_PENCE = 799;') || !webhook.includes('const ADDITIONAL_LANGUAGE_PRICE_PENCE = 2499;')) errors.push('Webhook additional-item prices do not match checkout.');
  if (!home.includes('.home-membership-packages .home-membership-package-badge') || !home.includes('font-size: 1.3rem;')) errors.push('Homepage membership headings are not enlarged for desktop and tablet.');
  if (!understanding.includes('privacy-grid trusted-resource-grid') || (understanding.match(/class="trusted-resource-action"/g) || []).length !== 6) errors.push('Trusted-resource link buttons are not grouped for consistent alignment.');
  if (!styles.includes('.trusted-resource-grid .trusted-resource-action .button') || !styles.includes('width: 100%;')) errors.push('Trusted-resource link buttons do not share a consistent width.');

  const membershipPrices = {
    STANDARD: { 1: 2499, 2: 3499, 3: 4499 },
    PLUS: { 1: 3499, 2: 4499, 3: 5499 },
    MULTILINGUAL: { 1: 5499, 2: 6999, 3: 8499 }
  };
  for (const [packageCode, terms] of Object.entries(membershipPrices)) {
    for (const [years, pence] of Object.entries(terms)) {
      const pounds = `£${(pence / 100).toFixed(2)}`;
      if (!checkout.includes(`${years}: ${pence}`)) errors.push(`Checkout is missing ${packageCode} ${years}-year price ${pounds}.`);
      if (!portal.includes(`${years}:${pence}`)) errors.push(`Portal is missing ${packageCode} ${years}-year price ${pounds}.`);
      if (!webhook.includes(`${years}: ${pence}`)) errors.push(`Webhook is missing ${packageCode} ${years}-year price ${pounds}.`);
      if (!home.includes(pounds)) errors.push(`Homepage is missing membership price ${pounds}.`);
    }
  }
  const renewalPrices = {
    STANDARD: { 1: 1899, 2: 2599, 3: 3399 },
    PLUS: { 1: 1899, 2: 2599, 3: 3399 },
    MULTILINGUAL: { 1: 4099, 2: 5299, 3: 6399 }
  };
  for (const [packageCode, terms] of Object.entries(renewalPrices)) {
    for (const [years, pence] of Object.entries(terms)) {
      const pounds = `£${(pence / 100).toFixed(2)}`;
      if (!checkout.includes(`${years}: ${pence}`)) errors.push(`Checkout is missing ${packageCode} ${years}-year renewal price ${pounds}.`);
      if (!portal.includes(`${years}:${pence}`)) errors.push(`Portal is missing ${packageCode} ${years}-year renewal price ${pounds}.`);
      if (!webhook.includes(`${years}: ${pence}`)) errors.push(`Webhook is missing ${packageCode} ${years}-year renewal price ${pounds}.`);
      if (!home.includes(pounds)) errors.push(`Homepage is missing renewal price ${pounds}.`);
    }
  }
  const compact = value => value.replace(/\s+/g, '');
  const plusRenewals = '1:1899,2:2599,3:3399';
  const plusStripePrices = "1:'price_1UJrXSPMYhQKb2OTVotqXy8R',2:'price_1UJrXZPMYhQKb2OTO9U5RlEE',3:'price_1UJrXaPMYhQKb2OT4xcauEkG'";
  if (!compact(checkout).includes(`PLUS:{prices:{${plusRenewals}},stripePrices:{${plusStripePrices}}}`)) errors.push('Checkout Plus renewal mapping is incorrect.');
  if (!compact(initialMembershipCheckout).includes(`renewals:{${plusRenewals}},stripePrices:{${plusStripePrices}}`)) errors.push('Initial membership checkout Plus renewal mapping is incorrect.');
  if (!compact(portal).includes(`PLUS:{${plusRenewals}}`)) errors.push('Portal Plus renewal mapping is incorrect.');
  if (!compact(webhook).includes(`PLUS:{${plusRenewals}}`)) errors.push('Webhook Plus renewal mapping is incorrect.');
  if (!compact(register).includes(`renewals:{${plusRenewals}}`)) errors.push('Registration Plus renewal mapping is incorrect.');
  const plusHomeCard = home.match(/<article class="home-membership-price-card home-membership-package-plus">([\s\S]*?)<\/article>/)?.[1] || '';
  if (!plusHomeCard.includes('1 year £18.99 · 2 years £25.99 · 3 years £33.99')) errors.push('Homepage Plus renewal prices are incorrect.');
  if (!home.includes('Choose one, two or three years of membership')) {
    errors.push('Homepage membership wording does not offer the agreed one-, two- and three-year terms.');
  }
  if (
    !register.includes('id="trial-invite-code"') ||
    !register.includes("registrationMode==='INVITE_ONLY'&&!trialInviteInput.value.trim()") ||
    !register.includes('discountCode:trialInviteInput.value.trim().toUpperCase()')
  ) {
    errors.push('Registration page does not enforce the trial code in invite-only mode and submit the optional code field.');
  }
  if (!registrationAccess.includes("mode === 'INVITE_ONLY'") || !registrationAccess.includes('pilot_invites?invite_code=eq.')) {
    errors.push('Server registration access does not enforce the invite-only trial-code gate.');
  }
  if (
    !registrationAccess.includes("const trialEligible = Number(coupon?.percent_off) === 100") ||
    !registrationAccess.includes("const oneTimeOnly = coupon?.duration === 'once'")
  ) {
    errors.push('Server registration access does not constrain trial/public promotions to the agreed initial-checkout rules.');
  }
  if (
    !registrationAccess.includes("if (!code)") ||
    !registrationAccess.includes("mode, code: '', promotionCodeId: '', isTrial: false") ||
    !registrationAccess.includes("const promotion = await activeInitialPromotion(code, { packageType })")
  ) {
    errors.push('Open registration does not support an empty optional discount code and validated one-time promotional codes.');
  }
  if (
    !startMembershipCheckout.includes("const suppliedCode = body.discountCode ?? body.inviteCode ?? ''") ||
    !startMembershipCheckout.includes('authoriseRegistration(suppliedCode, email, body.packageType)') ||
    !startMembershipCheckout.includes('promotionCodeId: registrationAccess.promotionCodeId') ||
    !initialMembershipCheckout.includes("registration_invite_code: isTrial ? promotionCode : ''")
  ) {
    errors.push('Initial membership checkout does not pass and validate trial/public discount codes.');
  }
  if (startMembershipCheckout.includes('/auth/v1/signup') || startMembershipCheckout.includes('password.length < 8')) {
    errors.push('Registration still creates a Supabase account before Stripe Checkout completes.');
  }
  if (
    !initialMembershipCheckout.includes("if (promotionCodeId) form.append('discounts[0][promotion_code]', promotionCodeId)") ||
    initialMembershipCheckout.includes("allow_promotion_codes")
  ) {
    errors.push('Initial discounts can bypass server validation or are not applied automatically at Stripe Checkout.');
  }
  if (
    !registrationAccess.includes('appliesToProducts.includes(selectedPackage.initialProductId)') ||
    !registrationAccess.includes('appliesToProducts.includes(selectedPackage.renewalProductId)') ||
    !initialMembershipCheckout.includes('selection.packageDefinition.initialProductId')
  ) {
    errors.push('Public promotional discounts are not restricted to membership products and could affect postage.');
  }
  if (
    checkout.includes("allow_promotion_codes") ||
    !checkout.includes("const trialLaterOrderCouponId = isTrialParticipant ? 'LYMPHAWARE_TRIAL_LATER_100_V1' : ''") ||
    !checkout.includes("membership.membership_status === 'PILOT'") ||
    !checkout.includes("if (trialLaterOrderCouponId) stripeForm.append('discounts[0][coupon]', trialLaterOrderCouponId)")
  ) {
    errors.push('Later member purchases can accept public promotion codes or fail to keep established pilot orders at £0.');
  }
  if (
    !webhook.includes("const TRIAL_RENEWAL_PROTECTION_COUPON = 'LYMPHAWARE_TRIAL_RENEWAL_FREE_V1'") ||
    !webhook.includes("'discounts[0][coupon]': TRIAL_RENEWAL_PROTECTION_COUPON") ||
    !webhook.includes("membership_status: isTrial ? 'PILOT' : 'ACTIVE'")
  ) {
    errors.push('Private-trial automatic renewals are not protected from future charges or trial memberships are not marked as PILOT.');
  }
  if (
    !portal.includes("membershipStatus.textContent='Trial Member'") ||
    !portal.includes("Private trial: your trial code is applied automatically to this entire order, including postage & packing.") ||
    !portal.includes("Continue to Secure Checkout – £0.00 today")
  ) {
    errors.push('Patient Portal does not clearly show the zero-cost private-trial status and later trial purchases.');
  }
  if (
    !adminDashboard.includes("order.membership?.membership_status||'').toUpperCase()==='PILOT'") ||
    !adminOrderDetail.includes("order.membership?.membership_status || '').toUpperCase() === 'PILOT'") ||
    !adminDashboard.includes("completed&&order.order_type==='INITIAL_MEMBERSHIP'") ||
    !adminDashboard.includes('Orders to Process') ||
    !adminDashboard.includes('Fulfilment in Progress') ||
    !adminDashboard.includes('Completed Orders') ||
    !adminDashboard.includes('admin@lymphawareid.com') ||
    !signIn.includes("window.location.href = '/admin/';")
  ) {
    errors.push('Administration does not match the agreed order/fulfilment workflow, identify trial orders, restrict welcome letters, show the admin notification address, or route the administrator correctly.');
  }
  if (!register.includes('id="auto-renew-acknowledgement" disabled') || !register.includes("acknowledgement.disabled=!enabled")) {
    errors.push('Registration renewal acknowledgement is not visibly disabled until automatic renewal is selected.');
  }
  if (register.includes('renewalConfirmation.hidden=!autoRenew.checked')) {
    errors.push('Registration still hides the renewal acknowledgement instead of showing its disabled state.');
  }
  if (home.includes('five years') || portal.includes('<strong>5 years</strong>')) {
    errors.push('An obsolete five-year option remains visible in the new-member journey.');
  }
  if (!checkout.includes('if (![1, 2, 3].includes(membershipTermYears))')) {
    errors.push('Checkout does not restrict new memberships to one, two or three years.');
  }
  if (!checkout.includes("shipping_address_collection[allowed_countries][0]") || !checkout.includes('metadata[delivery_country_selected]')) {
    errors.push('Checkout does not restrict and record the selected delivery country.');
  }
  if (!webhook.includes('deliveryCountryMismatch') || !webhook.includes("'ADDRESS_REVIEW_REQUIRED'")) {
    errors.push('Webhook does not hold an order when the checkout delivery country differs from the selected country.');
  }
  if (!adminOrders.includes("order.order_status === 'ADDRESS_REVIEW_REQUIRED'")) {
    errors.push('Admin order workflow does not identify delivery-address review holds.');
  }
  if (!register.includes('Postage & packing — ${countryName}') || !register.includes('only accept a delivery address in ${countryName}')) {
    errors.push('Joining review does not clearly identify the selected delivery country.');
  }
  if (!home.includes('import VAT, customs duties or local handling charges')) {
    errors.push('Homepage does not disclose possible international destination charges.');
  }

  if (!styles.includes('--brand-blue: #0053b7;')) errors.push('Core brand blue is not anchored to the approved logo colour #0053b7.');
  if (!styles.includes('--brand-green: #247a24;')) errors.push('Core brand green is not anchored to the accessible LymphAware green #247a24.');
  const legacyAccentColours = ['#16853f', '#1768b0', '#2878b8', '#168b43', '#176fba', '#0055b8', '#2c922b', '#2c922a'];
  const brandFacingSources = [
    ['homepage', home],
    ['homepage styles', homeStyles],
    ['public chrome', publicChrome],
    ['registration', register],
    ['portal', portal],
    ['profile editor', profile],
    ['public QR profile', publicProfile]
  ];
  for (const [label, source] of brandFacingSources) {
    const lower = source.toLowerCase();
    for (const colour of legacyAccentColours) {
      if (lower.includes(colour)) errors.push(`${label} still contains legacy accent colour ${colour}.`);
    }
  }
  if (!register.includes('--package-accent:#237e7b') || !home.includes('#4f9290')) {
    warnings.push('The deliberate Multilingual teal accent may have been removed or changed.');
  }

  const portalCountryCodes = ['GB','IE','FR','ES','PT','DE','NL','BE','LU','IT','AT','DK','SE','NO','FI','CH','CY','MT','GR','PL','CZ','SK','SI','HR','HU','RO','BG','EE','LV','LT','IS','AL','AD','BA','MD','MC','ME','MK','RS','UA','US','CA','AU','NZ','AE','ZA','IN','JP','SG','HK'];
  for (const code of portalCountryCodes) {
    if (!portal.includes(`['${code}',`)) errors.push(`Portal delivery-country selector is missing ${code}.`);
    if (!checkout.includes(`'${code}'`)) errors.push(`Checkout supported-country list is missing ${code}.`);
    if (!register.includes(`['${code}',`)) errors.push(`Registration delivery-country selector is missing ${code}.`);
  }

  const customerFacingFiles = walk(root).filter(file => {
    const name = relative(file);
    return /\.html$/i.test(file) && !name.startsWith('admin/');
  });
  const customerFacingText = customerFacingFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  if (customerFacingText.includes('£5.00') || customerFacingText.includes('£7.50')) {
    errors.push('An obsolete £5.00 or £7.50 accessory price remains in customer-facing HTML.');
  }
  if (/temporary postage rates|these temporary rates/i.test(customerFacingText)) {
    warnings.push('Customer-facing copy still describes the agreed postage rates as temporary.');
  }
}

const files = walk(root);
for (const file of files) {
  if (/\.(mjs|js)$/i.test(file)) checkStandaloneScript(file);
  else if (/\.html$/i.test(file)) checkHtml(file);
}
checkProjectConsistency();

console.log(`Checked ${standaloneScriptCount} standalone JavaScript files, ${inlineScriptCount} inline scripts and ${htmlFileCount} HTML files.`);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);

if (errors.length) {
  console.error(`\n${errors.length} audit error(s) found:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('LymphAware repository audit passed.');

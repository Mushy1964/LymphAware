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
  const publicProfileFunctionPath = path.join(root, 'supabase/functions/public-profile/index.ts');
  const homePath = path.join(root, 'index.html');
  const webhookPath = path.join(root, 'netlify/functions/stripe-webhook.mjs');
  const registerPath = path.join(root, 'register/index.html');
  const registrationAccessPath = path.join(root, 'netlify/functions/_shared/registration-access.mjs');
  const startMembershipCheckoutPath = path.join(root, 'netlify/functions/start-membership-checkout.mjs');
  const initialMembershipCheckoutPath = path.join(root, 'netlify/functions/_shared/initial-membership-checkout.mjs');
  const businessSettingsPath = path.join(root, 'netlify/functions/_shared/business-settings.mjs');
  const adminBusinessSettingsPath = path.join(root, 'admin/business-settings/index.html');
  const adminBusinessSettingsApiPath = path.join(root, 'netlify/functions/admin-business-settings.mjs');
  const registrationSettingsPath = path.join(root, 'netlify/functions/registration-settings.mjs');
  const discountControlsPath = path.join(root, 'netlify/functions/_shared/discount-code-controls.mjs');
  const adminDiscountCodesPath = path.join(root, 'netlify/functions/admin-discount-codes.mjs');
  const adminOrdersPath = path.join(root, 'netlify/functions/admin-orders-list.mjs');
  const adminOrderArchivePath = path.join(root, 'netlify/functions/admin-order-archive.mjs');
  const adminDashboardSummaryPath = path.join(root, 'netlify/functions/admin-dashboard-summary.mjs');
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
  const publicProfileFunction = fs.readFileSync(publicProfileFunctionPath, 'utf8');
  const home = fs.readFileSync(homePath, 'utf8');
  const webhook = fs.readFileSync(webhookPath, 'utf8');
  const register = fs.readFileSync(registerPath, 'utf8');
  const registrationAccess = fs.readFileSync(registrationAccessPath, 'utf8');
  const startMembershipCheckout = fs.readFileSync(startMembershipCheckoutPath, 'utf8');
  const initialMembershipCheckout = fs.readFileSync(initialMembershipCheckoutPath, 'utf8');
  const businessSettings = fs.readFileSync(businessSettingsPath, 'utf8');
  const adminBusinessSettings = fs.readFileSync(adminBusinessSettingsPath, 'utf8');
  const adminBusinessSettingsApi = fs.readFileSync(adminBusinessSettingsApiPath, 'utf8');
  const registrationSettings = fs.readFileSync(registrationSettingsPath, 'utf8');
  const discountControls = fs.readFileSync(discountControlsPath, 'utf8');
  const adminDiscountCodes = fs.readFileSync(adminDiscountCodesPath, 'utf8');
  const adminOrders = fs.readFileSync(adminOrdersPath, 'utf8');
  const adminOrderArchive = fs.readFileSync(adminOrderArchivePath, 'utf8');
  const adminDashboardSummary = fs.readFileSync(adminDashboardSummaryPath, 'utf8');
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
    if (!publicProfileFunction.includes(`${code}: {`)) errors.push(`Public profile function is missing ${name} demo assistance translations.`);
  }

  for (const token of [
    '1babe83a-9ad9-4999-a7c4-658b1400b044',
    '1babe83a-9ad9-4999-a7c4-658b1400b045',
    '1babe83a-9ad9-4999-a7c4-658b1400b046',
    '1babe83a-9ad9-4999-a7c4-658b1400b047'
  ]) {
    if (!home.includes(token) || !publicProfile.includes(token)) errors.push(`Multilingual demo token is missing from the home/profile demo journey: ${token}.`);
  }
  if (!home.includes('home-demo-language-button') || !home.includes('initialiseMultilingualDemo')) {
    errors.push('Homepage multilingual demonstration selector is missing.');
  }
  if (!publicProfile.includes('demo-language-links') || !publicProfile.includes('DEMO_TOKENS')) {
    errors.push('Demo public profile language switcher is missing.');
  }

  for (const expected of [
    'price_additional_card_pence: 699',
    'price_lanyard_holder_pence: 799',
    'price_additional_language_pence: 2499',
    'postage_uk_pence: 299',
    'postage_europe_pence: 499',
    'postage_rest_of_world_pence: 999'
  ]) {
    if (!businessSettings.includes(expected)) errors.push(`Business Settings default is missing: ${expected}.`);
  }
  if (!checkout.includes("getBusinessSettings({ strict: true })") || !checkout.includes('livePricing.additionalItems.CARD') || !checkout.includes('livePricing.shipping[band]')) {
    errors.push('Member checkout is not using protected Business Settings for live prices.');
  }
  if (!initialMembershipCheckout.includes("getBusinessSettings({ strict: true })") || !initialMembershipCheckout.includes('pricing.packages[packageType][membershipTermYears]') || !initialMembershipCheckout.includes('pricing.shipping[shippingBand]')) {
    errors.push('Initial membership checkout is not using protected Business Settings for live prices.');
  }
  if (!registrationSettings.includes('pricing = publicPricing(businessSettings)') || !register.includes('settings.pricing?.packages') || !portal.includes('async function loadBusinessPricing()') || !home.includes('async function loadLiveBusinessPricing()')) {
    errors.push('Customer-facing pages are not loading the shared Business Settings prices.');
  }
  if (!adminDashboard.includes('href="/admin/business-settings/"') || !adminBusinessSettings.includes('Routine business prices and postage can be maintained here') || !adminBusinessSettingsApi.includes('verifyAdminRequest')) {
    errors.push('Business Settings is not kept as a separate protected Admin destination.');
  }
  if (!adminDashboardSummary.includes('profile?.is_archived !== true') || !adminDashboardSummary.includes('profile?.is_demo !== true') || !adminDashboardSummary.includes('activeMemberships')) {
    errors.push('Membership Overview does not consistently exclude archived and demo records.');
  }
  if (!adminDashboard.includes('data-stage="ARCHIVED"') || !adminDashboard.includes('function renderHistoryOrder(order)') || !adminDashboard.includes('Reprint welcome letter') || !adminDashboard.includes('Reprint envelope')) {
    errors.push('Completed/Archived order history is missing the compact expandable history controls.');
  }
  if (!adminOrders.includes("searchParams.get('scope')") || !adminOrders.includes("is_archived=eq.")) {
    errors.push('Admin order loading does not separate active and archived order history.');
  }
  if (!adminOrderArchive.includes("['COMPLETED', 'CANCELLED', 'REFUNDED']") || !adminOrderArchive.includes('hasOpenCancellation') || !adminOrderArchive.includes("path: '/api/admin-order-archive'")) {
    errors.push('Protected terminal-order archive/restore safeguards are missing.');
  }
  if (!webhook.includes('metadataCardUnitPricePence') || !webhook.includes('metadataPackagePricePence')) {
    errors.push('Webhook is not preserving the price captured at the time of checkout.');
  }
  if (!adminBusinessSettings.includes('Discount &amp; trial codes') || !adminBusinessSettings.includes('/api/admin-discount-codes')) {
    errors.push('Business Settings does not include the separate Discount & Trial Codes controls.');
  }
  if (!registrationAccess.includes("discountCodeWebsiteStatus(control, 'TRIAL')") || !registrationAccess.includes("discountCodeWebsiteStatus(control, 'PUBLIC')")) {
    errors.push('Registration does not enforce Business Settings validity windows for trial and public discount codes.');
  }
  if (!discountControls.includes('discount_code_controls') || !discountControls.includes("reason: 'SCHEDULED'") || !discountControls.includes("reason: 'EXPIRED'")) {
    errors.push('Shared discount-code controls do not enforce enabled, start and expiry states.');
  }
  if (!adminDiscountCodes.includes("duration', 'once'") || !adminDiscountCodes.includes('applies_to[products]') || !adminDiscountCodes.includes("code.includes('TRIAL')")) {
    errors.push('Admin discount-code creation does not preserve one-time membership-only discount rules or trial-code protection.');
  }
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
    !adminDashboard.includes("String(membership.membership_status||'').toUpperCase()==='PILOT'") ||
    !adminOrderDetail.includes("order.membership?.membership_status || '').toUpperCase() === 'PILOT'") ||
    !adminDashboard.includes("completed&&order.order_type==='INITIAL_MEMBERSHIP'") ||
    !adminDashboard.includes('Orders to Process') ||
    !adminDashboard.includes('Fulfilment in Progress') ||
    !adminDashboard.includes('Cancellation Requests') ||
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

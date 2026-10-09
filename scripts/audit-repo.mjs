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
  const profileReviewSharedPath = path.join(root, 'netlify/functions/_shared/profile-review.mjs');
  const profileReviewMemberPath = path.join(root, 'netlify/functions/member-profile-review.mjs');
  const profileReviewReminderPath = path.join(root, 'netlify/functions/send-profile-review-reminders.mjs');
  const packageJsonPath = path.join(root, 'package.json');
  const packageLockPath = path.join(root, 'package-lock.json');
  const walletPagePath = path.join(root, 'wallet-card/index.html');
  const walletMemberPath = path.join(root, 'netlify/functions/_shared/wallet-member.mjs');
  const appleWalletPath = path.join(root, 'netlify/functions/apple-wallet-pass.mjs');
  const googleWalletPath = path.join(root, 'netlify/functions/google-wallet-pass.mjs');
  const emailBrandingPath = path.join(root, 'netlify/functions/_shared/email-branding.mjs');
  const membershipContractPath = path.join(root, 'netlify/functions/_shared/membership-contract.mjs');
  const renewalRemindersPath = path.join(root, 'netlify/functions/send-membership-renewal-reminders.mjs');
  const startMembershipRenewalPath = path.join(root, 'netlify/functions/start-membership-renewal.mjs');
  const adminSyncRenewalPricesPath = path.join(root, 'netlify/functions/admin-sync-renewal-prices.mjs');
  const cancelRenewedMembershipPath = path.join(root, 'netlify/functions/cancel-renewed-membership.mjs');
  const termsPath = path.join(root, 'terms/index.html');
  const renewalArtworkPath = path.join(root, 'assets/email/LymphAware_Renewal_Email_Hero_Approved.jpg');
  const renewalHeroBase64Path = path.join(root, 'netlify/functions/_shared/renewal-hero-base64.mjs');
  const managePaymentMethodPath = path.join(root, 'netlify/functions/manage-payment-method.mjs');
  const adminControlCentrePath = path.join(root, 'admin/control-centre/index.html');
  const headersPath = path.join(root, '_headers');
  const systemControlsPath = path.join(root, 'netlify/functions/_shared/system-controls.mjs');
  const publicSiteSettingsPath = path.join(root, 'netlify/functions/public-site-settings.mjs');
  const adminSecurityPath = path.join(root, 'admin/security/index.html');
  const adminAttentionPath = path.join(root, 'netlify/functions/admin-attention-items.mjs');
  const adminResourcesPath = path.join(root, 'netlify/functions/admin-information-resources.mjs');
  const publicInformationResourcesPath = path.join(root, 'netlify/functions/public-information-resources.mjs');
  const contactEnquiryPath = path.join(root, 'netlify/functions/contact-enquiry.mjs');
  const registrationEmailCheckPath = path.join(root, 'netlify/functions/check-registration-email.mjs');
  const communicationContentPath = path.join(root, 'netlify/functions/_shared/customer-communication-content.mjs');
  const adminTestEmailPath = path.join(root, 'netlify/functions/admin-test-email.mjs');
  const orderNotificationsPath = path.join(root, 'netlify/functions/_shared/order-notifications.mjs');

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
  const profileReviewShared = fs.readFileSync(profileReviewSharedPath, 'utf8');
  const profileReviewMember = fs.readFileSync(profileReviewMemberPath, 'utf8');
  const profileReviewReminder = fs.readFileSync(profileReviewReminderPath, 'utf8');
  const emailBranding = fs.readFileSync(emailBrandingPath, 'utf8');
  const membershipContract = fs.readFileSync(membershipContractPath, 'utf8');
  const renewalReminders = fs.readFileSync(renewalRemindersPath, 'utf8');
  const startMembershipRenewal = fs.readFileSync(startMembershipRenewalPath, 'utf8');
  const adminSyncRenewalPrices = fs.readFileSync(adminSyncRenewalPricesPath, 'utf8');
  const cancelRenewedMembership = fs.readFileSync(cancelRenewedMembershipPath, 'utf8');
  const terms = fs.readFileSync(termsPath, 'utf8');
  const renewalHeroBase64 = fs.readFileSync(renewalHeroBase64Path, 'utf8');
  const managePaymentMethod = fs.readFileSync(managePaymentMethodPath, 'utf8');
  const adminControlCentre = fs.readFileSync(adminControlCentrePath, 'utf8');
  const netlifyHeaders = fs.readFileSync(headersPath, 'utf8');
  const systemControls = fs.readFileSync(systemControlsPath, 'utf8');
  const publicSiteSettings = fs.readFileSync(publicSiteSettingsPath, 'utf8');
  const adminSecurity = fs.readFileSync(adminSecurityPath, 'utf8');
  const adminAttention = fs.readFileSync(adminAttentionPath, 'utf8');
  const adminResources = fs.readFileSync(adminResourcesPath, 'utf8');
  const publicInformationResources = fs.readFileSync(publicInformationResourcesPath, 'utf8');
  const contactEnquiry = fs.readFileSync(contactEnquiryPath, 'utf8');
  const registrationEmailCheck = fs.readFileSync(registrationEmailCheckPath, 'utf8');
  const communicationContent = fs.readFileSync(communicationContentPath, 'utf8');
  const adminTestEmail = fs.readFileSync(adminTestEmailPath, 'utf8');
  const orderNotifications = fs.readFileSync(orderNotificationsPath, 'utf8');

  if (!fs.existsSync(renewalArtworkPath) || fs.statSync(renewalArtworkPath).size < 5000) {
    errors.push('Renewal email fallback artwork is missing or unexpectedly small.');
  }
  if (
    !renewalHeroBase64.includes('RENEWAL_HERO_CHUNK_01') ||
    !renewalHeroBase64.includes('RENEWAL_HERO_CHUNK_07') ||
    !membershipContract.includes("content_id: 'lymphaware-renewal-hero'") ||
    !membershipContract.includes("cid:lymphaware-renewal-hero")
  ) {
    errors.push('Renewal emails are not using the approved inline CID artwork assembly.');
  }
  if (!membershipContract.includes("LymphAware_Renewal_Email_Hero_Approved.jpg") || !membershipContract.includes("portal/#membership-panel")) {
    errors.push('Renewal email configuration is not using the approved renewal email artwork and the membership Portal deep link.');
  }
  if (!emailBranding.includes('heroImageHtml') || !emailBranding.includes('detailRowsHtml') || !emailBranding.includes('actionButtonHtml') || !emailBranding.includes('overflow-wrap:anywhere') || !emailBranding.includes('.email-title')) {
    errors.push('Branded email template is missing renewal artwork, responsive wrapping, details or accessible action-button support.');
  }
  if (!renewalReminders.includes("actionLabel: automatic ? 'Review my membership' : 'Renew now'") || !renewalReminders.includes("heroImageUrl: RENEWAL_HERO_URL") || !renewalReminders.includes("showHeaderLogo: false") || !renewalReminders.includes("Your membership renews automatically") || !renewalReminders.includes("Your membership is approaching expiry")) {
    errors.push('Renewal reminders do not use the shared branded hero, short mobile titles and distinct manual/automatic actions.');
  }
  if (!signIn.includes('safePortalReturnTo') || !signIn.includes('requestedReturnTo') || !portal.includes("returnTo='+encodeURIComponent(returnTo)") || !portal.includes("location.hash==='#membership-panel'")) {
    errors.push('Renewal deep links are not safely preserved through sign-in and returned to the membership section.');
  }

  if (!portal.includes('Profile Health Check') || !portal.includes('/.netlify/functions/member-profile-review') || !portal.includes('/profile/?review=1')) {
    errors.push('Patient Portal profile health-check controls are missing or incomplete.');
  }
  if (
    !portal.includes('Update payment method') ||
    !portal.includes('/api/manage-payment-method') ||
    !managePaymentMethod.includes("'flow_data[type]': 'payment_method_update'") ||
    !managePaymentMethod.includes("billing_portal/sessions")
  ) {
    errors.push('Automatic-renew members do not have the protected Stripe payment-method update flow.');
  }
  if (
    webhook.includes('[1, 2, 3, 5]') ||
    webhook.includes(' 5: 2999') ||
    webhook.includes(' 5: 3999') ||
    webhook.includes(' 5: 4999') ||
    adminControlCentre.includes('[1,2,3,5]')
  ) {
    errors.push('Obsolete five-year membership handling remains in webhook or Admin code.');
  }
  if (
    !publicProfileFunction.includes('source.is_archived === true') ||
    !publicProfileFunction.includes('profile.is_archived === true')
  ) {
    errors.push('Public QR profile function does not explicitly reject archived profiles.');
  }
  if (
    !netlifyHeaders.includes('X-Content-Type-Options: nosniff') ||
    !netlifyHeaders.includes('Content-Security-Policy:') ||
    !netlifyHeaders.includes('/admin/*') ||
    !netlifyHeaders.includes('X-Robots-Tag: noindex, nofollow, noarchive')
  ) {
    errors.push('Netlify browser security headers or private-area indexing protection are missing.');
  }
  if (
    !systemControls.includes('feature_package_standard_enabled') ||
    !systemControls.includes('feature_term_3y_enabled') ||
    !systemControls.includes('communications_profile_review_reminders_enabled') ||
    !publicSiteSettings.includes("path: '/api/public-site-settings'") ||
    !initialMembershipCheckout.includes("features.packages?.[packageType] !== true") ||
    !checkout.includes("features.additionalItems !== true") ||
    !register.includes("settings.controls?.features") ||
    !portal.includes("SITE_FEATURES=settings.controls?.features")
  ) {
    errors.push('Admin operational availability controls are not consistently enforced by public/member journeys.');
  }
  if (
    !adminSecurity.includes("factorType:'totp'") ||
    !adminSecurity.includes('admin_mfa_required:true') ||
    !signIn.includes('getAuthenticatorAssuranceLevel') ||
    !adminControlCentre.includes('Admin Security')
  ) {
    errors.push('Administrator multi-factor setup or sign-in routing is incomplete.');
  }
  if (
    !adminAttention.includes("path:'/api/admin-attention-items'") ||
    !adminControlCentre.includes('Attention required') ||
    !adminControlCentre.includes('loadAttention()') ||
    !adminResources.includes("path:'/api/admin-information-resources'")
  ) {
    errors.push('Admin operational attention or information-resource controls are incomplete.');
  }
  if (
    !contactEnquiry.includes("rateLimit: { action: 'rate_limit'") ||
    !registrationEmailCheck.includes("rateLimit: { action: 'rate_limit'") ||
    !startMembershipCheckout.includes("rateLimit: { action: 'rate_limit'") ||
    !communicationContent.includes('buildInitialMembershipWelcome') ||
    !adminTestEmail.includes('buildOrderStatusCommunication') ||
    !orderNotifications.includes('buildOrderStatusCommunication')
  ) {
    errors.push('Public rate limiting or shared live/test communication templates are incomplete.');
  }
  if (!profile.includes('profileReviewMode') || !profile.includes('confirmProfileReviewAfterSave')) {
    errors.push('Profile editor does not complete a requested six-monthly review after save.');
  }
  if (!profileReviewShared.includes('REVIEW_MONTHS = 6') || !profileReviewShared.includes('FOLLOWUP_DAYS = 14') || !profileReviewShared.includes('RENEWAL_QUIET_DAYS = 30')) {
    errors.push('Profile review cadence or renewal quiet-zone constants are missing.');
  }
  if (!profileReviewMember.includes('profile_next_review_due_at') || !profileReviewMember.includes('profile_review_events')) {
    errors.push('Member profile review confirmation does not update the review cycle and history.');
  }
  if (!profileReviewReminder.includes("schedule: '30 9 * * *'") || !profileReviewReminder.includes('membershipInRenewalQuietZone') || !profileReviewReminder.includes('PROFILE_REVIEW_FOLLOWUP_DAYS')) {
    errors.push('Scheduled profile review reminders are missing their cadence, follow-up, or renewal quiet-zone control.');
  }
  if ((home.match(/Six-monthly profile review reminders/g) || []).length < 3 || (register.match(/Six-monthly profile review reminders/g) || []).length < 3) {
    errors.push('Profile review reminders are not listed across all three membership packages.');
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
  const walletPage = fs.readFileSync(walletPagePath, 'utf8');
  const walletMember = fs.readFileSync(walletMemberPath, 'utf8');
  const appleWallet = fs.readFileSync(appleWalletPath, 'utf8');
  const googleWallet = fs.readFileSync(googleWalletPath, 'utf8');

  if (packageJson.dependencies?.['passkit-generator'] !== '3.6.1') {
    errors.push('Apple Wallet pass generator dependency is missing or not pinned to the reviewed version.');
  }
  if (packageLock.lockfileVersion !== 3 || packageLock.packages?.['']?.dependencies?.['passkit-generator'] !== '3.6.1') {
    errors.push('npm dependency lockfile is missing or does not pin the reviewed Apple Wallet dependency.');
  }
  if (!walletMember.includes("['PLUS', 'MULTILINGUAL']") || !walletMember.includes('membership_end') || !walletMember.includes('walletProviderReadiness')) {
    errors.push('Wallet eligibility is not centrally restricted to current Plus/Multilingual memberships.');
  }
  if (!appleWallet.includes("expirationDate: loaded.card.membership_end") || !appleWallet.includes("sharingProhibited: true") || !appleWallet.includes("PKBarcodeFormatQR")) {
    errors.push('Apple Wallet pass is missing expiry, sharing protection or QR linkage.');
  }
  if (!walletMember.includes("GOOGLE_WALLET_PRIVATE_PASS_APPROVED") || !googleWallet.includes("readiness.google.private_pass_approved") || !googleWallet.includes("genericPrivatePasses") || !googleWallet.includes("GENERIC_PRIVATE_PASS_TYPE_UNSPECIFIED")) {
    errors.push('Google Wallet private-pass approval gate or private-pass payload is missing.');
  }
  if (!walletPage.includes("providers?.apple?.available===true") || !walletPage.includes("providers?.google?.available===true")) {
    errors.push('Wallet page can expose provider controls without confirmed provider readiness.');
  }

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
    'postage_rest_of_world_pence: 999',
    'renewal_standard_1y_pence: 1899',
    'renewal_standard_2y_pence: 2599',
    'renewal_standard_3y_pence: 3399',
    'renewal_plus_1y_pence: 1899',
    'renewal_plus_2y_pence: 2599',
    'renewal_plus_3y_pence: 3399',
    'renewal_multilingual_1y_pence: 4099',
    'renewal_multilingual_2y_pence: 5299',
    'renewal_multilingual_3y_pence: 6399'
  ]) {
    if (!businessSettings.includes(expected)) errors.push(`Business Settings default is missing: ${expected}.`);
  }
  if (!checkout.includes("getBusinessSettings({ strict: true })") || !checkout.includes('livePricing.additionalItems.CARD') || !checkout.includes('livePricing.shipping[band]') || !checkout.includes('livePricing.renewals[packageType][membershipTermYears]')) {
    errors.push('Member checkout is not using protected Business Settings for live prices, including renewal prices.');
  }
  if (!initialMembershipCheckout.includes("getBusinessSettings({ strict: true })") || !initialMembershipCheckout.includes('pricing.packages[packageType][membershipTermYears]') || !initialMembershipCheckout.includes('pricing.shipping[shippingBand]') || !initialMembershipCheckout.includes('pricing.renewals[packageType][membershipTermYears]')) {
    errors.push('Initial membership checkout is not using protected Business Settings for live prices, including renewal prices.');
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
  if (
    !understanding.includes('id="trusted-resource-grid"') ||
    !understanding.includes("/api/public-information-resources") ||
    !understanding.includes("trusted-resource-action") ||
    !publicInformationResources.includes("path:'/api/public-information-resources'") ||
    !publicInformationResources.includes("active=eq.true") ||
    !adminResources.includes("description:text(body.description,500)")
  ) errors.push('Approved information resources are not using the shared Admin-managed source across public and member surfaces.');
  if (!styles.includes('.trusted-resource-grid .trusted-resource-action .button') || !styles.includes('width: 100%;')) errors.push('Trusted-resource link buttons do not share a consistent width.');

  if (!businessSettings.includes('renewals: {') || !businessSettings.includes('renewal_standard_1y_pence') || !businessSettings.includes('renewal_plus_2y_pence') || !businessSettings.includes('renewal_multilingual_3y_pence')) {
    errors.push('Business Settings does not expose all renewal prices through the shared public pricing structure.');
  }
  if (!checkout.includes("appendRecurringPrice") || !checkout.includes("[price_data][recurring][interval_count]") || checkout.includes("stripePrices:")) {
    errors.push('Member checkout does not build current admin-managed recurring renewal prices with the correct term interval.');
  }
  if (!initialMembershipCheckout.includes("appendRecurringPrice") || !initialMembershipCheckout.includes("[price_data][recurring][interval_count]") || initialMembershipCheckout.includes("stripePrices:")) {
    errors.push('Initial checkout does not build current admin-managed recurring renewal prices with the correct term interval.');
  }
  if (!registrationSettings.includes('const pricing = publicPricing(businessSettings)') || registrationSettings.includes('PACKAGE_DEFINITIONS.STANDARD.renewals')) {
    errors.push('Registration settings are overriding shared renewal pricing instead of serving Business Settings.');
  }
  if (!register.includes('settings.pricing.renewals?.[code]') || !portal.includes('settings.pricing.renewals?.[code]') || !home.includes('settings.pricing.renewals?.[code]')) {
    errors.push('Customer-facing membership pages are not applying live renewal prices from Business Settings.');
  }
  if (!startMembershipRenewal.includes("getBusinessSettings({ strict: true })") || !startMembershipRenewal.includes('livePricing.renewals?.[packageType]?.[years]')) {
    errors.push('Manual membership renewal checkout is not securely re-reading the current Admin renewal price.');
  }
  if (!renewalReminders.includes("getBusinessSettings({ strict: true })") || !renewalReminders.includes('membership.auto_renew_enabled === true') || !renewalReminders.includes('livePricing?.renewals?.[packageType]?.[years]')) {
    errors.push('Renewal reminders do not distinguish the agreed auto-renew amount from the current manual-renewal price.');
  }
  if (!adminBusinessSettings.includes('Membership renewal prices') || !adminBusinessSettings.includes('renewal_standard_1y_pence') || !adminBusinessSettings.includes('/api/admin-sync-renewal-prices')) {
    errors.push('Admin Business Settings does not provide controlled renewal-price management.');
  }
  if (!adminSyncRenewalPrices.includes('const NOTICE_DAYS = 60') || !adminSyncRenewalPrices.includes("proration_behavior: 'none'") || !adminSyncRenewalPrices.includes('Member notification failed, so the price change was rolled back') || !adminSyncRenewalPrices.includes('AUTO_RENEW_PRICE_CHANGED') || !adminSyncRenewalPrices.includes('AUTO_RENEW_PRICE_CHANGE_DEFERRED') || !adminSyncRenewalPrices.includes('pending_renewal_price_pence') || !adminSyncRenewalPrices.includes('notifyDeferredPriceChange')) {
    errors.push('Existing automatic-renew price changes are missing advance-notice, no-proration, deferred-following-cycle or rollback safeguards.');
  }
  if (!adminBusinessSettings.includes('queued automatically for the new price at the following renewal') || !adminBusinessSettings.includes('result.deferred')) {
    errors.push('Admin Business Settings does not explain or report protected deferred automatic-renew price changes.');
  }
  if (!portal.includes('pending_renewal_price_pence') || !portal.includes('automaticRenewalStatusText') || !portal.includes('queued automatically for the following renewal')) {
    errors.push('Patient Portal does not show a queued future automatic-renew price change.');
  }
  if (!webhook.includes('applyDeferredRenewalPriceAfterPaidCycle') || !webhook.includes('AUTO_RENEW_DEFERRED_PRICE_ACTIVATED') || !webhook.includes('pending_renewal_price_pence: null') || !webhook.includes('activate-deferred-renewal-price-')) {
    errors.push('Stripe renewal webhook does not automatically activate a deferred price after the protected renewal succeeds.');
  }
  if (!webhook.includes("event.type === 'invoice.payment_failed'") || !webhook.includes("'RENEWAL_PAYMENT_FAILED'") || !webhook.includes('hosted_invoice_url')) {
    errors.push('Failed automatic-renewal payments do not trigger the branded recovery workflow.');
  }
  if (!webhook.includes("latest_renewal_mode: 'MANUAL'") || !webhook.includes("latest_renewal_mode: 'AUTO'") || !webhook.includes('renewal_previous_membership_end') || !webhook.includes('renewal_cooling_off_ends_at')) {
    errors.push('Renewal webhook does not preserve manual/automatic cooling-off state and the previous paid term.');
  }
  if (!cancelRenewedMembership.includes("renewalMode !== 'MANUAL'") || !cancelRenewedMembership.includes('previousTermStillActive') || !cancelRenewedMembership.includes('restoredMembershipEnd')) {
    errors.push('Renewal cooling-off cancellation cannot safely refund manual renewals while restoring an unexpired previous term.');
  }
  if (!terms.includes('both automatic and member-initiated renewals') || !terms.includes('does not create an immediate charge') || !terms.includes('within 60 days') || !terms.includes('following renewal instead')) {
    errors.push('Terms do not explain manual renewal cooling-off, the 60-day protection window and deferred future price changes.');
  }
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
    (!signIn.includes("'/admin/security/?challenge=1'") || !signIn.includes("'/admin/'"))
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

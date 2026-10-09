export function orderReference(number) {
  return `ORD-${String(number || 0).padStart(6, '0')}`;
}

export function buildOrderStatusCommunication(order, kind) {
  const reference = orderReference(order?.order_number);
  if (kind === 'production') {
    return {
      subject: `Your LymphAware ID cards are now in production – ${reference}`,
      text:
        `Your LymphAware ID order ${reference} has entered card production.\n\n` +
        'We will email you again when the complete order has been packed and dispatched. You can review your details in the Patient Portal:\nhttps://lymphawareid.com/portal/'
    };
  }
  if (kind === 'completion') {
    return {
      subject: `Your LymphAware ID order has been dispatched – ${reference}`,
      text:
        `Your LymphAware ID order ${reference} has been completed, packed and dispatched.\n\n` +
        'Thank you for being a LymphAware ID member. You can continue to update your QR profile at any time from the Patient Portal:\nhttps://lymphawareid.com/portal/'
    };
  }
  throw new Error('Unknown customer notification type.');
}

export function buildInitialMembershipWelcome({
  membershipTermYears = 1,
  isTrial = false,
  accountSetupLink = '',
  languageName = '',
  autoRenew = false,
  renewalPricePence = 0
} = {}) {
  const years = [1,2,3].includes(Number(membershipTermYears)) ? Number(membershipTermYears) : 1;
  const setupSection = accountSetupLink
    ? `YOUR SECURE ACCOUNT\n\nYour checkout is complete, so your LymphAware ID account and membership have now been created. Confirm your email address and choose your password using this secure link:\n\n${accountSetupLink}\n\nAfter choosing your password, you can sign in to your Patient Portal at:\nhttps://lymphawareid.com/sign-in/\n\n`
    : 'YOUR SECURE ACCOUNT\n\nYour checkout is complete and your LymphAware ID account has been created. If you need a new account-setup link, please contact admin@lymphawareid.com.\n\n';

  let nextSteps =
    `${isTrial ? 'Your private-trial membership' : `Your ${years}-year LymphAware ID membership`} is now active.\n\n` +
    setupSection +
    'WHAT YOU NEED TO DO NEXT\n\n' +
    'Once your password is set, please complete these two mandatory details in your Patient Portal before your LymphAware ID card can be produced:\n\n' +
    '1. Your display name – this is the name that will appear on your LymphAware ID card and QR profile.\n' +
    '2. A clear, recent photograph – this will appear on your ID card and at the top of your QR profile.\n\n' +
    'Both details are required before your card can enter production.\n\n' +
    'The remaining QR profile sections are optional and can be completed now or at any time that suits you. You can add as much or as little information as you wish. If you leave a section empty, it will still appear when your QR code is scanned and will state that no information has been added to that section.\n\n' +
    'Once you save your display name and photograph, LymphAware ID will be notified automatically that your card details are ready. We will then begin preparing your ID card, lanyard and holder, together with any additional cards or language versions included in your order.\n\n' +
    'We aim to prepare and dispatch your order within 7–10 working days after your required card details have been completed. Delivery time after dispatch will depend on the postal service and destination.\n\n' +
    'You can continue to update your QR profile at any time, including after your physical card has been produced.\n\n' +
    'YOUR INITIAL COOLING-OFF PERIOD\n\nYou may tell us that you want to cancel within 14 days of joining. Contact admin@lymphawareid.com. Any refund and deduction for services or personalised items already supplied will be handled in accordance with your statutory rights and the Terms.';

  if (languageName) {
    nextSteps +=
      `\n\nYour package includes a ${languageName} profile and card. Keep your main English profile accurate and LymphAware ID will automatically prepare the ${languageName} version from it and keep it updated when your English information changes. You do not need to translate anything yourself. Empty English sections will also remain empty in the translated profile.`;
  }

  if (autoRenew) {
    const renewal = `£${(Number(renewalPricePence || 0) / 100).toFixed(2)}`;
    nextSteps += isTrial
      ? `\n\nAUTOMATIC RENEWAL\n\nYou chose to test automatic renewal. The normal renewal price is ${renewal} every ${years} year${years === 1 ? '' : 's'}. Your private-trial membership has a 100% renewal discount, so no renewal payment will be taken while it remains a private-trial account. No new cards, lanyards or postage are included. You can turn off automatic renewal from your Patient Portal.`
      : `\n\nAUTOMATIC RENEWAL\n\nYou chose automatic renewal. At the end of this ${years}-year term, your digital membership will renew for ${renewal} for another ${years} year${years === 1 ? '' : 's'}. No new cards, lanyards or postage are included. You can cancel automatic renewal from your Patient Portal before the renewal date.`;
  }

  return {
    subject: 'Welcome to LymphAware ID – complete your secure account',
    nextSteps
  };
}

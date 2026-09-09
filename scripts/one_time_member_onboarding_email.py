from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

# Improve the initial membership welcome email.
webhook_path = Path('netlify/functions/stripe-webhook.mjs')
webhook = webhook_path.read_text(encoding='utf-8')
old_welcome = '''  if (paymentType === 'initial_membership') {
    subject = `Welcome to LymphAware – complete your card details`;
    nextSteps =
      `Your five-year LymphAware membership is now active.\\n\\n` +
      `Before your ID card can be printed, please add your display name and a clear, recent photograph in your Patient Portal. Once those two details are present, your card can enter production. Please then complete the remaining profile sections so the QR profile contains the information you would like others to see.\\n\\n` +
      `Complete your profile:\\nhttps://lymphaware.com/profile/`;
    if (languageName) {
      nextSteps +=
        `\\n\\nYour package includes a ${languageName} profile and card. You do not need to translate anything yourself. LymphAware will prepare the ${languageName} version for you from the information in your main English profile. Empty English sections will also remain empty in the translated profile.`;
    }
'''
new_welcome = '''  if (paymentType === 'initial_membership') {
    subject = `Welcome to LymphAware – your membership is now active`;
    nextSteps =
      `Your five-year LymphAware membership is now active.\\n\\n` +
      `WHAT YOU NEED TO DO NEXT\\n\\n` +
      `Before your LymphAware ID card can be produced, please complete these two mandatory details in your Patient Portal:\\n\\n` +
      `1. Your display name – this is the name that will appear on your LymphAware ID card and QR profile.\\n` +
      `2. A clear, recent photograph – this will appear on your ID card and at the top of your QR profile.\\n\\n` +
      `Both details are required before your card can enter production.\\n\\n` +
      `The remaining QR profile sections are optional and can be completed now or at any time that suits you. You can add as much or as little information as you wish. If you leave a section empty, it will still appear when your QR code is scanned and will state that no information has been added to that section.\\n\\n` +
      `Once you save your display name and photograph, LymphAware will be notified automatically that your card details are ready. We will then begin preparing your ID card, lanyard and holder, together with any additional cards or language versions included in your order.\\n\\n` +
      `We aim to prepare and dispatch your order within 7–10 working days after your required card details have been completed. Delivery time after dispatch will depend on the postal service and destination.\\n\\n` +
      `You can continue to update your QR profile at any time, including after your physical card has been produced.\\n\\n` +
      `Complete your profile:\\nhttps://lymphaware.com/profile/`;
    if (languageName) {
      nextSteps +=
        `\\n\\nYour package includes a ${languageName} profile and card. Keep your main English profile accurate and LymphAware will automatically prepare the ${languageName} version from it and keep it updated when your English information changes. You do not need to translate anything yourself. Empty English sections will also remain empty in the translated profile.`;
    }
'''
webhook = replace_once(webhook, old_welcome, new_welcome, 'initial membership welcome email')
webhook_path.write_text(webhook, encoding='utf-8')

# Notify LymphAware when the member first completes the two mandatory card details.
profile_path = Path('profile-v2/index.html')
profile = profile_path.read_text(encoding='utf-8')
old_translation_function = "async function requestLanguageTranslation(){const {data:{session}}=await supabaseClient.auth.getSession();if(!session?.access_token)return;try{await fetch('/.netlify/functions/refresh-language-translations-background',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}})}catch(error){console.error('Unable to request language translation:',error)}}"
new_translation_function = old_translation_function + "\nasync function notifyProfileReady(){const {data:{session}}=await supabaseClient.auth.getSession();if(!session?.access_token)return;try{const response=await fetch('/.netlify/functions/notify-profile-ready',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});if(!response.ok)console.error('Unable to send profile-ready notification:',await response.text())}catch(error){console.error('Unable to send profile-ready notification:',error)}}"
profile = replace_once(profile, old_translation_function, new_translation_function, 'profile-ready helper insertion')
old_after_save = "unsavedChanges=false;setStatus('Your LymphAware profile has been saved. Any additional-language profile will now update automatically; its current version remains available while the update is prepared.');await requestLanguageTranslation();const destination=pendingNavigationUrl;"
new_after_save = "unsavedChanges=false;setStatus('Your LymphAware profile has been saved. Any additional-language profile will now update automatically; its current version remains available while the update is prepared.');await notifyProfileReady();await requestLanguageTranslation();const destination=pendingNavigationUrl;"
profile = replace_once(profile, old_after_save, new_after_save, 'profile-ready save hook')
profile_path.write_text(profile, encoding='utf-8')

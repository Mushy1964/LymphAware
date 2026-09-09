from pathlib import Path

# 1) Emergency-contact confirmation must never appear pre-confirmed when no contact exists.
profile_path = Path('profile-v2/index.html')
profile = profile_path.read_text(encoding='utf-8')
old = "emergencyNoticeCurrent=notice===true;const confirm=$('emergency-contact-confirmation');if(confirm)confirm.checked=emergencyNoticeCurrent&&emergencyKeyFromForm()===initialEmergencyKey;showConsentState()"
new = "const hasEmergency=Boolean($('emergency-name').value.trim()||$('emergency-relationship').value.trim()||$('emergency-phone').value.trim());emergencyNoticeCurrent=hasEmergency&&notice===true;const confirm=$('emergency-contact-confirmation');if(confirm)confirm.checked=hasEmergency&&emergencyNoticeCurrent&&emergencyKeyFromForm()===initialEmergencyKey;showConsentState()"
if old not in profile:
    raise SystemExit('Expected emergency-contact load-state pattern not found')
profile = profile.replace(old, new, 1)
old2 = "profile={...profile,...payload};initialEmergencyKey=currentEmergencyKey;emergencyNoticeCurrent=true;if($('emergency-contact-confirmation'))$('emergency-contact-confirmation').checked=hasEmergency;"
new2 = "profile={...profile,...payload};initialEmergencyKey=currentEmergencyKey;emergencyNoticeCurrent=hasEmergency;if($('emergency-contact-confirmation'))$('emergency-contact-confirmation').checked=hasEmergency;"
if old2 not in profile:
    raise SystemExit('Expected emergency-contact save-state pattern not found')
profile = profile.replace(old2, new2, 1)
profile_path.write_text(profile, encoding='utf-8')

# 2) Remove duplication between Preview language and the lower language section.
#    Preview language remains the member's normal control. The lower panel is now shown only
#    when a language genuinely needs attention / agreement / preparation.
portal_path = Path('portal/index.html')
portal = portal_path.read_text(encoding='utf-8')
old_html = '<div class="portal-language-profiles" id="language-profiles-panel" hidden><h3>Additional-language profiles</h3><p>Your translated profiles are automatically kept in step with your main English profile.</p><div id="language-profile-list" class="language-profile-list"></div></div>'
new_html = '<div class="portal-language-profiles" id="language-profiles-panel" hidden><h3>Language status</h3><p>We’ll only show an update here if one of your additional-language profiles is still being prepared or needs your attention.</p><div id="language-profile-list" class="language-profile-list"></div></div>'
if old_html not in portal:
    raise SystemExit('Expected portal language panel markup not found')
portal = portal.replace(old_html, new_html, 1)
old_logic = "configurePreviewLanguages(data||[]);\n  if(!data?.length){languageProfilesPanel.hidden=true;languageProfileList.innerHTML='';return []}\n  languageProfilesPanel.hidden=false;\n  languageProfileList.innerHTML='';\n  data.forEach(p=>{"
new_logic = "configurePreviewLanguages(data||[]);\n  if(!data?.length){languageProfilesPanel.hidden=true;languageProfileList.innerHTML='';return []}\n  const attentionProfiles=(data||[]).filter(p=>p.translation_error||!p.translation_consent_at||p.setup_status!=='APPROVED');\n  if(!attentionProfiles.length){languageProfilesPanel.hidden=true;languageProfileList.innerHTML='';return data}\n  languageProfilesPanel.hidden=false;\n  languageProfileList.innerHTML='';\n  attentionProfiles.forEach(p=>{"
if old_logic not in portal:
    raise SystemExit('Expected portal language rendering pattern not found')
portal = portal.replace(old_logic, new_logic, 1)
portal_path.write_text(portal, encoding='utf-8')

print('Portal language duplication and emergency-contact confirmation state corrected.')

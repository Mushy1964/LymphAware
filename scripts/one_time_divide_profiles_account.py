from pathlib import Path

path = Path('portal/index.html')
text = path.read_text(encoding='utf-8')

marker = '/* LYMPHAWARE PROFILE ACCOUNT GROUPING */'
if marker in text:
    raise SystemExit('Profile account grouping already applied')

css = r'''

    /* LYMPHAWARE PROFILE ACCOUNT GROUPING */
    .profile-account-group{margin-top:24px}
    .profile-account-group + .profile-account-group,
    .profile-account-group + .account-management{
      margin-top:28px;
      padding-top:28px;
      border-top:1px solid #d5e0e6;
    }
    .profile-account-group-title{
      margin:0 0 5px;
      color:#17283d;
      font-size:1.2rem;
      line-height:1.3;
      font-weight:800;
    }
    .profile-account-group-intro{
      margin:0 0 14px!important;
      color:#566575!important;
      font-size:.98rem!important;
      line-height:1.5!important;
    }
    .profile-visibility-group .profile-visibility-control{margin-top:0}
    .profile-management-group .preview-language-control{margin-top:0}
    .profile-management-group .profile-management-actions{margin-top:16px}
    .profile-account-panel>.account-management{border-top:1px solid #d5e0e6}
    @media(max-width:680px){
      .profile-account-group{margin-top:20px}
      .profile-account-group + .profile-account-group,
      .profile-account-group + .account-management{margin-top:22px;padding-top:22px}
      .profile-account-group-title{font-size:1.12rem}
    }
'''

style_end = text.find('</style>')
if style_end == -1:
    raise SystemExit('Could not find </style>')
text = text[:style_end] + css + text[style_end:]

old_intro = '<p>Manage what people can see, preview each version of your QR profile and update your account.</p>'
new_intro = '<p>Control your QR profile, manage the information you share and update your account.</p>'
if old_intro not in text:
    raise SystemExit('Could not find Profiles & account intro')
text = text.replace(old_intro, new_intro, 1)

old_visibility_start = '''          <div class="profile-visibility-control">'''
new_visibility_start = '''          <div class="profile-account-group profile-visibility-group">
            <h3 class="profile-account-group-title">QR profile visibility</h3>
            <p class="profile-account-group-intro">Choose whether people who scan your LymphAware card can view the profile information you have chosen to share.</p>
            <div class="profile-visibility-control">'''
if old_visibility_start not in text:
    raise SystemExit('Could not find visibility control start')
text = text.replace(old_visibility_start, new_visibility_start, 1)

old_visibility_end = '''          <p id="profile-visibility-message" role="status" aria-live="polite"></p>
          <div id="preview-language-control" class="preview-language-control" hidden>'''
new_visibility_end = '''            <p id="profile-visibility-message" role="status" aria-live="polite"></p>
          </div>
          <div class="profile-account-group profile-management-group">
            <h3 class="profile-account-group-title">Manage &amp; preview your profile</h3>
            <p class="profile-account-group-intro">Edit your information, choose a purchased language and preview exactly what your card and QR profile will show.</p>
            <div id="preview-language-control" class="preview-language-control" hidden>'''
if old_visibility_end not in text:
    raise SystemExit('Could not find visibility-to-preview boundary')
text = text.replace(old_visibility_end, new_visibility_end, 1)

old_management_end = '''          <div class="portal-language-profiles" id="language-profiles-panel" hidden><h3>Language status</h3><p>We’ll only show an update here if one of your additional-language profiles is still being prepared or needs your attention.</p><div id="language-profile-list" class="language-profile-list"></div></div>
          <div class="account-management">'''
new_management_end = '''            <div class="portal-language-profiles" id="language-profiles-panel" hidden><h3>Language status</h3><p>We’ll only show an update here if one of your additional-language profiles is still being prepared or needs your attention.</p><div id="language-profile-list" class="language-profile-list"></div></div>
          </div>
          <div class="account-management">'''
if old_management_end not in text:
    raise SystemExit('Could not find management-to-account boundary')
text = text.replace(old_management_end, new_management_end, 1)

path.write_text(text, encoding='utf-8')
print('Divided Profiles & account into clearer visibility, profile-management and account sections.')

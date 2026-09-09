from pathlib import Path
import re

path = Path('portal/index.html')
text = path.read_text(encoding='utf-8')

marker = '/* LYMPHAWARE QR VISIBILITY EMPHASIS */'
if marker in text:
    raise SystemExit('QR visibility emphasis already applied')

css = r'''

    /* LYMPHAWARE QR VISIBILITY EMPHASIS */
    .profile-visibility-control{
      margin-top:22px;
      padding:22px 24px;
      border:2px solid #aabac4;
      border-radius:16px;
      background:#f7fafb;
      box-shadow:0 7px 18px rgba(31,47,66,.06);
      transition:border-color .2s ease,background .2s ease,box-shadow .2s ease;
    }
    .profile-visibility-control:has(#portal-profile-visible:checked){
      border-color:#16853f;
      background:#f1f8f3;
      box-shadow:0 7px 20px rgba(22,133,63,.10);
    }
    .profile-visibility-copy{flex:1 1 auto;min-width:0}
    .profile-visibility-copy strong{
      font-size:1.2rem;
      line-height:1.3;
      color:#17283d;
    }
    .profile-visibility-copy p{
      margin-top:7px;
      color:#4e5f6e;
      font-size:1rem;
      line-height:1.5;
    }
    .portal-switch{
      width:100px;
      height:46px;
      cursor:pointer;
    }
    .portal-switch input:disabled + .portal-switch-track{opacity:.62;cursor:wait}
    .portal-switch-track{
      position:relative;
      border:2px solid #6f818c;
      background:#6f818c;
      box-shadow:none;
    }
    .portal-switch-track::before{
      content:"OFF";
      position:absolute;
      top:50%;
      right:13px;
      transform:translateY(-50%);
      color:#fff;
      font-size:.78rem;
      line-height:1;
      font-weight:800;
      letter-spacing:.04em;
    }
    .portal-switch-track:after{
      top:4px;
      left:4px;
      width:34px;
      height:34px;
      box-shadow:0 2px 7px rgba(0,0,0,.24);
    }
    .portal-switch input:checked + .portal-switch-track{
      border-color:#16853f;
      background:#16853f;
    }
    .portal-switch input:checked + .portal-switch-track::before{
      content:"ON";
      left:15px;
      right:auto;
    }
    .portal-switch input:checked + .portal-switch-track:after{
      transform:translateX(54px);
    }
    .portal-switch input:focus-visible + .portal-switch-track{
      outline:4px solid rgba(22,133,63,.20);
      outline-offset:3px;
    }
    .profile-visibility-warning{
      margin-top:12px!important;
      padding:13px 15px;
      border-left:4px solid #1768b0;
      border-radius:0 10px 10px 0;
      background:#f4f9fc;
      color:#344456!important;
      font-size:.95rem!important;
      line-height:1.55!important;
    }
    .profile-visibility-consent-note{
      display:block;
      margin-top:5px;
      color:#566575;
    }
    @media(max-width:680px){
      .profile-visibility-control{padding:20px 18px;gap:14px}
      .portal-switch{width:92px;height:44px}
      .portal-switch-track:after{width:32px;height:32px}
      .portal-switch input:checked + .portal-switch-track:after{transform:translateX(48px)}
    }
'''

# Insert override CSS immediately before the page's closing style tag.
style_end = text.find('</style>')
if style_end == -1:
    raise SystemExit('Could not find </style>')
text = text[:style_end] + css + text[style_end:]

html_pattern = re.compile(
    r'<div class="profile-visibility-control">\s*'
    r'<div class="profile-visibility-copy"><strong id="portal-visibility-title">.*?</strong><p id="portal-visibility-copy">.*?</p></div>\s*'
    r'<label class="portal-switch" aria-label="[^"]+"><input id="portal-profile-visible" type="checkbox"><span class="portal-switch-track"></span></label>\s*'
    r'</div>\s*'
    r'<p class="field-note"><strong>Before switching your profile on:</strong>.*?</p>',
    re.S,
)
html_replacement = '''<div class="profile-visibility-control">
            <div class="profile-visibility-copy">
              <strong id="portal-visibility-title">Make my QR profile available</strong>
              <p id="portal-visibility-copy">People who scan your LymphAware card cannot currently view your QR profile.</p>
            </div>
            <label class="portal-switch" title="Turn QR profile visibility on or off">
              <input id="portal-profile-visible" type="checkbox" role="switch" aria-label="Make my QR profile available" aria-describedby="portal-visibility-copy profile-visibility-warning">
              <span class="portal-switch-track" aria-hidden="true"></span>
            </label>
          </div>
          <p id="profile-visibility-warning" class="field-note profile-visibility-warning"><strong>Before turning this on:</strong> anyone with your QR link can view the information you have chosen to share. Please preview your profile first.<span class="profile-visibility-consent-note">Your health-data consent is recorded separately in My Profile and must already be active before the QR profile can be made available.</span></p>'''
text, count = html_pattern.subn(html_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'Expected one visibility HTML block, found {count}')

old_fn = "function setPortalVisibilityCopy(visible){profileVisibleSwitch.checked=visible;visibilityTitle.textContent=visible?'QR profiles shown':'QR profiles hidden';visibilityCopy.textContent=visible?'People scanning your LymphAware card can view your English and additional-language profiles.':'People scanning your cards will see that your profiles are currently unavailable.'}"
new_fn = "function setPortalVisibilityCopy(visible){profileVisibleSwitch.checked=visible;visibilityTitle.textContent='Make my QR profile available';visibilityCopy.textContent=visible?'People who scan your LymphAware card can view the information you have chosen to share.':'People who scan your LymphAware card cannot currently view your QR profile.'}"
if old_fn not in text:
    raise SystemExit('Could not find setPortalVisibilityCopy function')
text = text.replace(old_fn, new_fn, 1)

old_status = "visibilityMessage.textContent=next?'Your English and additional-language QR profiles are now shown.':'Your English and additional-language QR profiles are now hidden.';"
new_status = "visibilityMessage.textContent=next?'Your QR profile is now available to anyone with the QR link.':'Your QR profile is no longer available to people who scan your card.';"
if old_status not in text:
    raise SystemExit('Could not find visibility success message')
text = text.replace(old_status, new_status, 1)

path.write_text(text, encoding='utf-8')
print('Strengthened QR profile visibility control and wording.')

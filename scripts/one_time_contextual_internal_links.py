from pathlib import Path

# Homepage: add visually neutral contextual links using wording that already exists.
index = Path('index.html')
text = index.read_text(encoding='utf-8')

style_marker = '    /* Distinct LymphAware membership packages */\n'
style_rule = '''    /* Visually neutral contextual links for internal site structure */\n    .home-page .contextual-internal-link,\n    .home-page .contextual-internal-link:visited,\n    .home-page .contextual-internal-link:hover,\n    .home-page .contextual-internal-link:active {\n      color: inherit;\n      text-decoration: none;\n    }\n\n'''
if '.home-page .contextual-internal-link' not in text:
    if style_marker not in text:
        raise SystemExit('Homepage style insertion marker not found')
    text = text.replace(style_marker, style_rule + style_marker, 1)

replacements = {
    '<h2>How LymphAware works</h2>': '<h2><a class="contextual-internal-link" href="/how-it-works/">How LymphAware works</a></h2>',
    'Living with lymphoedema can mean repeatedly having to explain': 'Living with <a class="contextual-internal-link" href="/understanding-lymphoedema/">lymphoedema</a> can mean repeatedly having to explain',
    'Help healthcare professionals understand important information': 'Help <a class="contextual-internal-link" href="/for-professionals/">healthcare professionals</a> understand important information',
}
for old, new in replacements.items():
    if new in text:
        continue
    if old not in text:
        raise SystemExit(f'Homepage target not found: {old}')
    text = text.replace(old, new, 1)

index.write_text(text, encoding='utf-8')

# Contact page: turn existing phrase into a visually neutral contextual link.
contact = Path('contact/index.html')
ct = contact.read_text(encoding='utf-8')

contact_style_marker = '    .contact-form-layout {\n'
contact_style_rule = '''    .contextual-internal-link,\n    .contextual-internal-link:visited,\n    .contextual-internal-link:hover,\n    .contextual-internal-link:active {\n      color: inherit;\n      text-decoration: none;\n    }\n\n'''
if '    .contextual-internal-link,' not in ct:
    if contact_style_marker not in ct:
        raise SystemExit('Contact style insertion marker not found')
    ct = ct.replace(contact_style_marker, contact_style_rule + contact_style_marker, 1)

old = 'Professionals may want to understand how LymphAware works or\n              provide appropriate feedback as the service develops.'
new = 'Professionals may want to understand <a class="contextual-internal-link" href="/how-it-works/">how LymphAware works</a> or\n              provide appropriate feedback as the service develops.'
if new not in ct:
    if old not in ct:
        raise SystemExit('Contact contextual-link target not found')
    ct = ct.replace(old, new, 1)

contact.write_text(ct, encoding='utf-8')
print('Added visually neutral contextual internal links to public pages.')

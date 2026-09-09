from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

portal_path = Path('portal/index.html')
portal = portal_path.read_text(encoding='utf-8')

portal = replace_once(
    portal,
    "previewLink.href=selected.qr_token?`/p/${encodeURIComponent(selected.qr_token)}`:'/preview/';",
    "previewLink.href=selected.qr_token?`/preview/?language=${encodeURIComponent(code)}`:'/preview/';",
    'portal language preview link'
)

portal = replace_once(
    portal,
    'href=\"/p/${encodeURIComponent(p.qr_token)}\" target=\"_blank\" rel=\"noopener\">Preview ${escapeHtml(p.language_name)} profile</a>',
    'href=\"/preview/?language=${encodeURIComponent(String(p.language_code||\'\').toUpperCase())}\">Preview ${escapeHtml(p.language_name)} profile</a>',
    'portal additional-language profile action'
)

portal_path.write_text(portal, encoding='utf-8')

card_path = Path('card-preview/index.html')
card = card_path.read_text(encoding='utf-8')

card = replace_once(
    card,
    '.card-preview-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}\n    .card-preview-actions .button{font-size:17px;font-weight:700}',
    '.card-preview-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:20px}\n    .card-preview-actions .button{display:flex;align-items:center;justify-content:center;min-height:52px;padding:10px 12px;font-size:16px;font-weight:700;text-align:center;line-height:1.2}',
    'card preview equal actions'
)

card = replace_once(
    card,
    '.card-preview-actions{flex-direction:column}\n      .card-preview-actions .button{width:100%}',
    '.card-preview-actions{grid-template-columns:1fr}\n      .card-preview-actions .button{width:100%}',
    'card preview mobile actions'
)

card = replace_once(
    card,
    'matchingProfileHref=`/p/${encodeURIComponent(languageProfile.qr_token)}`;',
    'matchingProfileHref=`/preview/?language=${encodeURIComponent(language)}`;',
    'card matching profile link'
)

card_path.write_text(card, encoding='utf-8')

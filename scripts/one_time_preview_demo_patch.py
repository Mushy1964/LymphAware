from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

# Make the two navigation buttons exactly the same fixed width on both member preview pages.
for path_str, cls in [
    ('preview/index.html', 'preview-actions'),
    ('card-preview/index.html', 'card-preview-actions'),
]:
    path = Path(path_str)
    text = path.read_text(encoding='utf-8')
    if cls == 'preview-actions':
        old = '.preview-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:min(100%,430px);margin:10px auto 0}'
        new = '.preview-actions{display:grid;grid-template-columns:repeat(2,210px);gap:10px;width:max-content;max-width:100%;margin:10px auto 0}'
    else:
        old = '.card-preview-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:min(100%,430px);margin:18px auto 0}'
        new = '.card-preview-actions{display:grid;grid-template-columns:repeat(2,210px);gap:10px;width:max-content;max-width:100%;margin:18px auto 0}'
    text = replace_once(text, old, new, f'{cls} desktop width')
    path.write_text(text, encoding='utf-8')

# Add a Return to website control only for the fictional Alex Morgan demo profile.
path = Path('p-v3/index.html')
text = path.read_text(encoding='utf-8')
text = replace_once(
    text,
    '.message p{color:#566575}.hidden{display:none!important}',
    '.message p{color:#566575}.demo-return{display:flex;justify-content:center;margin:14px auto 0}.demo-return .button{display:flex;align-items:center;justify-content:center;width:210px;min-height:48px;padding:9px 12px;font-size:15.5px;font-weight:700;text-align:center;line-height:1.2}.hidden{display:none!important}',
    'demo return styles'
)
text = replace_once(
    text,
    '</div></article>\n</div></main>',
    '</div></article>\n<div id="demo-return" class="demo-return hidden"><a href="/" class="button button-secondary">Return to website</a></div>\n</div></main>',
    'demo return markup'
)
text = replace_once(
    text,
    "const ICONS={standing:'standing.png',seating:'seating.png',time:'extra-time.png',mobility:'mobility.png','extra-space':'extra-space.png',understanding:'understanding.png'};",
    "const ICONS={standing:'standing.png',seating:'seating.png',time:'extra-time.png',mobility:'mobility.png','extra-space':'extra-space.png',understanding:'understanding.png'};\nconst DEMO_PROFILE_TOKEN='1babe83a-9ad9-4999-a7c4-658b1400b044';",
    'demo token constant'
)
text = replace_once(
    text,
    "(async()=>{const tk=token();if(!tk){loading.classList.add('hidden');error.classList.remove('hidden');return}try{",
    "(async()=>{const tk=token();if(!tk){loading.classList.add('hidden');error.classList.remove('hidden');return}if(tk===DEMO_PROFILE_TOKEN)document.getElementById('demo-return').classList.remove('hidden');try{",
    'demo return activation'
)
path.write_text(text, encoding='utf-8')

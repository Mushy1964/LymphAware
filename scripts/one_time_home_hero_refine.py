from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

# Strengthen the first homepage reassurance statement.
index_path = Path('index.html')
index = index_path.read_text(encoding='utf-8')
index = replace_once(
    index,
    '<strong>Useful in many situations</strong>',
    '<strong>Be understood when it matters</strong>',
    'homepage reassurance wording'
)
index_path.write_text(index, encoding='utf-8')

# Rebalance desktop/tablet hero spacing without changing the phone layout.
css_path = Path('css/home.css')
css = css_path.read_text(encoding='utf-8')
marker = '\n\n/* PRODUCT VISUAL */\n'
override = '''\n\n/* Desktop/tablet hero spacing refinement */\n@media (min-width: 681px) {\n  .home-page .home-hero-copy {\n    margin-bottom: 40px;\n  }\n\n  .home-page .home-hero-reassurance {\n    margin-top: 34px;\n  }\n}\n'''
if override.strip() in css:
    raise SystemExit('desktop/tablet hero spacing override already present')
css = replace_once(css, marker, override + marker, 'home hero spacing insertion point')
css_path.write_text(css, encoding='utf-8')

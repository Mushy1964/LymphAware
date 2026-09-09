from pathlib import Path

path = Path('css/styles.css')
css = path.read_text(encoding='utf-8')
marker = '/* LYMPHAWARE DESKTOP HEADER ACTION SIZE */'
block = '''\n\n/* LYMPHAWARE DESKTOP HEADER ACTION SIZE */\n/* Keep the top-right customer/admin header action consistent between pages. */\n@media (min-width: 901px) {\n  .site-header .header-actions > .button {\n    width: 180px !important;\n    min-width: 180px !important;\n    max-width: 180px !important;\n    min-height: 56px !important;\n    padding: 0 18px !important;\n    align-items: center !important;\n    justify-content: center !important;\n    border-radius: 10px !important;\n    white-space: nowrap !important;\n  }\n}\n'''
if marker in css:
    raise SystemExit('Desktop header action size block already exists')
path.write_text(css.rstrip() + block, encoding='utf-8')
print('Standardised desktop header action buttons.')

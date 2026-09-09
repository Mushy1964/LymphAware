from pathlib import Path

path = Path('netlify/functions/member-package-summary.mjs')
text = path.read_text(encoding='utf-8')

replacements = {
    '2 lanyards & holders': '2 Lanyards & holders',
    '1 lanyard & holder': '1 Lanyard & holder',
    "label: `lanyard${lanyardQuantity === 1 ? '' : 's'} & holder${lanyardQuantity === 1 ? '' : 's'}`": "label: `Lanyard${lanyardQuantity === 1 ? '' : 's'} & holder${lanyardQuantity === 1 ? '' : 's'}`",
}

changed = False
for old, new in replacements.items():
    if old in text:
        text = text.replace(old, new)
        changed = True

if not changed:
    raise SystemExit('No order lanyard labels needed changing')

path.write_text(text, encoding='utf-8')
print('Capitalised customer-facing Lanyard labels.')

from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')
old = '''          <img src="/assets/demo/LymphAware_Hero_Final_Top.png" alt="" aria-hidden="true">\n          <img src="/assets/demo/LymphAware_Hero_Final_Middle.png" alt="" aria-hidden="true">\n          <img src="/assets/demo/LymphAware_Hero_Final_Bottom.png" alt="" aria-hidden="true">'''
new = '''          <img src="/assets/demo/LymphAware_Hero_Transparent_v1.webp" alt="" aria-hidden="true">'''
if old not in text:
    raise SystemExit('Existing three-slice homepage hero not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Replaced homepage hero slices with approved transparent hero image.')

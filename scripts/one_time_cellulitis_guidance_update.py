from pathlib import Path

# Update the existing patient-facing cellulitis awareness box without adding treatment instructions.
patient = Path('understanding-lymphoedema/index.html')
text = patient.read_text(encoding='utf-8')
old = '''          <h3>Cellulitis awareness</h3>\n\n          <p>\n            People living with lymphoedema have an increased risk of\n            cellulitis, a bacterial infection of the deeper layers of the skin\n            which can lead to sepsis if left untreated.\n          </p>\n\n          <p>\n            Any cellulitis information presented through LymphAware should be\n            reviewed carefully with appropriate healthcare input and should not\n            replace urgent professional medical assessment or advice.\n          </p>'''
new = '''          <h3>Cellulitis awareness</h3>\n\n          <p>\n            Cellulitis is an acute spreading infection of the skin and tissues\n            beneath it and is an important complication of lymphoedema. It can\n            cause pain, warmth, increased swelling and redness or inflammation,\n            and some people may also feel generally unwell or develop a fever.\n          </p>\n\n          <p>\n            Cellulitis can be difficult to diagnose and its treatment in someone\n            with lymphoedema may need particular clinical consideration. If you\n            think you may have cellulitis, seek medical advice promptly.\n          </p>\n\n          <p>\n            This is awareness information only. LymphAware does not diagnose\n            cellulitis, provide treatment instructions or replace professional\n            medical advice or emergency care.\n          </p>'''
if old not in text:
    raise SystemExit('Existing patient cellulitis block not found')
text = text.replace(old, new, 1)
patient.write_text(text, encoding='utf-8')

# Add a professional guidance reference using the existing page design language.
professionals = Path('for-professionals/index.html')
ptext = professionals.read_text(encoding='utf-8')
marker = '''    <section class="content-section privacy-section">\n      <div class="container">\n\n        <div class="mission-box">\n\n          <h2>Designed to support communication, not replace professional judgement.</h2>'''
insert = '''    <section class="content-section privacy-section">\n      <div class="container split-section">\n\n        <div class="split-copy">\n\n          <p class="eyebrow">Clinical guidance</p>\n          <h2>Cellulitis in lymphoedema</h2>\n\n          <p>\n            Cellulitis is an important complication of lymphoedema and its\n            presentation and management may differ from cellulitis in other\n            clinical situations. Prompt assessment and treatment are important.\n          </p>\n\n          <p>\n            LymphAware does not provide prescribing guidance and does not\n            reproduce antibiotic or dosing instructions. Clinical decisions\n            should be based on current professional guidance and the individual\n            patient's circumstances.\n          </p>\n\n        </div>\n\n        <div class="highlight-box">\n\n          <h3>Current BLS / LSN guidance</h3>\n\n          <p>\n            The British Lymphology Society and Lymphoedema Support Network\n            publish professional guidance on the management of cellulitis in\n            lymphoedema. The current document is dated August 2025.\n          </p>\n\n          <p>\n            The guidance states that prescribing decisions should be made in\n            the context of the complete document.\n          </p>\n\n          <p>\n            <a\n              class="button button-secondary"\n              href="https://www.thebls.com/public/uploads/documents/document-91311757952788.pdf"\n              target="_blank"\n              rel="noopener noreferrer"\n            >View BLS / LSN cellulitis guidance</a>\n          </p>\n\n        </div>\n\n      </div>\n    </section>\n\n\n    <section class="content-section privacy-section">\n      <div class="container">\n\n        <div class="mission-box">\n\n          <h2>Designed to support communication, not replace professional judgement.</h2>'''
if marker not in ptext:
    raise SystemExit('Professional-page insertion marker not found')
ptext = ptext.replace(marker, insert, 1)
professionals.write_text(ptext, encoding='utf-8')

print('Updated patient cellulitis awareness and added BLS/LSN professional guidance reference.')

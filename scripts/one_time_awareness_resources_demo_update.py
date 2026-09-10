from pathlib import Path

# Homepage: extend the existing opening explanation without changing the approved heading/tagline.
home = Path('index.html')
text = home.read_text(encoding='utf-8')
old = '''        <p class="home-hero-copy">\n          LymphAware is a physical ID card linked to your\n          patient-controlled QR profile. It helps you share key\n          information quickly and clearly — so you can feel confident,\n          understood and in control.\n        </p>'''
new = '''        <p class="home-hero-copy">\n          LymphAware is a physical ID card linked to your\n          patient-controlled QR profile. It helps you share key\n          information quickly and clearly — so you can feel confident,\n          understood and in control. As its name suggests, LymphAware is\n          also an awareness tool — helping others better understand\n          lymphoedema and the practical ways it can affect the person\n          living with it.\n        </p>'''
if old not in text:
    raise SystemExit('Homepage opening statement not found')
text = text.replace(old, new, 1)
home.write_text(text, encoding='utf-8')

# Understanding Lymphoedema: add two authoritative external information sources.
page = Path('understanding-lymphoedema/index.html')
ptext = page.read_text(encoding='utf-8')
marker = '''    <section class="content-section privacy-section">\n      <div class="container">\n\n        <div class="mission-box">\n\n          <h2>Helping people understand the person, not just the condition.</h2>'''
insert = '''    <section class="content-section privacy-section">\n      <div class="container">\n\n        <div class="section-heading">\n          <p class="eyebrow">Further information</p>\n          <h2>Trusted sources about lymphoedema</h2>\n          <p>\n            For broader information about lymphoedema, its symptoms,\n            management and available support, these independent sources may\n            also be helpful.\n          </p>\n        </div>\n\n        <div class="privacy-grid">\n          <article class="privacy-card">\n            <h3>British Lymphology Society (BLS)</h3>\n            <p>\n              The BLS provides specialist information about lymphoedema and\n              the lymphatic system, together with professional and patient\n              resources.\n            </p>\n            <p>\n              <a class="button button-secondary" href="https://www.thebls.com/pages/what-is-lymphoedema" target="_blank" rel="noopener noreferrer">Visit BLS lymphoedema information</a>\n            </p>\n          </article>\n\n          <article class="privacy-card">\n            <h3>NHS</h3>\n            <p>\n              The NHS provides an overview of lymphoedema including symptoms,\n              causes, diagnosis, treatment and possible complications.\n            </p>\n            <p>\n              <a class="button button-secondary" href="https://www.nhs.uk/conditions/lymphoedema/" target="_blank" rel="noopener noreferrer">Read NHS lymphoedema information</a>\n            </p>\n          </article>\n        </div>\n\n      </div>\n    </section>\n\n\n    <section class="content-section privacy-section">\n      <div class="container">\n\n        <div class="mission-box">\n\n          <h2>Helping people understand the person, not just the condition.</h2>'''
if marker not in ptext:
    raise SystemExit('Understanding Lymphoedema insertion marker not found')
ptext = ptext.replace(marker, insert, 1)
page.write_text(ptext, encoding='utf-8')

print('Updated homepage awareness wording and added BLS/NHS information links.')

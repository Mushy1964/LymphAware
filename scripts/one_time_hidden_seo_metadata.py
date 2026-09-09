from pathlib import Path

index = Path('index.html')
text = index.read_text(encoding='utf-8')

marker = '<!-- LYMPHAWARE HOMEPAGE SEO METADATA -->'
if marker not in text:
    title = '  <title>LymphAware | Helping People Living with Lymphoedema Be Understood</title>\n'
    if title not in text:
        raise SystemExit('Homepage title marker not found')
    metadata = '''  <title>LymphAware | Helping People Living with Lymphoedema Be Understood</title>\n\n  <!-- LYMPHAWARE HOMEPAGE SEO METADATA -->\n  <meta name="description" content="LymphAware is a patient-controlled lymphoedema ID card linked to a QR profile, helping you share important information and be better understood.">\n  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">\n  <link rel="canonical" href="https://lymphaware.com/">\n\n  <meta property="og:type" content="website">\n  <meta property="og:site_name" content="LymphAware">\n  <meta property="og:locale" content="en_GB">\n  <meta property="og:url" content="https://lymphaware.com/">\n  <meta property="og:title" content="LymphAware | Helping People Living with Lymphoedema Be Understood">\n  <meta property="og:description" content="A patient-controlled lymphoedema ID card linked to a QR profile, helping you share important information and be better understood.">\n\n  <meta name="twitter:card" content="summary">\n  <meta name="twitter:title" content="LymphAware | Helping People Living with Lymphoedema Be Understood">\n  <meta name="twitter:description" content="A patient-controlled lymphoedema ID card linked to a QR profile, helping you share important information and be better understood.">\n\n  <script type="application/ld+json">\n  {\n    "@context": "https://schema.org",\n    "@type": "WebSite",\n    "name": "LymphAware",\n    "url": "https://lymphaware.com/",\n    "description": "LymphAware is a patient-controlled lymphoedema ID card linked to a QR profile, helping people living with lymphoedema share important information and be better understood.",\n    "inLanguage": "en-GB"\n  }\n  </script>\n'''
    text = text.replace(title, metadata, 1)
    index.write_text(text, encoding='utf-8')

robots = Path('robots.txt')
robots.write_text('''User-agent: *\nAllow: /\n\nDisallow: /admin/\nDisallow: /portal/\nDisallow: /profile/\nDisallow: /profile-v2/\nDisallow: /preview/\nDisallow: /card-preview/\nDisallow: /sign-in/\nDisallow: /forgot-password/\nDisallow: /reset-password/\nDisallow: /account-deleted/\nDisallow: /p/\nDisallow: /p-v2/\nDisallow: /p-v3/\nDisallow: /ebp/\n\nSitemap: https://lymphaware.com/sitemap.xml\n''', encoding='utf-8')

sitemap = Path('sitemap.xml')
sitemap.write_text('''<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://lymphaware.com/</loc><priority>1.0</priority></url>\n  <url><loc>https://lymphaware.com/about/</loc><priority>0.8</priority></url>\n  <url><loc>https://lymphaware.com/understanding-lymphoedema/</loc><priority>0.9</priority></url>\n  <url><loc>https://lymphaware.com/how-it-works/</loc><priority>0.9</priority></url>\n  <url><loc>https://lymphaware.com/for-professionals/</loc><priority>0.8</priority></url>\n  <url><loc>https://lymphaware.com/help/</loc><priority>0.7</priority></url>\n  <url><loc>https://lymphaware.com/privacy/</loc><priority>0.5</priority></url>\n  <url><loc>https://lymphaware.com/terms/</loc><priority>0.4</priority></url>\n  <url><loc>https://lymphaware.com/cookies/</loc><priority>0.3</priority></url>\n  <url><loc>https://lymphaware.com/accessibility/</loc><priority>0.5</priority></url>\n  <url><loc>https://lymphaware.com/contact/</loc><priority>0.6</priority></url>\n</urlset>\n''', encoding='utf-8')

print('Added hidden homepage SEO metadata, robots.txt and sitemap.xml without changing visible page content.')

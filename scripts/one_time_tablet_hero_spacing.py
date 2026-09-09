from pathlib import Path

path = Path('css/home.css')
text = path.read_text(encoding='utf-8')

old = '''/* Desktop/tablet hero spacing refinement */
@media (min-width: 681px) {
  .home-page .home-hero-copy {
    margin-bottom: 40px;
  }

  .home-page .home-hero-reassurance {
    margin-top: 34px;
  }
}
'''

new = '''/* Desktop/tablet hero spacing refinement */
@media (min-width: 681px) {
  .home-page .home-hero-copy {
    margin-bottom: 40px;
  }

  .home-page .home-hero-reassurance {
    margin-top: 34px;
  }
}

/* Tablet-only spacing: give the hero controls a little more breathing room */
@media (min-width: 681px) and (max-width: 1100px) {
  .home-page .home-hero-copy {
    margin-bottom: 52px;
  }

  .home-page .home-hero-reassurance {
    margin-top: 44px;
  }
}
'''

count = text.count(old)
if count != 1:
    raise SystemExit(f'Expected one desktop/tablet spacing block, found {count}')

path.write_text(text.replace(old, new, 1), encoding='utf-8')

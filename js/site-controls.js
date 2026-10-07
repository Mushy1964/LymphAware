(() => {
  async function load() {
    try {
      const response = await fetch('/api/registration-settings', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) return;

      const controls = data?.controls || {};
      window.LymphAwareControls = controls;
      window.dispatchEvent(new CustomEvent('lymphaware:controls', { detail: controls }));

      const announcement = controls?.announcement;
      if (!announcement?.active || !announcement.message || document.querySelector('.site-announcement')) return;

      const style = document.createElement('style');
      style.textContent = '.site-announcement{background:#eef8fc;border-bottom:1px solid #c9e1ea;color:#17354f}.site-announcement-inner{max-width:1180px;margin:0 auto;padding:10px 20px;text-align:center;font:700 15px/1.45 Arial,sans-serif}.site-announcement strong{color:#0053b7}@media(max-width:600px){.site-announcement-inner{padding:9px 14px;font-size:14px}}';
      document.head.appendChild(style);

      const banner = document.createElement('div');
      banner.className = 'site-announcement';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      const inner = document.createElement('div');
      inner.className = 'site-announcement-inner';
      const strong = document.createElement('strong');
      strong.textContent = 'LymphAware ID: ';
      inner.appendChild(strong);
      inner.appendChild(document.createTextNode(announcement.message));
      banner.appendChild(inner);

      const header = document.querySelector('.site-header');
      if (header?.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);
      else document.body.prepend(banner);
    } catch (error) {
      console.error('Unable to load LymphAware ID website controls:', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, { once: true });
  else load();
})();

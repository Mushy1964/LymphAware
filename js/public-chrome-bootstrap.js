(() => {
  const path = window.location.pathname;
  const publicPaths = new Set([
    '/',
    '/about/',
    '/understanding-lymphoedema/',
    '/for-professionals/',
    '/privacy/',
    '/help/',
    '/contact/',
    '/accessibility/',
    '/cookies/',
    '/terms/',
    '/how-it-works/',
    '/quick-guide/',
    '/emergency-contact-privacy/'
  ]);

  if (!publicPaths.has(path) && path !== '/404.html') return;

  const isHomepage = path === '/';

  const navItems = [
    { label: 'Understanding Lymphoedema', href: '/understanding-lymphoedema/' },
    { label: 'For Professionals', href: '/for-professionals/' },
    { label: 'Privacy & Security', href: '/privacy/' },
    { label: 'About LymphAware ID', href: '/about/' }
  ];

  const activeClass = href => path === href ? ' class="active" aria-current="page"' : '';
  const desktopNav = navItems.map(item => `<a href="${item.href}"${activeClass(item.href)}>${item.label}</a>`).join('');
  const mobileNav = navItems.map(item => `<a href="${item.href}">${item.label}</a>`).join('');

  const header = document.querySelector('header.site-header');
  if (header && isHomepage) {
    header.outerHTML = `
      <header class="site-header public-site-header">
        <div class="public-header-main">
          <div class="container public-header-inner">
            <a href="/" class="public-header-brand" aria-label="LymphAware ID home">
              <img class="public-site-logo" src="/assets/brand/LymphAwareID_Logo_20260921.svg" alt="LymphAware ID – Helping People Living with Lymphoedema Be Understood">
            </a>

            <form class="public-site-search" role="search" aria-label="Search LymphAware ID">
              <div class="public-search-shell">
                <span class="public-search-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6.25" fill="none" stroke="currentColor" stroke-width="2"></circle>
                    <path d="M15.2 15.2 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                  </svg>
                </span>
                <input type="search" name="q" autocomplete="off" placeholder="Search LymphAware ID..." aria-label="Search LymphAware ID">
              </div>
              <div class="public-search-results" role="listbox" hidden></div>
            </form>

            <details class="public-help-menu">
              <summary><span class="public-help-icon" aria-hidden="true">?</span><span>Help</span></summary>
              <nav class="public-help-panel" aria-label="Help menu">
                <a href="/help/">Help &amp; FAQs</a>
                <a href="/quick-guide/">Quick Guide</a>
                <a href="/contact/">Contact</a>
                <a href="/accessibility/">Accessibility</a>
                <a href="/cookies/">Cookies</a>
                <a href="/terms/">Terms &amp; Conditions</a>
              </nav>
            </details>

            <a href="/sign-in/" id="desktop-account-link" class="public-account-link">
              <svg class="public-account-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.1" fill="currentColor"/><path d="M5.8 19.2c.8-3.5 3-5.3 6.2-5.3s5.4 1.8 6.2 5.3" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>
              <span>Sign In</span>
            </a>

          </div>
        </div>
        <div class="public-mobile-brand-strip">
          <details class="public-mobile-menu">
            <summary>Menu</summary>
            <nav class="public-mobile-panel" aria-label="Mobile navigation">
              ${mobileNav}
              <a href="/help/">Help &amp; FAQs</a>
              <a href="/quick-guide/">Quick Guide</a>
              <a href="/contact/">Contact</a>
              <a href="/accessibility/">Accessibility</a>
              <a href="/cookies/">Cookies</a>
              <a href="/terms/">Terms &amp; Conditions</a>
              <a href="/sign-in/" id="mobile-account-link" class="public-mobile-account">Sign In</a>
              <button type="button" id="public-mobile-sign-out" class="public-mobile-sign-out" hidden>Sign Out</button>
            </nav>
            <div class="public-mobile-menu-bottom-spacer" aria-hidden="true"></div>
          </details>
        </div>
        <nav class="public-nav-bar" aria-label="Main navigation">
          <div class="container public-nav-inner">${desktopNav}</div>
        </nav>
      </header>`;
  } else if (header && header.classList.contains('secondary-header') && path !== '/404.html') {
    // Keep the original secondary-page header and its page-specific Return to website/portal controls.
    // Add only the shared blue navigation strip underneath it.
    header.insertAdjacentHTML('afterend', `
      <nav class="public-nav-bar public-nav-bar-secondary" aria-label="Main navigation">
        <div class="container public-nav-inner">${desktopNav}</div>
      </nav>`);
  }

  // The public announcement is controlled in Admin > Business Settings.
  // Create its allocated space immediately so an asynchronous check cannot
  // unexpectedly push the page down after it is displayed.
  const announcementTarget = document.querySelector('.public-nav-bar:last-of-type') ||
    document.querySelector('header.site-header');
  const announcementCacheKey = 'lymphaware-public-announcement-v2';
  const banner = document.createElement('div');
  banner.className = 'public-announcement is-pending';
  banner.setAttribute('aria-busy', 'true');
  banner.innerHTML = '<div class="public-announcement-frame"></div>';
  if (announcementTarget) announcementTarget.insertAdjacentElement('afterend', banner);

  let displayedAnnouncement = null;

  function showAnnouncement(config) {
    const message = String(config?.message || '').trim();
    if (!config?.enabled || !message) {
      displayedAnnouncement = null;
      banner.hidden = true;
      banner.classList.remove('is-pending');
      banner.removeAttribute('role');
      banner.removeAttribute('aria-label');
      banner.removeAttribute('aria-busy');
      return;
    }

    const configuredSpeed = Number(config?.scrollSpeed);
    const pixelsPerSecond = Number.isFinite(configuredSpeed)
      ? Math.min(120, Math.max(20, configuredSpeed)) : 55;
    const fingerprint = message + ':' + pixelsPerSecond;

    if (displayedAnnouncement === fingerprint && !banner.hidden) return;
    displayedAnnouncement = fingerprint;

    banner.hidden = false;
    banner.classList.remove('is-pending');
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-label', message);
    banner.removeAttribute('aria-busy');

    const safeMessage = message.replace(/[&<>"']/g,
      ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const group = '<div class="public-announcement-group"><span>' + safeMessage +
      '</span><span class="public-announcement-separator" aria-hidden="true">●</span></div>';

    banner.innerHTML = '<div class="public-announcement-frame">' +
      '<div class="public-announcement-window" aria-hidden="true">' +
      '<div class="public-announcement-track">' + group + group +
      '</div></div></div>';

    requestAnimationFrame(() => {
      // Do not render a stale asynchronous frame after an admin setting change.
      if (displayedAnnouncement !== fingerprint || banner.hidden) return;
      const frame = banner.querySelector('.public-announcement-frame');
      const track = banner.querySelector('.public-announcement-track');
      const first = track?.querySelector('.public-announcement-group');
      if (!frame || !track || !first) return;
      const step = Math.max(1, Math.ceil(first.getBoundingClientRect().width));
      const copies = Math.max(4, Math.ceil(frame.clientWidth / step) + 3);
      track.innerHTML = group.repeat(copies);
      banner.style.setProperty('--announcement-shift', '-' + step + 'px');
      banner.style.setProperty('--announcement-duration',
        Math.max(4, step / pixelsPerSecond) + 's');
    });
  }

  if (announcementTarget) {
    try {
      // Reuse the last verified banner on return navigation, without waiting
      // for another round-trip. The cache is per browser tab, not persistent.
      const cached = JSON.parse(sessionStorage.getItem(announcementCacheKey) || 'null');
      if (cached && typeof cached === 'object' && cached.announcement) {
        showAnnouncement(cached.announcement);
      }
    } catch {
      // Storage can be unavailable; the live request still works normally.
    }

    // Always revalidate so switching off or editing the banner in admin takes
    // effect without requiring a new browser session.
    fetch('/api/public-site-settings', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(settings => {
        if (!settings?.announcement) return;
        showAnnouncement(settings.announcement);
        try {
          sessionStorage.setItem(announcementCacheKey,
            JSON.stringify({ announcement: settings.announcement }));
        } catch {}
      })
      .catch(() => {
        // Preserve the last known banner during a transient network failure.
        // If there is no cached banner, the layout space remains reserved.
      });
  }

})();

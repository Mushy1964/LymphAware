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

  const searchPages = [
    { title: 'Understanding Lymphoedema', href: '/understanding-lymphoedema/', keywords: 'lymphoedema swelling symptoms causes treatment compression cellulitis lymphatic condition' },
    { title: 'For Professionals', href: '/for-professionals/', keywords: 'healthcare professionals clinician nurse doctor staff scan qr care' },
    { title: 'Privacy & Security', href: '/privacy/', keywords: 'privacy security personal information data consent gdpr' },
    { title: 'About LymphAware ID', href: '/about/', keywords: 'about lymphaware founder graham story lived experience' },
    { title: 'Help & FAQs', href: '/help/', keywords: 'help faq questions support account profile password card qr' },
    { title: 'How LymphAware ID Works', href: '/how-it-works/', keywords: 'how it works id card qr profile scan' },
    { title: 'Membership & Pricing', href: '/#membership', keywords: 'membership pricing price cost packages standard plus multilingual join' },
    { title: 'Quick Guide', href: '/quick-guide/', keywords: 'quick guide instructions getting started' },
    { title: 'Contact LymphAware ID', href: '/contact/', keywords: 'contact email enquiry support message' },
    { title: 'Accessibility', href: '/accessibility/', keywords: 'accessibility accessible screen reader keyboard' },
    { title: 'Cookies', href: '/cookies/', keywords: 'cookies tracking analytics' },
    { title: 'Terms of Use', href: '/terms/', keywords: 'terms conditions membership agreement' }
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

  const footer = document.querySelector('footer');
  if (footer) {
    footer.outerHTML = `
      <footer id="help" class="public-site-footer">
        <div class="container">
          <div class="public-footer-main">
            <a href="/" class="public-footer-brand" aria-label="LymphAware ID home">
              <img src="/assets/brand/LymphAwareID_Logo_No_Tagline_20260921.svg" alt="LymphAware ID">
            </a>
            <nav class="public-footer-primary" aria-label="Footer navigation">
              <a href="/understanding-lymphoedema/">Understanding Lymphoedema</a>
              <a href="/privacy/">Privacy &amp; Security</a>
              <a href="/for-professionals/">For Professionals</a>
              <a href="/about/">About LymphAware ID</a>
            </nav>
            <div class="public-footer-meta">
              <p class="public-footer-copyright">© <span data-public-year></span> LymphAware ID. All rights reserved.</p>
              <nav class="public-footer-utility" aria-label="Footer information links">
                <a href="/help/">Help</a>
                <a href="/contact/">Contact</a>
                <a href="/accessibility/">Accessibility</a>
                <a href="/cookies/">Cookies</a>
                <a href="/terms/">Terms</a>
                <a href="/privacy/">Privacy</a>
              </nav>
            </div>
          </div>
          <div class="public-footer-note">LymphAware ID is a communication and identification aid. It does not provide medical diagnosis or replace professional medical advice.</div>
        </div>
      </footer>`;
  }

  document.querySelectorAll('[data-public-year]').forEach(node => { node.textContent = new Date().getFullYear(); });

  const searchForm = document.querySelector('.public-site-search');
  if (searchForm) {
    const input = searchForm.querySelector('input[type="search"]');
    const results = searchForm.querySelector('.public-search-results');

    const findMatches = value => {
      const query = String(value || '').trim().toLowerCase();
      if (!query) return [];
      return searchPages
        .map(page => {
          const haystack = `${page.title} ${page.keywords}`.toLowerCase();
          const score = page.title.toLowerCase().startsWith(query) ? 3 : page.title.toLowerCase().includes(query) ? 2 : haystack.includes(query) ? 1 : 0;
          return { ...page, score };
        })
        .filter(page => page.score > 0)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
        .slice(0, 6);
    };

    const renderResults = () => {
      const query = input.value.trim();
      if (!query) {
        results.hidden = true;
        results.innerHTML = '';
        return [];
      }
      const matches = findMatches(query);
      results.innerHTML = matches.length
        ? matches.map(page => `<button type="button" class="public-search-result" data-href="${page.href}" role="option">${page.title}</button>`).join('')
        : '<div class="public-search-empty">No matching page found. Try Help or Contact.</div>';
      results.hidden = false;
      results.querySelectorAll('[data-href]').forEach(button => {
        button.addEventListener('click', () => { window.location.href = button.dataset.href; });
      });
      return matches;
    };

    input.addEventListener('input', renderResults);
    input.addEventListener('focus', () => { if (input.value.trim()) renderResults(); });
    input.addEventListener('blur', () => window.setTimeout(() => { results.hidden = true; }, 140));
    searchForm.addEventListener('submit', event => {
      event.preventDefault();
      const matches = findMatches(input.value);
      if (matches[0]) window.location.href = matches[0].href;
      else renderResults();
    });
  }

  document.addEventListener('click', event => {
    document.querySelectorAll('.public-help-menu[open], .public-mobile-menu[open]').forEach(details => {
      if (!details.contains(event.target)) details.removeAttribute('open');
    });
  });

  const desktopAccountLink = document.getElementById('desktop-account-link');
  const mobileAccountLink = document.getElementById('mobile-account-link');
  const updateAccountLink = session => {
    const signedIn = Boolean(session?.user);
    [desktopAccountLink, mobileAccountLink].forEach(link => {
      if (!link) return;
      link.href = signedIn ? '/portal/' : '/sign-in/';
      const textTarget = link.querySelector('span') || link;
      textTarget.textContent = signedIn ? 'Patient Portal' : 'Sign In';
    });
  };

  if (window.supabase?.createClient) {
    try {
      const client = window.supabase.createClient(
        'https://thbhsktcenhrnxzkbjus.supabase.co',
        'sb_publishable_poyzEEwONnXEqVgepPF6aQ_6qbaLFpi'
      );
      client.auth.getSession().then(({ data }) => updateAccountLink(data?.session)).catch(() => {});
      client.auth.onAuthStateChange((_event, session) => updateAccountLink(session));
    } catch (_error) {
      updateAccountLink(null);
    }
  }
})();

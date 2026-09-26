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
              <p class="public-footer-social-title">Follow LymphAware ID</p>
              <nav class="public-footer-social" aria-label="LymphAware ID social media">
                <a class="public-social-link facebook" href="https://www.facebook.com/LymphAwareID" target="_blank" rel="noopener noreferrer" aria-label="LymphAware ID on Facebook" title="Facebook">
                  <svg class="public-social-mark" viewBox="0 0 320 512" aria-hidden="true" focusable="false"><path fill="#1877F2" d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06H297V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z"/></svg>
                </a>
                <a class="public-social-link instagram" href="https://www.instagram.com/lymphaware.id/" target="_blank" rel="noopener noreferrer" aria-label="LymphAware ID on Instagram" title="Instagram">
                  <svg class="public-social-mark" viewBox="0 0 448 512" aria-hidden="true" focusable="false">
                    <defs><linearGradient id="lymphaware-instagram-gradient" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#F58529"/><stop offset="38%" stop-color="#DD2A7B"/><stop offset="68%" stop-color="#8134AF"/><stop offset="100%" stop-color="#515BD4"/></linearGradient></defs>
                    <path fill="url(#lymphaware-instagram-gradient)" d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9S160.5 370.8 224.1 370.8 339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z"/>
                  </svg>
                </a>
                <a class="public-social-link tiktok" href="https://www.tiktok.com/@lymphawareid" target="_blank" rel="noopener noreferrer" aria-label="LymphAware ID on TikTok" title="TikTok">
                  <svg class="public-social-mark" viewBox="0 0 448 512" aria-hidden="true" focusable="false"><path fill="#111111" d="M448 209.91a210.06 210.06 0 0 1-122.77-39.25v178.72A162.55 162.55 0 1 1 185 188.31v89.89a74.62 74.62 0 1 0 52.23 71.18V0h88A121.18 121.18 0 0 0 448 121.18z"/></svg>
                </a>
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
  const mobileSignOutButton = document.getElementById('public-mobile-sign-out');
  let publicAuthClient = null;

  const updateAccountLink = session => {
    const signedIn = Boolean(session?.user);

    if (desktopAccountLink) {
      desktopAccountLink.href = signedIn ? '#' : '/sign-in/';
      desktopAccountLink.dataset.authAction = signedIn ? 'sign-out' : 'sign-in';
      const textTarget = desktopAccountLink.querySelector('span') || desktopAccountLink;
      textTarget.textContent = signedIn ? 'Sign Out' : 'Sign In';
      desktopAccountLink.setAttribute('aria-label', signedIn ? 'Sign out of LymphAware ID' : 'Sign in to LymphAware ID');
    }

    if (mobileAccountLink) {
      mobileAccountLink.href = signedIn ? '/portal/' : '/sign-in/';
      mobileAccountLink.textContent = signedIn ? 'Patient Portal' : 'Sign In';
    }
    if (mobileSignOutButton) mobileSignOutButton.hidden = !signedIn;
  };

  async function signOutPublicSite() {
    if (!publicAuthClient) return;
    const { error } = await publicAuthClient.auth.signOut();
    if (error) {
      console.error('Unable to sign out:', error);
      return;
    }
    updateAccountLink(null);
    window.location.href = '/';
  }

  desktopAccountLink?.addEventListener('click', async event => {
    if (desktopAccountLink.dataset.authAction !== 'sign-out' || !publicAuthClient) return;
    event.preventDefault();
    const textTarget = desktopAccountLink.querySelector('span') || desktopAccountLink;
    desktopAccountLink.setAttribute('aria-busy', 'true');
    textTarget.textContent = 'Signing Out…';
    await signOutPublicSite();
    desktopAccountLink.removeAttribute('aria-busy');
  });

  mobileSignOutButton?.addEventListener('click', signOutPublicSite);

  if (window.supabase?.createClient) {
    try {
      publicAuthClient = window.supabase.createClient(
        'https://thbhsktcenhrnxzkbjus.supabase.co',
        'sb_publishable_poyzEEwONnXEqVgepPF6aQ_6qbaLFpi'
      );
      publicAuthClient.auth.getSession().then(({ data }) => updateAccountLink(data?.session)).catch(() => {});
      publicAuthClient.auth.onAuthStateChange((_event, session) => updateAccountLink(session));
    } catch (_error) {
      updateAccountLink(null);
    }
  }
})();

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
                <a href="https://www.facebook.com/LymphAwareID" target="_blank" rel="noopener noreferrer" aria-label="LymphAware ID on Facebook" title="Facebook">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.8 22v-8h2.8l.4-3.2h-3.2V8.7c0-.9.3-1.6 1.7-1.6h1.8V4.2c-.3 0-1.4-.2-2.6-.2-2.6 0-4.4 1.6-4.4 4.5v2.3H7.4V14h2.9v8h3.5Z"/></svg>
                </a>
                <a href="https://www.instagram.com/lymphaware.id/" target="_blank" rel="noopener noreferrer" aria-label="LymphAware ID on Instagram" title="Instagram">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 2h9.2A5.4 5.4 0 0 1 22 7.4v9.2a5.4 5.4 0 0 1-5.4 5.4H7.4A5.4 5.4 0 0 1 2 16.6V7.4A5.4 5.4 0 0 1 7.4 2Zm0 2A3.4 3.4 0 0 0 4 7.4v9.2A3.4 3.4 0 0 0 7.4 20h9.2a3.4 3.4 0 0 0 3.4-3.4V7.4A3.4 3.4 0 0 0 16.6 4H7.4Zm9.35 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>
                </a>
                <a href="https://www.tiktok.com/@lymphawareid" target="_blank" rel="noopener noreferrer" aria-label="LymphAware ID on TikTok" title="TikTok">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 2h3.1c.2 1.6 1.1 3 2.4 3.9.8.5 1.7.8 2.8.9v3.2c-1.6 0-3.1-.4-4.4-1.2v6.4A6.8 6.8 0 1 1 12 8.4v3.3a3.6 3.6 0 1 0 3.4 3.6V2h-.7Z"/></svg>
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

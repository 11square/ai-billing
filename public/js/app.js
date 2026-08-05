// ===== App shell: auth + routing =====
const App = {
  pages: {
    dashboard: { title: 'Dashboard', mod: () => Dashboard },
    pos:       { title: 'Billing / POS', mod: () => Pos },
    invoices:  { title: 'Invoices', mod: () => Invoices },
    menu:      { title: 'Menu Items', mod: () => Menu },
    stock:     { title: 'Stock & Purchase Orders', mod: () => Stock },
    customers: { title: 'Customers', mod: () => Customers },
    staff:     { title: 'Staff & Attendance', mod: () => Staff },
    reports:   { title: 'Reports', mod: () => Reports },
    settings:  { title: 'Bill & Printer Settings', mod: () => Settings }
  },
  installPrompt: null,

  init() {
    Ui.hydrateIcons();
    document.getElementById('page-date').textContent =
      new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // login form
    document.getElementById('login-form').addEventListener('submit', e => { e.preventDefault(); this.submitAuth(); });
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());
    document.getElementById('btn-new-order').addEventListener('click', () => { location.hash = '#pos'; });
    document.getElementById('mobile-menu-btn').addEventListener('click', () => this.toggleMobileMenu());
    document.getElementById('mobile-nav-backdrop').addEventListener('click', () => this.closeMobileMenu());
    document.getElementById('sidebar-nav').addEventListener('click', () => this.closeMobileMenu());
    document.getElementById('btn-install-app').addEventListener('click', () => this.installApp());
    document.addEventListener('error', event => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.dataset.fallback && image.src !== image.dataset.fallback) {
        image.src = image.dataset.fallback;
      }
    }, true);
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      this.installPrompt = event;
      document.getElementById('btn-install-app').classList.add('ready');
    });
    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      const button = document.getElementById('btn-install-app');
      button.classList.add('installed');
      button.textContent = 'Installed';
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    }

    if (Api.token && Api.user()) this.showApp();
    else this.showLogin();
  },

  // ---------- auth ----------
  async submitAuth() {
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Please wait…';
    try {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const user = await Api.post('/auth/login', { email, password });
      Api.setSession(user);
      this.showApp();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  },

  logout() {
    Api.clearSession();
    this.showLogin();
  },

  toggleMobileMenu() {
    const open = !document.body.classList.contains('mobile-nav-open');
    document.body.classList.toggle('mobile-nav-open', open);
    document.getElementById('mobile-menu-btn').setAttribute('aria-expanded', String(open));
  },

  closeMobileMenu() {
    document.body.classList.remove('mobile-nav-open');
    document.getElementById('mobile-menu-btn').setAttribute('aria-expanded', 'false');
  },

  async installApp() {
    if (this.installPrompt) {
      this.installPrompt.prompt();
      await this.installPrompt.userChoice;
      this.installPrompt = null;
      return;
    }

    Ui.toast('Open the browser menu and choose “Add to Home screen”.', 'success');
  },

  showLogin() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  },

  showApp() {
    const user = Api.user();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-name').textContent = user.name;
    document.getElementById('user-role').textContent = user.role;
    document.getElementById('user-avatar').textContent = (user.name || 'U')[0].toUpperCase();
    if (!location.hash || !this.pages[location.hash.slice(1)]) location.hash = '#dashboard';
    this.route();
  },

  // ---------- routing ----------
  route() {
    if (!Api.token) return;
    const key = (location.hash || '#dashboard').slice(1);
    const page = this.pages[key] || this.pages.dashboard;
    if (key !== 'pos' && window.Voice) Voice.stop();
    document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.page === key));
    document.getElementById('page-title').textContent = page.title;
    document.getElementById('btn-new-order').style.display = key === 'pos' ? 'none' : '';
    page.mod().render(document.getElementById('page'));
    this.closeMobileMenu();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

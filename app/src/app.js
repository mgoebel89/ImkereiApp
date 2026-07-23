(function () {
  'use strict';
  const { renderUebersicht, renderStaende, renderVoelker, renderBehandlungen, renderEinstellungen } = IM.views;

  const mount = document.getElementById('app');
  const shell = document.getElementById('appShell');

  // ---------- Navigations-Config (neues Modul = 1 Eintrag) ----------
  const NAV = [
    { items: [
      { path: '/', label: 'Übersicht', icon: 'home' },
    ] },
    { label: 'Bienen', items: [
      { path: '/voelker', label: 'Völker', icon: 'hive' },
      { path: '/staende', label: 'Stände', icon: 'pin' },
      { path: '/behandlungen', label: 'Behandlungen', icon: 'drop' },
    ] },
    { footer: true, items: [
      { path: '/einstellungen', label: 'Einstellungen', icon: 'gear' },
    ] },
  ];

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    hive: '<path d="M6 4h12l2 4-2 4H6L4 8z"/><path d="M6 12h12l2 4-2 4H6l-2-4z"/>',
    pin: '<path d="M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    drop: '<path d="M12 3s6 6.5 6 10a6 6 0 01-12 0c0-3.5 6-10 6-10z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  function parseHash() {
    const h = (location.hash || '#/').replace(/^#/, '');
    const [path, query] = h.split('?');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    return { path, params };
  }

  function buildSidebar() {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    nav.innerHTML = '';
    for (const group of NAV) {
      const wrap = document.createElement('div');
      if (group.footer) wrap.className = 'nav-spacer';
      if (group.label) {
        const gl = document.createElement('div');
        gl.className = 'nav-group-label';
        gl.textContent = group.label;
        wrap.appendChild(gl);
      }
      for (const item of group.items) {
        const a = document.createElement('a');
        a.className = 'nav-item';
        a.href = '#' + item.path;
        a.setAttribute('data-route', item.path);
        a.title = item.label;
        a.innerHTML = `<span class="nav-icon">${icon(item.icon)}</span><span class="nav-label">${item.label}</span>`;
        // Drawer auf dem Handy schließen, sonst verdeckt er die Zielseite.
        a.addEventListener('click', () => shell && shell.classList.remove('nav-open'));
        wrap.appendChild(a);
      }
      nav.appendChild(wrap);
    }
  }

  function setActiveNav(path) {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(a => {
      const route = a.getAttribute('data-route');
      const active = route === '/' ? (path === '/' || path === '') : path.startsWith(route);
      a.classList.toggle('active', active);
    });
  }

  function bindShellControls() {
    const collapseBtn = document.getElementById('sidebarCollapse');
    const menuBtn = document.getElementById('menuToggle');
    const backdrop = document.getElementById('sidebarBackdrop');
    try { if (localStorage.getItem('im.sidebarCollapsed') === '1') shell.classList.add('sidebar-collapsed'); } catch (_) {}
    if (collapseBtn) collapseBtn.addEventListener('click', () => {
      const c = shell.classList.toggle('sidebar-collapsed');
      try { localStorage.setItem('im.sidebarCollapsed', c ? '1' : '0'); } catch (_) {}
    });
    if (menuBtn) menuBtn.addEventListener('click', () => shell.classList.toggle('nav-open'));
    if (backdrop) backdrop.addEventListener('click', () => shell.classList.remove('nav-open'));
  }

  function router() {
    const { path, params } = parseHash();
    mount.innerHTML = '';
    mount.scrollTop = 0;
    setActiveNav(path);
    if (path === '/' || path === '') return renderUebersicht(mount);
    if (path === '/staende') return renderStaende(mount);
    if (path === '/voelker') return renderVoelker(mount, params);
    if (path === '/behandlungen') return renderBehandlungen(mount, params);
    if (path === '/einstellungen') return renderEinstellungen(mount);
    mount.innerHTML = '<div class="card"><h2>Seite nicht gefunden</h2><a href="#/">Zurück zur Übersicht</a></div>';
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) { return iso; }
  }

  function bindSyncStatus() {
    const btn = document.getElementById('syncStatus');
    if (!btn || !IM.auto_sync) return;
    const label = btn.querySelector('.sync-label');
    IM.auto_sync.subscribe(state => {
      btn.className = 'sync-status sync-status--' + state.status;
      let labelText = 'Sync';
      let title = '';
      switch (state.status) {
        case 'unconfigured':
          labelText = 'NocoDB aus';
          title = 'NocoDB nicht konfiguriert — in den Einstellungen einrichten, um die Daten zusätzlich extern zu sichern.';
          break;
        case 'idle':
          labelText = 'bereit';
          title = 'Auto-Sync läuft, noch nichts zu sichern.';
          break;
        case 'syncing':
          labelText = `sichere${state.pending ? ' (' + state.pending + ')' : ''}…`;
          title = 'Synchronisiere mit NocoDB…';
          break;
        case 'ok':
          labelText = 'gesichert';
          title = `Zuletzt gesichert: ${fmtTime(state.lastSyncAt) || '—'}`;
          break;
        case 'error':
          labelText = `Fehler${state.pending ? ' (' + state.pending + ')' : ''}`;
          title = `Fehler: ${state.lastError || 'unbekannt'}\nLetzte erfolgreiche Sicherung: ${fmtTime(state.lastSyncAt) || '—'}\nKlicken, um es erneut zu versuchen.`;
          break;
      }
      label.textContent = labelText;
      btn.title = title;
    });
    btn.addEventListener('click', () => {
      if (!IM.nocodb_client.isConfigured()) { location.hash = '#/einstellungen'; return; }
      IM.auto_sync.triggerNow();
    });
  }

  function showBackendUnavailableBanner() {
    const banner = document.createElement('div');
    banner.className = 'backend-banner';
    banner.textContent = '⚠ Backend nicht erreichbar — Eingaben werden nicht gespeichert. Bitte den Container/Service prüfen.';
    document.body.insertBefore(banner, document.body.firstChild);
  }

  async function startApp() {
    buildSidebar();
    bindShellControls();
    bindSyncStatus();
    if (IM.api && IM.api.subscribe) {
      IM.api.subscribe(msg => IM.store.applyServerMessage(msg));
      IM.api.connectWs();
    }
    await IM.store.bootstrap();
    if (!IM.store.isBackendAvailable()) showBackendUnavailableBanner();
    router();
    // Nur bei Änderungen ANDERER Geräte neu rendern — eigene Eingaben würden
    // sonst mitten im Tippen den Cursor verlieren.
    IM.store.onRemoteChange(() => router());
    if (IM.auto_sync) IM.auto_sync.start();
  }

  window.addEventListener('hashchange', router);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
})();

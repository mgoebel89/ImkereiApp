(function () {
  'use strict';
  window.IM = window.IM || {};
  const { store } = IM;

  // Sichert geänderte Datensätze im Hintergrund nach NocoDB.
  //
  // Der Sync ist bewusst einseitig (App → NocoDB): NocoDB ist die externe
  // Sicherung, nicht die führende Quelle. Zurück kommen die Daten nur auf
  // ausdrückliches „Wiederherstellen" in den Einstellungen.

  // Status: 'unconfigured' | 'idle' | 'syncing' | 'ok' | 'error'
  let state = { status: 'idle', lastSyncAt: '', lastError: '', pending: 0 };
  const listeners = [];
  let timer = null;
  let running = false;
  let unsubscribeChange = null;
  let debounceTimer = null;

  function emit() {
    for (const fn of listeners) {
      try { fn(state); } catch (e) { console.warn('auto-sync listener', e); }
    }
  }

  function subscribe(fn) {
    listeners.push(fn);
    try { fn(state); } catch (_) {}
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
  }

  function module_() { return (IM.nocodb_client && IM.nocodb_client.MODULE) || []; }

  function computePending() {
    let n = 0;
    for (const m of module_()) {
      for (const item of m.list()) if (store.isDirty(m.kind, item)) n++;
    }
    return n;
  }

  async function tick() {
    if (running) return;
    const client = IM.nocodb_client;
    if (!client || !client.isConfigured()) {
      setState({ status: 'unconfigured', pending: 0, lastError: '' });
      return;
    }
    running = true;

    const pendingNow = computePending();
    if (pendingNow === 0) {
      setState({ status: state.lastSyncAt ? 'ok' : 'idle', pending: 0 });
      running = false;
      return;
    }
    setState({ status: 'syncing', pending: pendingNow });

    let lastError = '';
    let anySuccess = false;

    for (const m of module_()) {
      for (const item of m.list()) {
        if (!store.isDirty(m.kind, item)) continue;
        try {
          await client.syncEntity(m.kind, item);
          store.markSynced(m.kind, item.id);
          anySuccess = true;
        } catch (e) {
          lastError = e.message;
          store.markSyncError(m.kind, item.id, e.message);
        }
      }
    }

    const remaining = computePending();
    setState({
      status: lastError ? 'error' : (remaining === 0 ? 'ok' : 'syncing'),
      lastSyncAt: anySuccess ? new Date().toISOString() : state.lastSyncAt,
      lastError,
      pending: remaining,
    });
    running = false;
  }

  function start() {
    stop();
    const interval = Math.max(15, (store.getSettings().autoSyncIntervalSec || 60));
    timer = setInterval(tick, interval * 1000);
    setTimeout(tick, 1000);
    // Nach einer Eingabe kurz warten statt sofort zu feuern — beim Ausfüllen
    // einer Durchsicht ändert sich der Datensatz sonst im Sekundentakt.
    unsubscribeChange = store.onChange(() => {
      setState({ pending: computePending() });
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(tick, 5000);
    });
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (unsubscribeChange) { unsubscribeChange(); unsubscribeChange = null; }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  function triggerNow() { return tick(); }

  IM.auto_sync = { start, stop, subscribe, triggerNow, getState: () => state };
})();

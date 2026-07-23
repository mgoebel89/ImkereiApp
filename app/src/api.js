(function () {
  'use strict';
  window.IM = window.IM || {};

  const BASE = ''; // gleicher Host, nginx leitet /api an Node
  const WS_PATH = '/ws';

  // Eigene Client-Kennung: der Server schickt sie bei Broadcasts als `origin`
  // zurück, damit ein Gerät seine eigenen Änderungen nicht doppelt anwendet
  // (sonst springt beim Tippen der Cursor).
  const CLIENT_ID = (function () {
    let id = '';
    try { id = sessionStorage.getItem('im.clientId') || ''; } catch (_) {}
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || ('c-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
      try { sessionStorage.setItem('im.clientId', id); } catch (_) {}
    }
    return id;
  })();

  const listeners = [];
  let ws = null;
  let wsReconnectTimer = null;
  let wsBackoff = 1000;

  async function jsonFetch(path, opts = {}) {
    const res = await fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Backend ${res.status}: ${txt.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  async function uploadFetch(path, formData) {
    const res = await fetch(path, { method: 'POST', body: formData, headers: { 'X-Client-Id': CLIENT_ID } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }

  // --- Snapshot/Health ---
  async function health() { return jsonFetch('/api/health'); }
  async function snapshot() { return jsonFetch('/api/snapshot'); }

  // --- Settings ---
  async function putSettings(s) { return jsonFetch('/api/settings', { method: 'PUT', body: s }); }

  // --- Modul Bienenstöcke ---
  // Die vier Entitäten folgen demselben CRUD-Muster, daher generisch erzeugt.
  function crud(pfad) {
    return {
      put: (obj) => jsonFetch(`/api/${pfad}/${encodeURIComponent(obj.id)}`, { method: 'PUT', body: obj }),
      del: (id) => jsonFetch(`/api/${pfad}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    };
  }
  const staendeApi = crud('staende');
  const voelkerApi = crud('voelker');
  const behandlungenApi = crud('behandlungen');
  const fuetterungenApi = crud('fuetterungen');

  // --- Modul Honig ---
  const erntenApi = crud('ernten');
  const gebindeApi = crud('gebinde');
  const abfuellungenApi = crud('abfuellungen');

  // --- Fotos zu Durchsichten ---
  async function listVolkFotos(volkId) { return jsonFetch(`/api/voelker/${encodeURIComponent(volkId)}/fotos`); }
  async function uploadVolkFoto(volkId, file, kind) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (kind) fd.append('kind', kind);
    return uploadFetch(`/api/voelker/${encodeURIComponent(volkId)}/fotos`, fd);
  }
  async function deleteVolkFoto(fileId) { return jsonFetch(`/api/volk-files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }); }
  function volkFotoUrl(fileId) { return `/api/volk-files/${encodeURIComponent(fileId)}`; }

  // --- WebSocket ---
  function subscribe(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  function connectWs() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => { wsBackoff = 1000; };
    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      for (const fn of listeners) { try { fn(msg); } catch (e) { console.warn('ws listener', e); } }
    };
    ws.onclose = () => scheduleReconnect();
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }

  function scheduleReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      wsBackoff = Math.min(wsBackoff * 2, 30000);
      connectWs();
    }, wsBackoff);
  }

  IM.api = {
    clientId: CLIENT_ID,
    health, snapshot, putSettings,
    putStand: staendeApi.put, deleteStandRemote: staendeApi.del,
    putVolk: voelkerApi.put, deleteVolkRemote: voelkerApi.del,
    putBehandlung: behandlungenApi.put, deleteBehandlungRemote: behandlungenApi.del,
    putFuetterung: fuetterungenApi.put, deleteFuetterungRemote: fuetterungenApi.del,
    putErnte: erntenApi.put, deleteErnteRemote: erntenApi.del,
    putGebinde: gebindeApi.put, deleteGebindeRemote: gebindeApi.del,
    putAbfuellung: abfuellungenApi.put, deleteAbfuellungRemote: abfuellungenApi.del,
    listVolkFotos, uploadVolkFoto, deleteVolkFoto, volkFotoUrl,
    subscribe, connectWs,
  };
})();

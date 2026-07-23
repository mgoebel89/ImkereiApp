(function () {
  'use strict';
  window.IM = window.IM || {};
  const { SCHEMA_VERSION } = IM.models;

  // Cache = Single Source of Truth im Frontend; das Backend ist autoritativ.
  // Schreibvorgänge gehen optimistisch in den Cache und parallel ans Backend —
  // die Oberfläche soll am Bienenstand nicht auf das Netz warten.
  const cache = {
    settings: null,
    staende: [],
    voelker: [],
    volkFiles: {},      // volkId -> [{id, kind, filename, ...}]
    behandlungen: [],
    fuetterungen: [],
    ready: false,
    backendAvailable: false,
  };

  const changeListeners = [];
  const remoteChangeListeners = [];

  function nowIso() { return new Date().toISOString(); }

  function upsertInto(arr, obj) {
    if (!obj || !obj.id) return;
    const idx = arr.findIndex(x => x.id === obj.id);
    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
  }

  function notifyChange() {
    for (const fn of changeListeners) { try { fn(); } catch (e) { console.warn(e); } }
  }
  function notifyRemote() {
    for (const fn of remoteChangeListeners) { try { fn(); } catch (e) { console.warn(e); } }
  }

  // ----- Defaults -----
  function defaultSettings() {
    return {
      schemaVersion: SCHEMA_VERSION,
      imkerei: defaultImkereiSettings(),
      nocodb: defaultNocoDbSettings(),
      autoSync: true,
      autoSyncIntervalSec: 60,
    };
  }

  function defaultImkereiSettings() {
    return {
      name: '',
      imker: '',
      anschrift: '',
      registriernummer: '',   // Veterinäramts-Registriernummer, gehört aufs Bestandsbuch
      standardBeutentyp: '',
      standardRahmenmass: '',
    };
  }

  function defaultNocoDbSettings() {
    return {
      serverUrl: '',
      token: '',
      baseId: '',
      tableStaendeName: 'Staende', tableStaendeId: '',
      tableVoelkerName: 'Voelker', tableVoelkerId: '',
      tableBehandlungenName: 'Behandlungen', tableBehandlungenId: '',
      tableFuetterungenName: 'Fuetterungen', tableFuetterungenId: '',
    };
  }

  // ----- Migration -----
  // Bestandsdatensätze aus älteren Versionen auf die aktuelle Form bringen.
  // Läuft bei jedem Laden und bei jedem WebSocket-Empfang, muss also idempotent
  // und billig sein.
  function migrateVolk(v) {
    if (!v) return v;
    if (!Array.isArray(v.durchsichten)) v.durchsichten = [];
    if (!Array.isArray(v.standHistorie)) v.standHistorie = [];
    if (!Array.isArray(v.koeniginHistorie)) v.koeniginHistorie = [];
    if (!Array.isArray(v.paperlessDocs)) v.paperlessDocs = [];
    if (!v.koenigin || typeof v.koenigin !== 'object') v.koenigin = IM.models.emptyKoenigin();
    if (!v.status) v.status = 'aktiv';
    for (const d of v.durchsichten) {
      if (!Array.isArray(d.arbeiten)) d.arbeiten = [];
      if (!Array.isArray(d.fotoIds)) d.fotoIds = [];
      migriereSanftmut(d);
    }
    return v;
  }

  // Sanftmut lief bis Schema-Version 1 auf 1–5 mit 5 = sehr sanft. Seit
  // Version 2 ist es eine Schulnote 1–6 mit 1 = sehr friedlich, also umgekehrt
  // gerichtet. Ohne Umrechnung würde aus dem sanftesten Volk das stechlustigste.
  // 6 − alt bildet die alte Skala richtig ab: 5→1, 4→2, 3→3, 2→4, 1→5.
  //
  // Die Umrechnung hängt am Versionsstempel des Eintrags, nicht am Wert — sie
  // greift also genau einmal, egal wie oft geladen wird, und landet in der
  // Datenbank, sobald das Volk das nächste Mal gespeichert wird.
  function migriereSanftmut(d) {
    if ((d.schemaVersion || 1) >= 2) return;
    if (d.sanftmut !== null && d.sanftmut !== undefined && d.sanftmut !== '') {
      d.sanftmut = 6 - Number(d.sanftmut);
    }
    d.schemaVersion = 2;
  }

  function migrateMassnahme(m) {
    if (!m) return m;
    if (!Array.isArray(m.volkIds)) m.volkIds = [];
    return m;
  }

  // ----- Bootstrap -----
  async function bootstrap() {
    try {
      const snap = await IM.api.snapshot();
      cache.settings = snap.settings || defaultSettings();
      cache.staende = snap.staende || [];
      cache.voelker = (snap.voelker || []).map(migrateVolk);
      cache.volkFiles = snap.volkFiles || {};
      cache.behandlungen = (snap.behandlungen || []).map(migrateMassnahme);
      cache.fuetterungen = (snap.fuetterungen || []).map(migrateMassnahme);
      cache.backendAvailable = true;
      cache.ready = true;
      mergeSettingsDefaults();
      notifyChange();
    } catch (e) {
      console.error('Backend nicht erreichbar:', e);
      cache.backendAvailable = false;
      cache.settings = defaultSettings();
      cache.ready = true;
      notifyChange();
    }
  }

  // Fehlende Default-Zweige nachziehen — nötig, wenn ein Update neue
  // Einstellungen einführt und die gespeicherten Settings sie noch nicht kennen.
  function mergeSettingsDefaults() {
    if (!cache.settings) cache.settings = defaultSettings();
    const s = cache.settings;
    const fill = (key, defaults) => {
      if (!s[key] || typeof s[key] !== 'object') { s[key] = defaults; return; }
      for (const k of Object.keys(defaults)) if (s[key][k] === undefined) s[key][k] = defaults[k];
    };
    fill('imkerei', defaultImkereiSettings());
    fill('nocodb', defaultNocoDbSettings());
    if (s.autoSync === undefined) s.autoSync = true;
    if (s.autoSyncIntervalSec === undefined) s.autoSyncIntervalSec = 60;
  }

  // ----- WebSocket-Apply -----
  function applyServerMessage(msg) {
    if (!msg || !msg.type) return;
    // Eigene Echos ignorieren — sonst rerendert das UI, während der User tippt.
    if (msg.origin && IM.api && IM.api.clientId && msg.origin === IM.api.clientId) return;

    // Die vier Entitäten verhalten sich gleich; nur Volk und Maßnahmen brauchen
    // vor dem Einsortieren ihre Migration.
    const ENT = {
      stand: { arr: 'staende', migrate: x => x },
      volk: { arr: 'voelker', migrate: migrateVolk },
      behandlung: { arr: 'behandlungen', migrate: migrateMassnahme },
      fuetterung: { arr: 'fuetterungen', migrate: migrateMassnahme },
    };
    const [ent, action] = msg.type.split(':');

    if (ENT[ent] && action === 'save') {
      const obj = ENT[ent].migrate(msg[ent]);
      upsertInto(cache[ENT[ent].arr], obj);
      notifyChange(); notifyRemote();
      return;
    }
    if (ENT[ent] && action === 'delete') {
      const arr = ENT[ent].arr;
      cache[arr] = cache[arr].filter(x => x.id !== msg.id);
      if (ent === 'volk') delete cache.volkFiles[msg.id];
      notifyChange(); notifyRemote();
      return;
    }

    switch (msg.type) {
      case 'settings:save':
        cache.settings = msg.settings;
        mergeSettingsDefaults();
        notifyChange(); notifyRemote();
        break;
      case 'volkfoto:add': {
        const f = msg.file;
        if (!f) break;
        if (!cache.volkFiles[f.volkId]) cache.volkFiles[f.volkId] = [];
        if (!cache.volkFiles[f.volkId].some(x => x.id === f.id)) cache.volkFiles[f.volkId].push(f);
        notifyChange(); notifyRemote();
        break;
      }
      case 'volkfoto:delete':
        if (cache.volkFiles[msg.volkId]) {
          cache.volkFiles[msg.volkId] = cache.volkFiles[msg.volkId].filter(f => f.id !== msg.id);
        }
        notifyChange(); notifyRemote();
        break;
    }
  }

  // Backend-Fehler dürfen die Eingabe nicht abbrechen, aber sie müssen sichtbar
  // sein — sonst tippt man am Stand munter weiter, obwohl nichts ankommt.
  function bgSave(promise, was) {
    promise.catch(err => {
      console.warn(`${was} Backend-Fehler`, err);
      if (IM.ui && IM.ui.toast) IM.ui.toast('Backend-Fehler: ' + err.message, 4000);
    });
  }

  const store = {
    isReady() { return cache.ready; },
    isBackendAvailable() { return cache.backendAvailable; },

    // --- Settings ---
    getSettings() {
      if (!cache.settings) cache.settings = defaultSettings();
      return cache.settings;
    },
    saveSettings(s) {
      cache.settings = s;
      bgSave(IM.api.putSettings(s), 'saveSettings');
      notifyChange();
    },

    // --- Stände ---
    listStaende() { return cache.staende.slice(); },
    getStand(id) { return cache.staende.find(s => s.id === id) || null; },
    saveStand(s) {
      s.lastModifiedAt = nowIso();
      upsertInto(cache.staende, s);
      bgSave(IM.api.putStand(s), 'saveStand');
      notifyChange();
    },
    deleteStand(id) {
      cache.staende = cache.staende.filter(s => s.id !== id);
      bgSave(IM.api.deleteStandRemote(id), 'deleteStand');
      notifyChange();
    },

    // --- Völker ---
    listVoelker() { return cache.voelker.slice(); },
    getVolk(id) { return cache.voelker.find(v => v.id === id) || null; },
    saveVolk(v) {
      migrateVolk(v);
      v.lastModifiedAt = nowIso();
      upsertInto(cache.voelker, v);
      bgSave(IM.api.putVolk(v), 'saveVolk');
      notifyChange();
    },
    deleteVolk(id) {
      cache.voelker = cache.voelker.filter(v => v.id !== id);
      delete cache.volkFiles[id];
      bgSave(IM.api.deleteVolkRemote(id), 'deleteVolk');
      notifyChange();
    },

    // --- Behandlungen ---
    listBehandlungen() { return cache.behandlungen.slice(); },
    getBehandlung(id) { return cache.behandlungen.find(b => b.id === id) || null; },
    saveBehandlung(b) {
      b.lastModifiedAt = nowIso();
      upsertInto(cache.behandlungen, b);
      bgSave(IM.api.putBehandlung(b), 'saveBehandlung');
      notifyChange();
    },
    deleteBehandlung(id) {
      cache.behandlungen = cache.behandlungen.filter(b => b.id !== id);
      bgSave(IM.api.deleteBehandlungRemote(id), 'deleteBehandlung');
      notifyChange();
    },

    // --- Fütterungen ---
    listFuetterungen() { return cache.fuetterungen.slice(); },
    getFuetterung(id) { return cache.fuetterungen.find(f => f.id === id) || null; },
    saveFuetterung(f) {
      f.lastModifiedAt = nowIso();
      upsertInto(cache.fuetterungen, f);
      bgSave(IM.api.putFuetterung(f), 'saveFuetterung');
      notifyChange();
    },
    deleteFuetterung(id) {
      cache.fuetterungen = cache.fuetterungen.filter(f => f.id !== id);
      bgSave(IM.api.deleteFuetterungRemote(id), 'deleteFuetterung');
      notifyChange();
    },

    // --- Fotos (async, weil sie über Multipart gehen) ---
    listVolkFotos(volkId) { return (cache.volkFiles[volkId] || []).slice(); },
    async uploadVolkFoto(volkId, file, kind) {
      const rec = await IM.api.uploadVolkFoto(volkId, file, kind);
      if (!cache.volkFiles[volkId]) cache.volkFiles[volkId] = [];
      cache.volkFiles[volkId].push(rec);
      notifyChange();
      return rec;
    },
    async deleteVolkFoto(volkId, fileId) {
      await IM.api.deleteVolkFoto(fileId);
      if (cache.volkFiles[volkId]) cache.volkFiles[volkId] = cache.volkFiles[volkId].filter(f => f.id !== fileId);
      notifyChange();
    },
    volkFotoUrl(fileId) { return IM.api.volkFotoUrl(fileId); },

    // --- Sync-State (NocoDB) -----------------------------------------------
    // Merkt je Datensatz, wann er zuletzt erfolgreich nach NocoDB ging. Liegt
    // bewusst im localStorage: es ist ein Zustand DIESES Geräts, kein Inhalt.
    getSyncState() {
      let s;
      try { s = JSON.parse(localStorage.getItem('im.syncState') || '{}'); }
      catch (_) { s = {}; }
      // Jede sync-fähige Entität braucht ihren Eimer — fehlt er, laufen
      // markSynced/isDirty in „Cannot set properties of undefined".
      for (const k of ['staende', 'voelker', 'behandlungen', 'fuetterungen']) {
        if (!s[k] || typeof s[k] !== 'object') s[k] = {};
      }
      return s;
    },
    markSynced(kind, id) {
      const s = this.getSyncState();
      s[kind][id] = { lastSyncedAt: nowIso(), lastError: '' };
      localStorage.setItem('im.syncState', JSON.stringify(s));
    },
    markSyncError(kind, id, msg) {
      const s = this.getSyncState();
      const prev = s[kind][id] || {};
      s[kind][id] = { lastSyncedAt: prev.lastSyncedAt || '', lastError: msg, lastAttemptAt: nowIso() };
      localStorage.setItem('im.syncState', JSON.stringify(s));
    },
    isDirty(kind, item) {
      if (!item || !item.lastModifiedAt) return true;
      const s = this.getSyncState();
      const rec = s[kind][item.id];
      if (!rec || !rec.lastSyncedAt) return true;
      return item.lastModifiedAt > rec.lastSyncedAt;
    },

    // --- Change-Listener ---
    onChange(fn) { changeListeners.push(fn); return () => { const i = changeListeners.indexOf(fn); if (i >= 0) changeListeners.splice(i, 1); }; },
    onRemoteChange(fn) { remoteChangeListeners.push(fn); return () => { const i = remoteChangeListeners.indexOf(fn); if (i >= 0) remoteChangeListeners.splice(i, 1); }; },
    _notifyChange: notifyChange,

    bootstrap,
    applyServerMessage,
  };

  IM.store = store;
})();

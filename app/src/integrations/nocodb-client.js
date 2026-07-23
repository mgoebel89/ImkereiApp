(function () {
  'use strict';
  window.IM = window.IM || {};
  const { store } = IM;

  // NocoDB-Anbindung nach dem Muster der Gemeindeverwaltung.
  //
  // Jede Modul-Tabelle führt neben lesbaren Spalten eine **Payload**-Spalte mit
  // dem vollständigen Datensatz als JSON. Die lesbaren Spalten sind für den
  // Menschen (Filtern, Auswerten, Diagramme in NocoDB), die Payload-Spalte ist
  // das, woraus die App sich vollständig wiederherstellen kann. Deshalb ist
  // „aus NocoDB wiederherstellbar" hier keine Nacharbeit, sondern fällt an.

  // --- HTTP-Helfer ---
  function settings() {
    const s = store.getSettings().nocodb;
    if (!s || !s.serverUrl || !s.token || !s.baseId) {
      throw new Error('NocoDB-Verbindung unvollständig konfiguriert (Server-URL, Token, Base-ID).');
    }
    return s;
  }

  function isConfigured() {
    const s = store.getSettings().nocodb;
    return !!(s && s.serverUrl && s.token && s.baseId);
  }

  function baseUrl() {
    return settings().serverUrl.replace(/\/$/, '');
  }

  async function api(path, opts = {}) {
    const s = settings();
    const url = baseUrl() + path;
    let res;
    try {
      res = await fetch(url, {
        method: opts.method || 'GET',
        headers: {
          'xc-token': s.token,
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new Error('Netzwerkfehler / CORS-blockiert (NC_CORS_ORIGIN=* setzen?): ' + e.message);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`NocoDB ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const ctype = res.headers.get('Content-Type') || '';
    if (ctype.includes('application/json')) return res.json();
    return res.text();
  }

  // --- Tabellen-Discovery ---
  async function listTables() {
    const s = settings();
    const data = await api(`/api/v2/meta/bases/${encodeURIComponent(s.baseId)}/tables`);
    return data.list || data || [];
  }

  async function getTableMeta(tableId) {
    return api(`/api/v2/meta/tables/${encodeURIComponent(tableId)}`);
  }

  // Verbindung prüfen und dabei die Tabellen-IDs nachziehen — die braucht der
  // Sync, und sie ändern sich, wenn jemand in NocoDB eine Tabelle neu anlegt.
  async function testConnection() {
    const tables = await listTables();
    const s = store.getSettings();
    const findId = name => {
      const t = tables.find(t => (t.title || t.table_name) === name);
      return t ? (t.id || t.table_id) : '';
    };
    for (const m of MODULE) {
      const id = findId(s.nocodb[m.nameKey] || m.fallback);
      if (id) s.nocodb[m.idKey] = id;
    }
    store.saveSettings(s);
    return { tabellen: tables.length };
  }

  // --- Schema ---------------------------------------------------------------
  // Die lesbaren Spalten sind bewusst flach: NocoDB soll ohne Vorwissen
  // auswertbar sein („welche Völker stehen wo", „was wurde wann behandelt").
  const STAENDE_COLUMNS = [
    { title: 'StandId', uidt: 'SingleLineText', pv: true },
    { title: 'Name', uidt: 'SingleLineText' },
    { title: 'Adresse', uidt: 'SingleLineText' },
    { title: 'Lat', uidt: 'Number' },
    { title: 'Lng', uidt: 'Number' },
    { title: 'Aktiv', uidt: 'Checkbox' },
    { title: 'AnzahlVoelker', uidt: 'Number' },
    { title: 'Notiz', uidt: 'LongText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];

  const VOELKER_COLUMNS = [
    { title: 'VolkId', uidt: 'SingleLineText', pv: true },
    { title: 'Nummer', uidt: 'SingleLineText' },
    { title: 'Name', uidt: 'SingleLineText' },
    { title: 'Stand', uidt: 'SingleLineText' },
    { title: 'Status', uidt: 'SingleLineText' },
    { title: 'Herkunft', uidt: 'SingleLineText' },
    { title: 'Beutentyp', uidt: 'SingleLineText' },
    { title: 'Rahmenmass', uidt: 'SingleLineText' },
    { title: 'KoeniginJahr', uidt: 'Number' },
    { title: 'KoeniginFarbe', uidt: 'SingleLineText' },
    { title: 'KoeniginHerkunft', uidt: 'SingleLineText' },
    { title: 'AnzahlDurchsichten', uidt: 'Number' },
    { title: 'LetzteDurchsicht', uidt: 'Date' },
    { title: 'ErstelltAm', uidt: 'Date' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];

  const BEHANDLUNGEN_COLUMNS = [
    { title: 'BehandlungId', uidt: 'SingleLineText', pv: true },
    { title: 'Datum', uidt: 'Date' },
    { title: 'Art', uidt: 'SingleLineText' },
    { title: 'Stand', uidt: 'SingleLineText' },
    { title: 'Voelker', uidt: 'LongText' },
    { title: 'AnzahlVoelker', uidt: 'Number' },
    { title: 'Methode', uidt: 'SingleLineText' },
    { title: 'MilbenGesamt', uidt: 'Number' },
    { title: 'MilbenProTag', uidt: 'Number' },
    { title: 'Praeparat', uidt: 'SingleLineText' },
    { title: 'Wirkstoff', uidt: 'SingleLineText' },
    { title: 'Chargennummer', uidt: 'SingleLineText' },
    { title: 'Menge', uidt: 'Number' },
    { title: 'Einheit', uidt: 'SingleLineText' },
    { title: 'Anwendungsart', uidt: 'SingleLineText' },
    { title: 'WartezeitTage', uidt: 'Number' },
    { title: 'WartezeitBis', uidt: 'Date' },
    { title: 'Anwender', uidt: 'SingleLineText' },
    { title: 'Bemerkung', uidt: 'LongText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];

  const FUETTERUNGEN_COLUMNS = [
    { title: 'FuetterungId', uidt: 'SingleLineText', pv: true },
    { title: 'Datum', uidt: 'Date' },
    { title: 'Stand', uidt: 'SingleLineText' },
    { title: 'Voelker', uidt: 'LongText' },
    { title: 'AnzahlVoelker', uidt: 'Number' },
    { title: 'Futterart', uidt: 'SingleLineText' },
    { title: 'MengeProVolk', uidt: 'Number' },
    { title: 'GesamtMenge', uidt: 'Number' },
    { title: 'Einheit', uidt: 'SingleLineText' },
    { title: 'Anlass', uidt: 'SingleLineText' },
    { title: 'Notiz', uidt: 'LongText' },
    { title: 'LastModifiedAt', uidt: 'SingleLineText' },
    { title: 'Payload', uidt: 'LongText' },
  ];

  async function createTable(title, columns) {
    const s = settings();
    return api(`/api/v2/meta/bases/${encodeURIComponent(s.baseId)}/tables`, {
      method: 'POST', body: { table_name: title, title, columns },
    });
  }

  async function addColumn(tableId, col) {
    return api(`/api/v2/meta/tables/${encodeURIComponent(tableId)}/columns`, { method: 'POST', body: col });
  }

  // Fehlende Spalten ergänzen statt die Tabelle neu zu bauen — ein Update, das
  // ein Feld hinzufügt, soll bestehende Daten nicht anfassen.
  async function ensureColumns(tableId, expectedCols, log) {
    let meta;
    try { meta = await getTableMeta(tableId); } catch (e) { return; }
    const existing = new Set((meta.columns || []).map(c => c.title || c.column_name));
    for (const col of expectedCols) {
      if (existing.has(col.title)) continue;
      try {
        await addColumn(tableId, col);
        log && log.push(`Spalte „${col.title}“ ergänzt.`);
      } catch (e) {
        log && log.push(`Spalte „${col.title}“ konnte nicht angelegt werden: ${e.message}`);
      }
    }
  }

  // Registry aller sync-fähigen Module. Ein neues Modul = ein Eintrag hier plus
  // sein Row-Builder — Schema-Init, Sync und Restore ziehen automatisch mit.
  const MODULE = [
    {
      kind: 'staende', label: 'Stände', extId: 'StandId',
      idKey: 'tableStaendeId', nameKey: 'tableStaendeName', fallback: 'Staende',
      columns: STAENDE_COLUMNS,
      list: () => store.listStaende(), save: (o) => store.saveStand(o),
      row: (o) => buildStandRow(o),
    },
    {
      kind: 'voelker', label: 'Völker', extId: 'VolkId',
      idKey: 'tableVoelkerId', nameKey: 'tableVoelkerName', fallback: 'Voelker',
      columns: VOELKER_COLUMNS,
      list: () => store.listVoelker(), save: (o) => store.saveVolk(o),
      row: (o) => buildVolkRow(o),
    },
    {
      kind: 'behandlungen', label: 'Behandlungen', extId: 'BehandlungId',
      idKey: 'tableBehandlungenId', nameKey: 'tableBehandlungenName', fallback: 'Behandlungen',
      columns: BEHANDLUNGEN_COLUMNS,
      list: () => store.listBehandlungen(), save: (o) => store.saveBehandlung(o),
      row: (o) => buildBehandlungRow(o),
    },
    {
      kind: 'fuetterungen', label: 'Fütterungen', extId: 'FuetterungId',
      idKey: 'tableFuetterungenId', nameKey: 'tableFuetterungenName', fallback: 'Fuetterungen',
      columns: FUETTERUNGEN_COLUMNS,
      list: () => store.listFuetterungen(), save: (o) => store.saveFuetterung(o),
      row: (o) => buildFuetterungRow(o),
    },
  ];

  function modulByKind(kind) { return MODULE.find(m => m.kind === kind); }

  async function initSchema() {
    const tables = await listTables();
    const s = store.getSettings();
    const log = [];
    for (const m of MODULE) {
      const name = s.nocodb[m.nameKey] || m.fallback;
      const exists = tables.find(t => (t.title || t.table_name) === name);
      if (!exists) {
        const created = await createTable(name, m.columns);
        s.nocodb[m.idKey] = created.id || created.table_id || '';
        log.push(`Tabelle „${name}“ angelegt.`);
      } else {
        s.nocodb[m.idKey] = exists.id || exists.table_id || s.nocodb[m.idKey];
        log.push(`Tabelle „${name}“ existiert bereits.`);
        await ensureColumns(s.nocodb[m.idKey], m.columns, log);
      }
    }
    store.saveSettings(s);
    return log;
  }

  // --- Records --------------------------------------------------------------
  async function findByExternalId(tableId, field, value) {
    const where = `(${field},eq,${value})`;
    const data = await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records?where=${encodeURIComponent(where)}&limit=1`);
    const list = data.list || data.records || data || [];
    return list[0] || null;
  }

  async function fetchAllRecords(tableId) {
    const out = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const data = await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records?limit=${limit}&offset=${offset}`);
      const list = data.list || data.records || [];
      out.push(...list);
      const info = data.pageInfo || data.page_info || {};
      if (list.length < limit || info.isLastPage) break;
      offset += limit;
      if (offset > 50000) break;
    }
    return out;
  }

  // NocoDB kennt kein echtes Upsert auf einer Fremd-ID, daher suchen + PATCH
  // oder POST. Die App-UUID ist die fachliche Identität, nicht NocoDBs Id.
  async function upsertRecord(tableId, externalIdField, row) {
    const existing = await findByExternalId(tableId, externalIdField, row[externalIdField]);
    if (existing) {
      const internalId = existing.Id || existing.id;
      await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records`, {
        method: 'PATCH', body: [{ Id: internalId, ...row }],
      });
      return 'updated';
    }
    await api(`/api/v2/tables/${encodeURIComponent(tableId)}/records`, { method: 'POST', body: [row] });
    return 'created';
  }

  // Fehlt die Tabellen-ID (z. B. weil ein Update ein Modul neu eingeführt hat),
  // einmal automatisch nachziehen und höchstens alle 30 s neu anlegen — sonst
  // stößt ein Sync-Durchlauf initSchema für jeden Datensatz erneut an.
  let lastSchemaHealAt = 0;
  async function ensureTableId(idKey, nameLabel) {
    let cfg = store.getSettings().nocodb;
    if (!cfg[idKey]) { await testConnection(); cfg = store.getSettings().nocodb; }
    if (!cfg[idKey] && Date.now() - lastSchemaHealAt > 30000) {
      lastSchemaHealAt = Date.now();
      try { await initSchema(); } catch (e) { /* Ergebnis wird unten geprüft */ }
      cfg = store.getSettings().nocodb;
    }
    if (!cfg[idKey]) throw new Error(`Tabelle „${nameLabel}“ fehlt. Bitte in den Einstellungen „Schema initialisieren“ ausführen.`);
    return cfg[idKey];
  }

  // --- Row-Builder ----------------------------------------------------------
  function standName(id) {
    const s = store.getStand(id);
    return s ? s.name : '';
  }
  function volkNamen(ids) {
    return (ids || []).map(id => {
      const v = store.getVolk(id);
      return v ? IM.models.volkBezeichnung(v) : id;
    }).join('; ');
  }
  function isoDateOrNull(d) { return d || null; }

  function buildStandRow(s) {
    const anzahl = IM.models.voelkerAmStand(store.listVoelker(), s.id, true).length;
    return {
      StandId: s.id,
      Name: s.name || '',
      Adresse: s.adresse || '',
      Lat: s.lat === null || s.lat === '' ? null : Number(s.lat),
      Lng: s.lng === null || s.lng === '' ? null : Number(s.lng),
      Aktiv: !!s.aktiv,
      AnzahlVoelker: anzahl,
      Notiz: s.notiz || '',
      LastModifiedAt: s.lastModifiedAt || '',
      Payload: JSON.stringify(s),
    };
  }

  function buildVolkRow(v) {
    const letzte = IM.models.letzteDurchsicht(v);
    const farbe = IM.models.koeniginFarbe(v.koenigin && v.koenigin.jahr);
    return {
      VolkId: v.id,
      Nummer: v.nummer || '',
      Name: v.name || '',
      Stand: standName(IM.models.aktuellerStandId(v)),
      Status: IM.models.VOLK_STATUS_LABEL[v.status] || v.status || '',
      Herkunft: v.herkunft || '',
      Beutentyp: v.beutentyp || '',
      Rahmenmass: v.rahmenmass || '',
      KoeniginJahr: (v.koenigin && v.koenigin.jahr) ? Number(v.koenigin.jahr) : null,
      KoeniginFarbe: farbe ? farbe.name : '',
      KoeniginHerkunft: (v.koenigin && v.koenigin.herkunft) || '',
      AnzahlDurchsichten: (v.durchsichten || []).length,
      LetzteDurchsicht: letzte ? isoDateOrNull(letzte.datum) : null,
      ErstelltAm: isoDateOrNull(v.erstelltAm),
      LastModifiedAt: v.lastModifiedAt || '',
      Payload: JSON.stringify(v),
    };
  }

  function buildBehandlungRow(b) {
    return {
      BehandlungId: b.id,
      Datum: isoDateOrNull(b.datum),
      Art: b.art === 'diagnose' ? 'Diagnose' : 'Behandlung',
      Stand: standName(b.standId),
      Voelker: volkNamen(b.volkIds),
      AnzahlVoelker: (b.volkIds || []).length,
      Methode: b.methode || '',
      MilbenGesamt: b.milbenGesamt === null || b.milbenGesamt === '' ? null : Number(b.milbenGesamt),
      MilbenProTag: IM.models.milbenProTag(b),
      Praeparat: b.praeparat || '',
      Wirkstoff: b.wirkstoff || '',
      Chargennummer: b.chargennummer || '',
      Menge: b.menge === null || b.menge === '' ? null : Number(b.menge),
      Einheit: b.einheit || '',
      Anwendungsart: b.anwendungsart || '',
      WartezeitTage: Number(b.wartezeitTage) || 0,
      WartezeitBis: isoDateOrNull(IM.models.wartezeitBis(b)),
      Anwender: b.anwender || '',
      Bemerkung: b.bemerkung || '',
      LastModifiedAt: b.lastModifiedAt || '',
      Payload: JSON.stringify(b),
    };
  }

  function buildFuetterungRow(f) {
    return {
      FuetterungId: f.id,
      Datum: isoDateOrNull(f.datum),
      Stand: standName(f.standId),
      Voelker: volkNamen(f.volkIds),
      AnzahlVoelker: (f.volkIds || []).length,
      Futterart: f.futterart || '',
      MengeProVolk: f.mengeProVolk === null || f.mengeProVolk === '' ? null : Number(f.mengeProVolk),
      GesamtMenge: IM.models.fuetterungGesamt(f),
      Einheit: f.einheit || '',
      Anlass: f.anlass || '',
      Notiz: f.notiz || '',
      LastModifiedAt: f.lastModifiedAt || '',
      Payload: JSON.stringify(f),
    };
  }

  // --- Sync -----------------------------------------------------------------
  async function syncEntity(kind, obj) {
    const m = modulByKind(kind);
    if (!m) throw new Error('Unbekanntes Modul: ' + kind);
    const tableId = await ensureTableId(m.idKey, m.fallback);
    await upsertRecord(tableId, m.extId, m.row(obj));
    return { [kind]: 1 };
  }

  // --- Restore --------------------------------------------------------------
  // Lokal vorhandene IDs bleiben unangetastet (local wins) — es werden nur
  // fehlende Datensätze ergänzt. Fehlt die Tabelle in NocoDB (Modul nie
  // gesynct), wird sie stillschweigend übersprungen.
  async function restoreModul(m, tables) {
    const s = store.getSettings().nocodb;
    const tabName = s[m.nameKey] || m.fallback;
    const t = tables.find(t => (t.title || t.table_name) === tabName);
    const tableId = t ? (t.id || t.table_id) : s[m.idKey];
    if (!tableId) return { label: m.label, added: 0, skipped: true };

    const rows = await fetchAllRecords(tableId);
    const lokaleIds = new Set(m.list().map(x => x.id));
    let added = 0, kaputt = 0;
    for (const r of rows) {
      if (!r.Payload) continue;
      let parsed = null;
      try { parsed = JSON.parse(r.Payload); } catch (_) { kaputt++; continue; }
      if (!parsed || !parsed.id || lokaleIds.has(parsed.id)) continue;
      m.save(parsed);
      store.markSynced(m.kind, parsed.id);
      added++;
    }
    return { label: m.label, added, kaputt };
  }

  // Einzelne Module dürfen scheitern, ohne den Rest zu verhindern — ein halb
  // wiederhergestellter Stand ist besser als gar keiner.
  async function restoreFromNocoDb() {
    const tables = await listTables();
    const details = [];
    const fehler = [];
    for (const m of MODULE) {
      try {
        const res = await restoreModul(m, tables);
        if (!res.skipped && res.added > 0) details.push(`${res.added}× ${res.label}`);
        if (res.kaputt) fehler.push(`${res.label}: ${res.kaputt} unlesbare(r) Datensatz/Datensätze`);
      } catch (e) {
        fehler.push(`${m.label}: ${e.message}`);
      }
    }
    return { details, fehler };
  }

  IM.nocodb_client = {
    isConfigured, testConnection, initSchema,
    syncEntity, restoreFromNocoDb,
    MODULE,
    // für Tests/Diagnose
    _builders: { buildStandRow, buildVolkRow, buildBehandlungRow, buildFuetterungRow },
  };
})();

'use strict';

// Datenhaltung der Imkereiverwaltung.
//
// Muster wie in der Gemeindeverwaltung: jede Entität liegt als EIN JSON-Payload
// in einer schmalen Tabelle (id, payload, last_modified). Das hält Schema-
// Änderungen billig — neue Felder brauchen keine Migration — und macht den
// NocoDB-Sync trivial, weil dort dieselbe Payload-Spalte mitläuft und die
// Wiederherstellung generisch über alle Module funktioniert.
//
// Fotos liegen NICHT im Payload, sondern als Datei auf der Platte plus Zeile in
// einer *_files-Tabelle (hier volk_files). Sonst würde jeder Sync die Bilder
// mitschleppen.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || '/var/lib/imkerei';
const DB_PATH = path.join(DATA_DIR, 'data.db');
const ATTACH_DIR = path.join(DATA_DIR, 'attachments');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ATTACH_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Modul Bienenstöcke ------------------------------------------------------
  -- Bienenstand (Aufstellungsort)
  CREATE TABLE IF NOT EXISTS staende (
    id            TEXT PRIMARY KEY,
    payload       TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  -- Bienenvolk / Stock. Die Durchsichten (Stockkarten-Einträge) liegen im
  -- Payload des Volkes — sie gehören immer genau einem Volk und werden nie
  -- übergreifend abgefragt.
  CREATE TABLE IF NOT EXISTS voelker (
    id            TEXT PRIMARY KEY,
    payload       TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_voelker_modified ON voelker(last_modified);

  -- Behandlungen und Fütterungen sind EIGENE Entitäten mit volkIds[], weil sie
  -- in der Praxis ganze Stände auf einmal betreffen und das Bestandsbuch
  -- (Tierarzneimittel-Nachweis) sie chronologisch über alle Völker braucht.
  CREATE TABLE IF NOT EXISTS behandlungen (
    id            TEXT PRIMARY KEY,
    payload       TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_behandlungen_modified ON behandlungen(last_modified);
  CREATE TABLE IF NOT EXISTS fuetterungen (
    id            TEXT PRIMARY KEY,
    payload       TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fuetterungen_modified ON fuetterungen(last_modified);

  -- Modul Honig ------------------------------------------------------------
  -- Drei Stufen der Rückverfolgbarkeit: Ernte je Volk, Lagergebinde (kann aus
  -- mehreren Ernten gespeist sein), Abfüllcharge mit Losnummer.
  CREATE TABLE IF NOT EXISTS ernten (
    id            TEXT PRIMARY KEY,
    payload       TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ernten_modified ON ernten(last_modified);
  CREATE TABLE IF NOT EXISTS gebinde (
    id            TEXT PRIMARY KEY,
    payload       TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS abfuellungen (
    id            TEXT PRIMARY KEY,
    payload       TEXT NOT NULL,
    last_modified TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_abfuellungen_modified ON abfuellungen(last_modified);

  -- Fotos zu Durchsichten eines Volkes (kind = ds_<durchsichtId>)
  CREATE TABLE IF NOT EXISTS volk_files (
    id          TEXT PRIMARY KEY,
    volk_id     TEXT NOT NULL,
    kind        TEXT NOT NULL,
    filename    TEXT NOT NULL,
    mimetype    TEXT NOT NULL,
    size        INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_volkfile_volk ON volk_files(volk_id);
`);

const VOLK_FILE_DIR = path.join(ATTACH_DIR, 'voelker');
fs.mkdirSync(VOLK_FILE_DIR, { recursive: true });

function nowIso() { return new Date().toISOString(); }

// --- Generischer Payload-Store -------------------------------------------
function makePayloadStore(table) {
  return {
    list() { return db.prepare(`SELECT payload FROM ${table}`).all().map(r => JSON.parse(r.payload)); },
    get(id) {
      const r = db.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(id);
      return r ? JSON.parse(r.payload) : null;
    },
    save(obj) {
      if (!obj || !obj.id) throw new Error(`${table}.id fehlt`);
      if (!obj.lastModifiedAt) obj.lastModifiedAt = nowIso();
      db.prepare(`
        INSERT INTO ${table} (id, payload, last_modified) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, last_modified = excluded.last_modified
      `).run(obj.id, JSON.stringify(obj), obj.lastModifiedAt);
      return obj;
    },
    delete(id) { db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id); },
  };
}

// --- Settings -------------------------------------------------------------
function getSettings() {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get();
  return r ? JSON.parse(r.value) : null;
}
function saveSettings(s) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('settings', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(s));
  return s;
}

// Zugangsdaten externer Dienste liegen unter EIGENEN Keys, damit sie nicht im
// allgemeinen Settings-Blob landen — der geht per Snapshot ans Frontend und per
// Auto-Sync nach NocoDB. Tokens bleiben so serverseitig.
function makeConfigStore(key) {
  return {
    get() {
      const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return r ? JSON.parse(r.value) : null;
    },
    save(c) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(key, JSON.stringify(c));
      return c;
    },
  };
}
const paperlessConfig = makeConfigStore('paperless');
const homeboxConfig = makeConfigStore('homebox');

// --- Modul Bienenstöcke ---------------------------------------------------
const staendeStore = makePayloadStore('staende');
const voelkerStore = makePayloadStore('voelker');
const behandlungenStore = makePayloadStore('behandlungen');
const fuetterungenStore = makePayloadStore('fuetterungen');

const listStaende = () => staendeStore.list();
const getStand = (id) => staendeStore.get(id);
const saveStand = (s) => staendeStore.save(s);
const deleteStand = (id) => staendeStore.delete(id);

const listVoelker = () => voelkerStore.list();
const getVolk = (id) => voelkerStore.get(id);
const saveVolk = (v) => voelkerStore.save(v);
function deleteVolk(id) {
  // Durchsichts-Fotos auf der Platte wegräumen, sonst bleiben Waisen liegen.
  const dir = path.join(VOLK_FILE_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM volk_files WHERE volk_id = ?').run(id);
  voelkerStore.delete(id);
}

const listBehandlungen = () => behandlungenStore.list();
const getBehandlung = (id) => behandlungenStore.get(id);
const saveBehandlung = (b) => behandlungenStore.save(b);
const deleteBehandlung = (id) => behandlungenStore.delete(id);

const listFuetterungen = () => fuetterungenStore.list();
const getFuetterung = (id) => fuetterungenStore.get(id);
const saveFuetterung = (f) => fuetterungenStore.save(f);
const deleteFuetterung = (id) => fuetterungenStore.delete(id);

// --- Modul Honig ----------------------------------------------------------
const erntenStore = makePayloadStore('ernten');
const gebindeStore = makePayloadStore('gebinde');
const abfuellungenStore = makePayloadStore('abfuellungen');

const listErnten = () => erntenStore.list();
const getErnte = (id) => erntenStore.get(id);
const saveErnte = (e) => erntenStore.save(e);
const deleteErnte = (id) => erntenStore.delete(id);

const listGebinde = () => gebindeStore.list();
const getGebinde = (id) => gebindeStore.get(id);
const saveGebinde = (g) => gebindeStore.save(g);
const deleteGebinde = (id) => gebindeStore.delete(id);

const listAbfuellungen = () => abfuellungenStore.list();
const getAbfuellung = (id) => abfuellungenStore.get(id);
const saveAbfuellung = (a) => abfuellungenStore.save(a);
const deleteAbfuellung = (id) => abfuellungenStore.delete(id);

// --- Fotos zu einem Volk --------------------------------------------------
function listVolkFiles(volkId) {
  return db.prepare('SELECT id, volk_id AS volkId, kind, filename, mimetype, size, uploaded_at AS uploadedAt FROM volk_files WHERE volk_id = ? ORDER BY uploaded_at ASC').all(volkId);
}
function getVolkFile(id) {
  return db.prepare('SELECT id, volk_id AS volkId, kind, filename, mimetype, size, uploaded_at AS uploadedAt FROM volk_files WHERE id = ?').get(id);
}
function volkFilePath(volkId, id) {
  return path.join(VOLK_FILE_DIR, volkId, id);
}
function ensureVolkFileDir(volkId) {
  const dir = path.join(VOLK_FILE_DIR, volkId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function insertVolkFile({ id, volkId, kind, filename, mimetype, size }) {
  db.prepare('INSERT INTO volk_files (id, volk_id, kind, filename, mimetype, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, volkId, kind, filename, mimetype, size, nowIso());
  return getVolkFile(id);
}
function deleteVolkFile(id) {
  const f = getVolkFile(id);
  if (!f) return null;
  const p = volkFilePath(f.volkId, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  db.prepare('DELETE FROM volk_files WHERE id = ?').run(id);
  return f;
}

module.exports = {
  DATA_DIR, ATTACH_DIR, VOLK_FILE_DIR,
  makePayloadStore,
  getSettings, saveSettings,
  getPaperlessConfig: paperlessConfig.get, savePaperlessConfig: paperlessConfig.save,
  getHomeboxConfig: homeboxConfig.get, saveHomeboxConfig: homeboxConfig.save,
  listStaende, getStand, saveStand, deleteStand,
  listVoelker, getVolk, saveVolk, deleteVolk,
  listBehandlungen, getBehandlung, saveBehandlung, deleteBehandlung,
  listFuetterungen, getFuetterung, saveFuetterung, deleteFuetterung,
  listErnten, getErnte, saveErnte, deleteErnte,
  listGebinde, getGebinde, saveGebinde, deleteGebinde,
  listAbfuellungen, getAbfuellung, saveAbfuellung, deleteAbfuellung,
  listVolkFiles, getVolkFile, volkFilePath, ensureVolkFileDir,
  insertVolkFile, deleteVolkFile,
};

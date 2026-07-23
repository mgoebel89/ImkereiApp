'use strict';

// Backend der Imkereiverwaltung.
//
// Bewusst OHNE Nutzerverwaltung: der Container läuft in einem isolierten
// privaten Netz, das nur über einen VPN-Tunnel erreichbar ist. Weitere Nutzer
// sind nicht vorgesehen.

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const db = require('./db');
const createStoeckeRouter = require('./routes/stoecke');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '10mb' }));

// --- WebSocket-Broadcast ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === 1) {
      try { c.send(data); } catch (_) {}
    }
  }
}
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'hello', t: Date.now() }));
});

// --- Health ---
app.get('/api/health', (_req, res) => res.json({ ok: true, version: 1 }));

// --- Modul: Bienenstöcke (Stände, Völker, Behandlungen, Fütterungen) ---
app.use('/api', createStoeckeRouter(broadcast));

// --- Snapshot (Bootstrap) ---
// Das Frontend zieht beim Start EINEN Snapshot und arbeitet danach auf seinem
// Cache; Änderungen anderer Geräte kommen per WebSocket nach.
app.get('/api/snapshot', (_req, res) => {
  res.json({
    settings: db.getSettings(),
    staende: db.listStaende(),
    voelker: db.listVoelker(),
    volkFiles: groupVolkFiles(),
    behandlungen: db.listBehandlungen(),
    fuetterungen: db.listFuetterungen(),
    serverTime: new Date().toISOString(),
  });
});

function groupVolkFiles() {
  const grouped = {};
  for (const v of db.listVoelker()) {
    const files = db.listVolkFiles(v.id);
    if (files.length) grouped[v.id] = files;
  }
  return grouped;
}

// --- Settings ---
app.get('/api/settings', (_req, res) => res.json(db.getSettings() || null));
app.put('/api/settings', (req, res) => {
  const saved = db.saveSettings(req.body || {});
  broadcast({ type: 'settings:save', settings: saved, origin: req.header('x-client-id') || '' });
  res.json(saved);
});

// --- Error-Handler (z. B. multer LIMIT_FILE_SIZE) ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Serverfehler' });
});

server.listen(PORT, HOST, () => {
  console.log(`Imkerei-Backend lauscht auf http://${HOST}:${PORT}`);
});

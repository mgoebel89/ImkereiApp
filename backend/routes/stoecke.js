'use strict';

// Express-Router für das Modul „Bienenstöcke".
// Vier Entitäten nach dem Payload-Muster (Stände, Völker, Behandlungen,
// Fütterungen) plus Datei-Handling für die Fotos an den Durchsichten.
// broadcast() wird injiziert, damit Änderungen per WebSocket live an die
// anderen offenen Geräte gehen (Handy am Stand ↔ Rechner daheim).

const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const db = require('../db');

const MAX_UPLOAD = parseInt(process.env.MAX_UPLOAD_BYTES || (25 * 1024 * 1024), 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });

module.exports = function createStoeckeRouter(broadcast) {
  const router = express.Router();

  // Baut CRUD-Routen für eine Entität an einem Sub-Router.
  function mount(path, api, evName) {
    const r = express.Router();
    r.get('/', (_req, res) => res.json(api.list()));
    r.get('/:id', (req, res) => {
      const obj = api.get(req.params.id);
      if (!obj) return res.status(404).json({ error: 'not found' });
      res.json(obj);
    });
    r.put('/:id', (req, res) => {
      const body = req.body || {};
      if (body.id !== req.params.id) return res.status(400).json({ error: 'id mismatch' });
      const saved = api.save(body);
      broadcast({ type: `${evName}:save`, [evName]: saved, origin: req.header('x-client-id') || '' });
      res.json(saved);
    });
    r.delete('/:id', (req, res) => {
      api.delete(req.params.id);
      broadcast({ type: `${evName}:delete`, id: req.params.id, origin: req.header('x-client-id') || '' });
      res.status(204).end();
    });
    router.use(path, r);
  }

  mount('/staende', {
    list: db.listStaende, get: db.getStand, save: db.saveStand, delete: db.deleteStand,
  }, 'stand');
  mount('/voelker', {
    list: db.listVoelker, get: db.getVolk, save: db.saveVolk, delete: db.deleteVolk,
  }, 'volk');
  mount('/behandlungen', {
    list: db.listBehandlungen, get: db.getBehandlung, save: db.saveBehandlung, delete: db.deleteBehandlung,
  }, 'behandlung');
  mount('/fuetterungen', {
    list: db.listFuetterungen, get: db.getFuetterung, save: db.saveFuetterung, delete: db.deleteFuetterung,
  }, 'fuetterung');

  // --- Fotos zu Durchsichten ---------------------------------------------
  router.get('/voelker/:id/fotos', (req, res) => {
    res.json(db.listVolkFiles(req.params.id));
  });

  router.post('/voelker/:id/fotos', upload.single('file'), (req, res) => {
    const volkId = req.params.id;
    if (!db.getVolk(volkId)) return res.status(404).json({ error: 'volk not found' });
    if (!req.file) return res.status(400).json({ error: 'file fehlt' });
    const id = crypto.randomUUID();
    db.ensureVolkFileDir(volkId);
    fs.writeFileSync(db.volkFilePath(volkId, id), req.file.buffer);
    const rec = db.insertVolkFile({
      id,
      volkId,
      kind: req.body.kind || 'foto',
      filename: req.file.originalname,
      mimetype: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
    });
    broadcast({ type: 'volkfoto:add', file: rec, origin: req.header('x-client-id') || '' });
    res.status(201).json(rec);
  });

  router.get('/volk-files/:id', (req, res) => {
    const f = db.getVolkFile(req.params.id);
    if (!f) return res.status(404).json({ error: 'not found' });
    const p = db.volkFilePath(f.volkId, f.id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'file fehlt auf disk' });
    res.setHeader('Content-Type', f.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.filename)}"`);
    res.setHeader('Content-Length', f.size);
    fs.createReadStream(p).pipe(res);
  });

  router.delete('/volk-files/:id', (req, res) => {
    const f = db.deleteVolkFile(req.params.id);
    if (!f) return res.status(404).json({ error: 'not found' });
    broadcast({ type: 'volkfoto:delete', id: f.id, volkId: f.volkId, origin: req.header('x-client-id') || '' });
    res.status(204).end();
  });

  return router;
};

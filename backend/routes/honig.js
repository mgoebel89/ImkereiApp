'use strict';

// Express-Router für das Modul „Honig".
// Drei Entitäten nach dem Payload-Muster: Ernten, Lagergebinde, Abfüllchargen.
// Reine Datenhaltung — die Rückverfolgung rechnet das Frontend aus den
// Verweisen (Abfüllung → Gebinde → Befüllungen → Ernten → Völker).

const express = require('express');
const db = require('../db');

module.exports = function createHonigRouter(broadcast) {
  const router = express.Router();

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

  mount('/ernten', {
    list: db.listErnten, get: db.getErnte, save: db.saveErnte, delete: db.deleteErnte,
  }, 'ernte');
  mount('/gebinde', {
    list: db.listGebinde, get: db.getGebinde, save: db.saveGebinde, delete: db.deleteGebinde,
  }, 'gebinde');
  mount('/abfuellungen', {
    list: db.listAbfuellungen, get: db.getAbfuellung, save: db.saveAbfuellung, delete: db.deleteAbfuellung,
  }, 'abfuellung');

  return router;
};

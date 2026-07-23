(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.views = IM.views || {};
  const { el, karte, feld, input, select, toast, confirmDialog, leer } = IM.ui;
  const { store, models } = IM;

  let kategorie = 'allgemein';

  const KATEGORIEN = [
    { key: 'allgemein', label: 'Imkerei' },
    { key: 'daten', label: 'Daten & Sicherung' },
  ];

  function renderEinstellungen(mount) {
    mount.appendChild(el('div', { class: 'toolbar' }, [el('h1', {}, 'Einstellungen')]));

    const layout = el('div', { class: 'settings-layout' });
    const nav = el('nav', { class: 'settings-nav' });
    for (const k of KATEGORIEN) {
      nav.appendChild(el('button', {
        class: 'settings-nav-btn' + (kategorie === k.key ? ' aktiv' : ''),
        onclick: () => { kategorie = k.key; neuRendern(mount); },
      }, k.label));
    }
    layout.appendChild(nav);

    const inhalt = el('div', { class: 'settings-inhalt' });
    if (kategorie === 'allgemein') inhalt.appendChild(karteImkerei());
    if (kategorie === 'daten') {
      inhalt.appendChild(karteNocoDb(mount));
      inhalt.appendChild(karteWiederherstellung(mount));
    }
    layout.appendChild(inhalt);
    mount.appendChild(layout);
  }

  // --- Imkerei-Stammdaten ---------------------------------------------------
  function karteImkerei() {
    const s = store.getSettings();
    const i = s.imkerei;
    const setz = (key) => (e) => { i[key] = e.target.value; };

    const body = el('div', {}, [
      el('p', { class: 'muted' }, 'Diese Angaben erscheinen im Kopf jedes PDFs — auch auf dem Bestandsbuch.'),
      el('div', { class: 'form-grid' }, [
        feld('Name der Imkerei', input({ value: i.name || '', oninput: setz('name') }), { breit: true }),
        feld('Imker/in', input({ value: i.imker || '', oninput: setz('imker') })),
        feld('Anschrift', input({ value: i.anschrift || '', oninput: setz('anschrift') })),
        feld('Registriernummer (Veterinäramt)', input({ value: i.registriernummer || '', oninput: setz('registriernummer') }), { breit: true }),
        feld('Standard-Beutentyp', select(models.BEUTENTYPEN, i.standardBeutentyp, v => i.standardBeutentyp = v)),
        feld('Standard-Rähmchenmaß', select(models.RAHMENMASSE, i.standardRahmenmass, v => i.standardRahmenmass = v)),
      ]),
      el('div', { class: 'btn-reihe' }, [
        el('button', { class: 'btn btn-primary', onclick: () => { store.saveSettings(s); toast('Gespeichert'); } }, 'Speichern'),
      ]),
    ]);

    return karte('Imkerei', body);
  }

  // --- NocoDB ---------------------------------------------------------------
  function karteNocoDb(mount) {
    const s = store.getSettings();
    const n = s.nocodb;
    const log = el('pre', { class: 'log' });

    const body = el('div', {}, [
      el('p', { class: 'muted' },
        'Alle Eingaben werden zusätzlich nach NocoDB gesichert und lassen sich von dort zurückholen. ' +
        'Jede Tabelle führt eine Payload-Spalte mit dem vollständigen Datensatz — daraus stellt die App sich wieder her.'),
      el('div', { class: 'form-grid' }, [
        feld('Server-URL', input({ value: n.serverUrl || '', placeholder: 'http://192.168.1.30:8080', oninput: e => n.serverUrl = e.target.value }), { breit: true }),
        feld('API-Token (xc-token)', input({ type: 'password', value: n.token || '', oninput: e => n.token = e.target.value }), { breit: true }),
        feld('Base-ID', input({ value: n.baseId || '', oninput: e => n.baseId = e.target.value }), { breit: true }),
        feld('Auto-Sync', el('input', { type: 'checkbox', class: 'chk', checked: s.autoSync !== false, onchange: e => s.autoSync = e.target.checked })),
        feld('Intervall (Sekunden)', input({
          type: 'number', min: 15, value: s.autoSyncIntervalSec || 60,
          oninput: e => s.autoSyncIntervalSec = Math.max(15, Number(e.target.value) || 60),
        })),
      ]),
      el('div', { class: 'btn-reihe' }, [
        el('button', { class: 'btn btn-primary', onclick: () => { store.saveSettings(s); toast('Gespeichert'); } }, 'Speichern'),
        el('button', {
          class: 'btn', onclick: async (e) => {
            store.saveSettings(s);
            await mitLadeZustand(e.target, 'Prüfe…', async () => {
              const r = await IM.nocodb_client.testConnection();
              log.textContent = `Verbindung steht. ${r.tabellen} Tabelle(n) in der Base gefunden.`;
            }, log);
          },
        }, 'Verbindung testen'),
        el('button', {
          class: 'btn', onclick: async (e) => {
            store.saveSettings(s);
            await mitLadeZustand(e.target, 'Lege an…', async () => {
              const zeilen = await IM.nocodb_client.initSchema();
              log.textContent = zeilen.join('\n');
            }, log);
          },
        }, 'Schema initialisieren'),
        el('button', {
          class: 'btn', onclick: async (e) => {
            await mitLadeZustand(e.target, 'Sichere…', async () => {
              await IM.auto_sync.triggerNow();
              const st = IM.auto_sync.getState();
              log.textContent = st.lastError
                ? `Fehler: ${st.lastError}`
                : `Sync abgeschlossen. Offen: ${st.pending}.`;
            }, log);
          },
        }, 'Jetzt sichern'),
      ]),
      log,
    ]);

    return karte('NocoDB-Sicherung', body);
  }

  // Knopf während einer laufenden Aktion sperren — ein zweiter Klick auf
  // „Schema initialisieren" legt sonst Tabellen doppelt an.
  async function mitLadeZustand(btn, text, fn, log) {
    const alt = btn.textContent;
    btn.disabled = true;
    btn.textContent = text;
    try {
      await fn();
    } catch (err) {
      if (log) log.textContent = 'Fehler: ' + err.message;
      toast('Fehler: ' + err.message, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = alt;
    }
  }

  // --- Wiederherstellung ----------------------------------------------------
  function karteWiederherstellung(mount) {
    const log = el('pre', { class: 'log' });

    const body = el('div', {}, [
      el('p', { class: 'muted' },
        'Holt fehlende Datensätze aus NocoDB zurück. Lokal vorhandene Datensätze bleiben unangetastet — ' +
        'bei gleicher ID gewinnt immer der lokale Stand. Es wird also ergänzt, nie überschrieben.'),
      el('div', { class: 'btn-reihe' }, [
        el('button', {
          class: 'btn', onclick: async (e) => {
            if (!IM.nocodb_client.isConfigured()) { toast('NocoDB ist nicht konfiguriert.'); return; }
            if (!confirmDialog('Fehlende Datensätze aus NocoDB zurückholen?')) return;
            await mitLadeZustand(e.target, 'Hole…', async () => {
              const r = await IM.nocodb_client.restoreFromNocoDb();
              const zeilen = [];
              zeilen.push(r.details.length ? 'Ergänzt: ' + r.details.join(', ') : 'Nichts zu ergänzen — alles schon lokal vorhanden.');
              if (r.fehler.length) zeilen.push('', 'Probleme:', ...r.fehler);
              log.textContent = zeilen.join('\n');
              neuRendern(mount);
            }, log);
          },
        }, 'Aus NocoDB wiederherstellen'),
      ]),
      log,
      el('h3', { class: 'abschnitt' }, 'Lokale Sicherung'),
      leer('Die SQLite-Datenbank und die Fotos werden im Container täglich um 03:30 gesichert (Verzeichnis /var/backups/imkerei). ' +
        'Ein Backup lässt sich in der Container-Konsole jederzeit mit „imkerei-backup" anstoßen.'),
    ]);

    return karte('Wiederherstellung', body);
  }

  function neuRendern(mount) {
    mount.innerHTML = '';
    renderEinstellungen(mount);
  }

  IM.views.renderEinstellungen = renderEinstellungen;
})();

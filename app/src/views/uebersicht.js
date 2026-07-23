(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.views = IM.views || {};
  const { el, karte, leer, formatDatum } = IM.ui;
  const { store, models } = IM;

  // Startseite: was muss ich als Nächstes tun? Die Karten sind danach sortiert,
  // nicht nach Modulen — Zahlen ohne Handlungsbedarf stehen unten.
  function renderUebersicht(mount) {
    const voelker = store.listVoelker();
    const aktive = voelker.filter(v => v.status === 'aktiv');
    const staende = store.listStaende();

    mount.appendChild(el('div', { class: 'toolbar' }, [el('h1', {}, 'Übersicht')]));

    if (!staende.length && !voelker.length) {
      mount.appendChild(karte('Willkommen', el('div', {}, [
        el('p', {}, 'Die Imkereiverwaltung ist noch leer. Sinnvolle Reihenfolge:'),
        el('ol', { class: 'liste-num' }, [
          el('li', {}, 'Unter „Einstellungen" die Imkerei-Stammdaten eintragen (sie erscheinen auf jedem PDF).'),
          el('li', {}, 'Unter „Stände" den ersten Aufstellungsort anlegen.'),
          el('li', {}, 'Unter „Völker" die Völker erfassen — dann kann die Stockkarte losgehen.'),
        ]),
        el('div', { class: 'btn-reihe' }, [
          el('a', { class: 'btn btn-primary', href: '#/staende' }, 'Zu den Ständen'),
          el('a', { class: 'btn', href: '#/einstellungen' }, 'Zu den Einstellungen'),
        ]),
      ])));
      return;
    }

    const grid = el('div', { class: 'dash-grid' });
    grid.appendChild(karteFaellig(aktive));
    grid.appendChild(karteWartezeiten(aktive));
    grid.appendChild(karteStaende(staende, voelker));
    grid.appendChild(karteKoeniginnen(aktive));
    grid.appendChild(karteHonig());
    grid.appendChild(karteLetzteEintraege());
    mount.appendChild(grid);
  }

  // --- Fällige Durchsichten -------------------------------------------------
  function karteFaellig(aktive) {
    const bewertet = aktive
      .map(v => ({ v, f: models.durchsichtFaellig(v) }))
      .filter(x => x.f && (x.f.stufe === 'faellig' || x.f.stufe === 'offen'))
      .sort((a, b) => (models.tageSeitDurchsicht(b.v) ?? 9999) - (models.tageSeitDurchsicht(a.v) ?? 9999));

    const inhalt = bewertet.length
      ? el('ul', { class: 'liste' }, bewertet.slice(0, 12).map(x =>
          el('li', {}, [
            el('a', { href: `#/voelker?id=${encodeURIComponent(x.v.id)}` }, models.volkBezeichnung(x.v)),
            el('span', { class: 'muted' }, ' — ' + x.f.text),
          ])))
      : leer('Alle Völker sind aktuell durchgesehen.');

    return karte(`Durchsicht fällig (${bewertet.length})`, inhalt);
  }

  // --- Laufende Wartezeiten -------------------------------------------------
  // Die wichtigste Sperre der Saison: solange eine Wartezeit läuft, darf von
  // diesem Volk nicht geerntet werden.
  function karteWartezeiten(aktive) {
    const behandlungen = store.listBehandlungen();
    const offen = aktive
      .map(v => ({ v, bis: models.offeneWartezeit(behandlungen, v.id) }))
      .filter(x => x.bis)
      .sort((a, b) => a.bis.localeCompare(b.bis));

    const inhalt = offen.length
      ? el('ul', { class: 'liste' }, offen.map(x =>
          el('li', {}, [
            el('a', { href: `#/voelker?id=${encodeURIComponent(x.v.id)}` }, models.volkBezeichnung(x.v)),
            el('span', { class: 'muted' }, ` — gesperrt bis ${formatDatum(x.bis)}`),
          ])))
      : leer('Keine laufende Wartezeit — es darf geerntet werden.');

    return karte(`Wartezeiten (${offen.length})`, inhalt);
  }

  // --- Stände ---------------------------------------------------------------
  function karteStaende(staende, voelker) {
    const inhalt = staende.length
      ? el('ul', { class: 'liste' }, staende.map(s => {
          const n = models.voelkerAmStand(voelker, s.id, true).length;
          return el('li', {}, [
            el('a', { href: `#/voelker?stand=${encodeURIComponent(s.id)}` }, s.name || 'Ohne Namen'),
            el('span', { class: 'muted' }, ` — ${n} Volk/Völker`),
          ]);
        }))
      : leer('Noch kein Stand angelegt.');

    const gesamt = voelker.filter(v => v.status === 'aktiv').length;
    return karte(`Stände (${gesamt} aktive Völker)`, inhalt);
  }

  // --- Königinnen -----------------------------------------------------------
  function karteKoeniginnen(aktive) {
    const jahr = new Date().getFullYear();
    const alt = aktive
      .map(v => ({ v, alter: models.koeniginAlter(v, jahr) }))
      .filter(x => x.alter !== null && x.alter >= 3)
      .sort((a, b) => b.alter - a.alter);
    const ohne = aktive.filter(v => !(v.koenigin && v.koenigin.jahr)).length;

    const inhalt = el('div', {}, [
      alt.length
        ? el('ul', { class: 'liste' }, alt.slice(0, 10).map(x =>
            el('li', {}, [
              el('a', { href: `#/voelker?id=${encodeURIComponent(x.v.id)}` }, models.volkBezeichnung(x.v)),
              el('span', { class: 'muted' }, ` — Königin ${x.alter} Jahre (${x.v.koenigin.jahr})`),
            ])))
        : leer('Keine Königin ist drei Jahre oder älter.'),
      ohne ? el('p', { class: 'muted' }, `${ohne} Volk/Völker ohne erfassten Königinnen-Jahrgang.`) : null,
    ]);

    return karte(`Königinnen zum Umweiseln (${alt.length})`, inhalt);
  }

  // --- Honig ----------------------------------------------------------------
  // Die drei Zahlen, die die Saison zusammenfassen: was kam rein, was liegt noch
  // im Lager, was ist im Glas.
  function karteHonig() {
    const jahr = String(new Date().getFullYear());
    const ernten = store.listErnten().filter(e => String(e.datum || '').startsWith(jahr));
    const abf = store.listAbfuellungen();
    const abfJahr = abf.filter(a => String(a.datum || '').startsWith(jahr));
    const geerntet = ernten.reduce((s, e) => s + models.ernteMenge(e), 0);
    const imLager = store.listGebinde().reduce((s, g) => s + Math.max(0, models.gebindeRest(g, abf)), 0);
    const glaeser = abfJahr.reduce((s, a) => s + (Number(a.anzahlGlaeser) || 0), 0);

    // Ernten, die nirgends eingelagert wurden — die reißen sonst still die
    // Rückverfolgung auf.
    const ohneGebinde = ernten.filter(e =>
      !store.listGebinde().some(g => (g.befuellungen || []).some(b => b.ernteId === e.id)));

    const inhalt = el('div', {}, [
      el('div', { class: 'kachel-zahlen' }, [
        el('div', { class: 'zahl' }, [el('strong', {}, IM.ui.formatZahl(geerntet, 1)), el('span', {}, 'kg geerntet')]),
        el('div', { class: 'zahl' }, [el('strong', {}, IM.ui.formatZahl(imLager, 1)), el('span', {}, 'kg im Lager')]),
        el('div', { class: 'zahl' }, [el('strong', {}, String(glaeser)), el('span', {}, 'Gläser abgefüllt')]),
      ]),
      ohneGebinde.length
        ? el('div', { class: 'ampel ampel-bald' },
            `${ohneGebinde.length} Ernte(n) ohne Lagergebinde — dort fehlt die Herkunftskette.`)
        : null,
      el('div', { class: 'btn-reihe' }, [
        el('a', { class: 'btn btn-sm', href: '#/honig' }, 'Zum Honigmodul'),
      ]),
    ]);

    return karte(`Honig ${jahr}`, inhalt);
  }

  // --- Letzte Einträge ------------------------------------------------------
  function karteLetzteEintraege() {
    const eintraege = [];
    for (const v of store.listVoelker()) {
      for (const d of (v.durchsichten || [])) {
        eintraege.push({ datum: d.datum, text: `Durchsicht ${models.volkBezeichnung(v)}`, href: `#/voelker?id=${encodeURIComponent(v.id)}` });
      }
    }
    for (const b of store.listBehandlungen()) {
      eintraege.push({
        datum: b.datum,
        text: (b.art === 'diagnose' ? 'Diagnose' : 'Behandlung') + (b.praeparat ? ' ' + b.praeparat : '') + ` (${(b.volkIds || []).length} Völker)`,
        href: '#/behandlungen',
      });
    }
    for (const f of store.listFuetterungen()) {
      eintraege.push({ datum: f.datum, text: `Fütterung ${f.futterart || ''} (${(f.volkIds || []).length} Völker)`, href: '#/behandlungen' });
    }
    eintraege.sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));

    const inhalt = eintraege.length
      ? el('ul', { class: 'liste' }, eintraege.slice(0, 10).map(e =>
          el('li', {}, [
            el('span', { class: 'muted' }, formatDatum(e.datum) + ' '),
            el('a', { href: e.href }, e.text),
          ])))
      : leer('Noch keine Einträge.');

    return karte('Zuletzt erfasst', inhalt);
  }

  IM.views.renderUebersicht = renderUebersicht;
})();

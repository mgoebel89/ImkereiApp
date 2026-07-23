(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.views = IM.views || {};
  const { el, karte, feld, input, textarea, select, modal, toast, confirmDialog, leer,
          formatDatum, formatZahl } = IM.ui;
  const { store, models } = IM;

  // Drei Reiter für die drei Stufen des Honigwegs. Sie sind nacheinander zu
  // füllen — geerntet, eingelagert, abgefüllt —, deshalb stehen sie in dieser
  // Reihenfolge und nicht alphabetisch.
  let reiter = 'ernten';
  let jahrFilter = '';

  function renderHonig(mount, params) {
    params = params || {};
    if (params.reiter) reiter = params.reiter;
    renderSeite(mount);
    // Direktsprung aus einer Verlinkung (z. B. Chargenblatt aus der Übersicht)
    if (params.charge) {
      const a = store.getAbfuellung(params.charge);
      if (a) abfuellungBearbeiten(a, () => neuRendern(mount));
    }
  }

  function renderSeite(mount) {
    mount.appendChild(el('div', { class: 'toolbar' }, [el('h1', {}, 'Honig')]));

    mount.appendChild(el('div', { class: 'reiter' }, [
      reiterKnopf(mount, 'ernten', 'Ernten'),
      reiterKnopf(mount, 'gebinde', 'Lagergebinde'),
      reiterKnopf(mount, 'abfuellungen', 'Abfüllchargen'),
    ]));

    if (reiter === 'ernten') return renderErnten(mount);
    if (reiter === 'gebinde') return renderGebinde(mount);
    return renderAbfuellungen(mount);
  }

  function reiterKnopf(mount, key, label) {
    return el('button', {
      class: 'reiter-btn' + (reiter === key ? ' aktiv' : ''),
      onclick: () => { reiter = key; neuRendern(mount); },
    }, label);
  }

  function jahreAus(liste) {
    return [...new Set(liste.map(x => String(x.datum || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  }

  function nachJahr(liste) {
    return jahrFilter ? liste.filter(x => String(x.datum || '').startsWith(jahrFilter)) : liste;
  }

  function volkListe(ids) {
    const namen = (ids || []).map(id => {
      const v = store.getVolk(id);
      return v ? models.volkBezeichnung(v) : '?';
    });
    if (!namen.length) return 'keine Völker zugeordnet';
    if (namen.length <= 5) return namen.join(', ');
    return `${namen.slice(0, 5).join(', ')} + ${namen.length - 5} weitere`;
  }

  // ===========================================================================
  // Stufe 1: Ernten
  // ===========================================================================
  function renderErnten(mount) {
    const alle = store.listErnten();
    mount.appendChild(el('div', { class: 'filterbar' }, [
      select(jahreAus(alle), jahrFilter, v => { jahrFilter = v; neuRendern(mount); }, { leerLabel: 'Alle Jahre' }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', onclick: () => ernteBearbeiten(null, () => neuRendern(mount)) }, '＋ Ernte'),
    ]));

    const liste = nachJahr(alle).sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));
    if (!liste.length) {
      mount.appendChild(karte(null, leer('Noch keine Ernte erfasst.')));
      return;
    }

    const summe = liste.reduce((s, e) => s + models.ernteMenge(e), 0);
    mount.appendChild(el('div', { class: 'kennzahl' }, [
      el('strong', {}, `${formatZahl(summe, 1)} kg`),
      el('span', { class: 'muted' }, `aus ${liste.length} Erntevorgang/-vorgängen${jahrFilter ? ' im Jahr ' + jahrFilter : ''}`),
    ]));

    const box = el('div', {});
    for (const e of liste) box.appendChild(ernteZeile(mount, e));
    mount.appendChild(karte(null, box));
  }

  function ernteZeile(mount, e) {
    const stand = store.getStand(e.standId);
    const wg = models.wassergehaltBewertung(e.wassergehalt);
    // Wo liegt diese Ernte inzwischen? Ohne diesen Hinweis übersieht man leicht
    // eine Ernte, die nie eingelagert wurde.
    const gebinde = store.listGebinde().filter(g => (g.befuellungen || []).some(b => b.ernteId === e.id));

    return el('div', {
      class: 'eintrag', onclick: () => ernteBearbeiten(e, () => neuRendern(mount)),
    }, [
      el('div', { class: 'eintrag-kopf' }, [
        el('strong', {}, formatDatum(e.datum)),
        e.tracht ? el('span', { class: 'badge' }, e.tracht) : null,
        el('span', { class: 'badge' }, `${formatZahl(models.ernteMenge(e), 1)} kg`),
        wg ? el('span', { class: 'badge badge-' + wg.stufe }, `${e.wassergehalt} % — ${wg.text}`) : null,
      ]),
      el('div', { class: 'muted' }, [
        stand ? stand.name + ' · ' : '',
        volkListe(e.volkIds),
        e.schleuderdatum ? ` · geschleudert ${formatDatum(e.schleuderdatum)}` : '',
      ].join('')),
      gebinde.length
        ? el('div', { class: 'muted' }, 'Eingelagert in: ' + gebinde.map(g => gebindeName(g)).join(', '))
        : el('div', { class: 'ampel ampel-bald' }, 'Noch keinem Lagergebinde zugeordnet'),
    ]);
  }

  function ernteBearbeiten(original, refresh) {
    const istNeu = !original;
    const e = original ? JSON.parse(JSON.stringify(original)) : models.emptyErnte();
    if (!e.wiegungen.length) e.wiegungen.push(models.emptyWiegung());

    const summeBox = el('div', { class: 'kennzahl' });
    const warnBox = el('div', {});

    function summe() {
      summeBox.innerHTML = '';
      summeBox.appendChild(el('strong', {}, `${formatZahl(models.ernteMenge(e), 2)} kg netto`));
      const n = e.wiegungen.filter(w => Number(w.brutto)).length;
      summeBox.appendChild(el('span', { class: 'muted' }, `aus ${n} Eimer(n)`));
      const wg = models.wassergehaltBewertung(e.wassergehalt);
      if (wg) summeBox.appendChild(el('span', { class: 'badge badge-' + wg.stufe }, wg.text));
    }

    // Wartezeit-Sperre: von einem Volk, das noch in der Wartezeit einer
    // Arzneimittel-Anwendung steht, darf nicht geerntet werden. Die App hält
    // niemanden auf, aber sie sagt es deutlich.
    function warnungen() {
      warnBox.innerHTML = '';
      const behandlungen = store.listBehandlungen();
      const betroffen = [];
      for (const id of e.volkIds) {
        const bis = models.offeneWartezeit(behandlungen, id, e.datum);
        if (bis) {
          const v = store.getVolk(id);
          betroffen.push(`${v ? models.volkBezeichnung(v) : id} (bis ${formatDatum(bis)})`);
        }
      }
      if (betroffen.length) {
        warnBox.appendChild(el('div', { class: 'ampel ampel-warnung' },
          `Achtung — Wartezeit läuft noch: ${betroffen.join(', ')}. Dieser Honig darf nicht in den Verkehr.`));
      }
    }

    const wiegungenBox = el('div', {});
    function wiegungenRendern() {
      wiegungenBox.innerHTML = '';
      e.wiegungen.forEach((w, i) => {
        const zeile = el('div', { class: 'wiegung-zeile' }, [
          input({
            class: 'inp wiegung-bez', value: w.bezeichnung || '', placeholder: `Eimer ${i + 1}`,
            oninput: ev => w.bezeichnung = ev.target.value,
          }),
          input({
            class: 'inp', type: 'number', step: '0.01', min: 0, value: w.brutto ?? '', placeholder: 'brutto kg',
            oninput: ev => { w.brutto = ev.target.value === '' ? null : Number(ev.target.value); nettoZeigen(); summe(); },
          }),
          input({
            class: 'inp', type: 'number', step: '0.01', min: 0, value: w.tara ?? '', placeholder: 'tara kg',
            oninput: ev => { w.tara = ev.target.value === '' ? null : Number(ev.target.value); nettoZeigen(); summe(); },
          }),
          el('span', { class: 'wiegung-netto' }, ''),
          el('button', {
            class: 'link-danger', type: 'button', title: 'Eimer entfernen',
            onclick: () => {
              e.wiegungen = e.wiegungen.filter(x => x.id !== w.id);
              if (!e.wiegungen.length) e.wiegungen.push(models.emptyWiegung());
              wiegungenRendern(); summe();
            },
          }, '✕'),
        ]);
        zeile._wiegung = w;
        wiegungenBox.appendChild(zeile);
      });
      wiegungenBox.appendChild(el('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => { e.wiegungen.push(models.emptyWiegung()); wiegungenRendern(); },
      }, '＋ Eimer'));
      nettoZeigen();
    }
    function nettoZeigen() {
      wiegungenBox.querySelectorAll('.wiegung-zeile').forEach(z => {
        const feldNetto = z.querySelector('.wiegung-netto');
        const n = models.wiegungNetto(z._wiegung);
        feldNetto.textContent = n ? `= ${formatZahl(n, 2)} kg` : '';
      });
    }
    wiegungenRendern();

    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        feld('Entnahme am', input({ type: 'date', value: e.datum || '', oninput: ev => { e.datum = ev.target.value; warnungen(); } })),
        feld('Geschleudert am', input({ type: 'date', value: e.schleuderdatum || '', oninput: ev => e.schleuderdatum = ev.target.value })),
        feld('Tracht / Sorte', select(models.TRACHTEN, e.tracht, v => e.tracht = v), { breit: true }),
        feld('Wassergehalt (%)', input({
          type: 'number', step: '0.1', min: 0, max: 30, value: e.wassergehalt ?? '',
          oninput: ev => { e.wassergehalt = ev.target.value === '' ? null : Number(ev.target.value); summe(); },
        })),
      ]),
      el('h3', { class: 'abschnitt' }, 'Beerntete Völker'),
      IM.views.volkAuswahl(e, () => warnungen()),
      warnBox,
      el('h3', { class: 'abschnitt' }, 'Eimer wiegen (brutto / tara)'),
      el('p', { class: 'muted' }, 'Die Nettomenge rechnet die App — so bleibt später nachvollziehbar, wie sie zustande kam.'),
      wiegungenBox,
      summeBox,
    ]);
    summe(); warnungen();

    const m = modal(istNeu ? 'Neue Ernte' : 'Ernte ' + formatDatum(e.datum), body, {
      fuss: [
        !istNeu ? el('button', {
          class: 'btn btn-danger', onclick: () => {
            const inGebinde = store.listGebinde().filter(g => (g.befuellungen || []).some(b => b.ernteId === e.id));
            if (inGebinde.length) {
              toast(`Ernte ist in ${inGebinde.map(gebindeName).join(', ')} eingelagert — dort erst entfernen.`, 5000);
              return;
            }
            if (!confirmDialog('Diese Ernte löschen?')) return;
            store.deleteErnte(e.id);
            m.close(); refresh();
          },
        }, 'Löschen') : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!e.datum) { toast('Bitte ein Datum angeben.'); return; }
            if (!models.ernteMenge(e)) { toast('Bitte mindestens einen Eimer wiegen.'); return; }
            // Leere Eimerzeilen nicht mitschleppen
            e.wiegungen = e.wiegungen.filter(w => Number(w.brutto));
            store.saveErnte(e);
            m.close(); refresh();
            toast('Ernte gespeichert');
          },
        }, 'Speichern'),
      ],
    });
  }

  // ===========================================================================
  // Stufe 2: Lagergebinde
  // ===========================================================================
  function gebindeName(g) {
    return [g.nummer ? '#' + g.nummer : '', g.bezeichnung].filter(Boolean).join(' ') || 'Gebinde';
  }

  function renderGebinde(mount) {
    const liste = store.listGebinde().slice()
      .sort((a, b) => String(a.nummer || '').localeCompare(String(b.nummer || ''), 'de', { numeric: true }));

    mount.appendChild(el('div', { class: 'filterbar' }, [
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', onclick: () => gebindeBearbeiten(null, () => neuRendern(mount)) }, '＋ Gebinde'),
    ]));

    if (!liste.length) {
      mount.appendChild(karte(null, leer('Noch kein Lagergebinde angelegt. Ein Gebinde ist der Hobbock, in den geerntet wird — aus ihm wird später abgefüllt.')));
      return;
    }

    const abf = store.listAbfuellungen();
    const grid = el('div', { class: 'kachel-grid' });
    for (const g of liste) {
      const gefuellt = models.gebindeGefuellt(g);
      const rest = models.gebindeRest(g, abf);
      const trachten = [...new Set((g.befuellungen || [])
        .map(b => (store.getErnte(b.ernteId) || {}).tracht).filter(Boolean))];
      grid.appendChild(el('div', {
        class: 'kachel', onclick: () => gebindeBearbeiten(g, () => neuRendern(mount)),
      }, [
        el('div', { class: 'kachel-kopf' }, [
          el('h3', {}, gebindeName(g)),
          rest <= 0 && gefuellt > 0 ? el('span', { class: 'tag' }, 'leer') : null,
        ]),
        trachten.length ? el('p', { class: 'muted' }, trachten.join(', ')) : null,
        el('div', { class: 'kachel-zahlen' }, [
          el('div', { class: 'zahl' }, [el('strong', {}, formatZahl(rest, 1)), el('span', {}, 'kg übrig')]),
          el('div', { class: 'zahl' }, [el('strong', {}, formatZahl(gefuellt, 1)), el('span', {}, 'kg gefüllt')]),
        ]),
        g.standort ? el('div', { class: 'muted' }, g.standort) : null,
      ]));
    }
    mount.appendChild(grid);
  }

  function gebindeBearbeiten(original, refresh) {
    const istNeu = !original;
    const g = original ? JSON.parse(JSON.stringify(original)) : models.emptyGebinde();
    if (istNeu && !g.nummer) {
      const nummern = store.listGebinde().map(x => parseInt(x.nummer, 10)).filter(n => !isNaN(n));
      g.nummer = String(nummern.length ? Math.max(...nummern) + 1 : 1);
    }

    const bilanzBox = el('div', { class: 'kennzahl' });
    const befBox = el('div', {});

    function bilanz() {
      const abf = store.listAbfuellungen();
      const gefuellt = models.gebindeGefuellt(g);
      const entnommen = models.gebindeEntnommen(g.id, abf);
      const rest = Math.round((gefuellt - entnommen) * 100) / 100;
      bilanzBox.innerHTML = '';
      bilanzBox.appendChild(el('strong', {}, `${formatZahl(rest, 2)} kg im Gebinde`));
      bilanzBox.appendChild(el('span', { class: 'muted' }, `${formatZahl(gefuellt, 2)} kg eingefüllt − ${formatZahl(entnommen, 2)} kg abgefüllt`));
      if (g.kapazitaetKg && gefuellt > Number(g.kapazitaetKg)) {
        bilanzBox.appendChild(el('span', { class: 'badge badge-warnung' }, 'über der Kapazität'));
      }
      if (rest < 0) {
        bilanzBox.appendChild(el('span', { class: 'badge badge-kritisch' }, 'mehr abgefüllt als eingefüllt'));
      }
    }

    function befuellungenRendern() {
      befBox.innerHTML = '';
      if (!g.befuellungen.length) {
        befBox.appendChild(leer('Noch nichts eingefüllt.'));
      }
      // Nur Ernten anbieten, die noch nicht in diesem Gebinde stecken — eine
      // Ernte zweimal in denselben Hobbock zu buchen ist immer ein Versehen.
      const schonDrin = new Set(g.befuellungen.map(b => b.ernteId));
      for (const b of g.befuellungen) {
        const e = store.getErnte(b.ernteId);
        befBox.appendChild(el('div', { class: 'bef-zeile' }, [
          el('div', { class: 'bef-text' }, [
            el('strong', {}, e ? `${formatDatum(e.datum)} ${e.tracht || ''}`.trim() : '(Ernte gelöscht)'),
            el('div', { class: 'muted' }, e ? volkListe(e.volkIds) : ''),
          ]),
          input({
            class: 'inp bef-menge', type: 'number', step: '0.01', min: 0, value: b.mengeKg ?? '',
            oninput: ev => { b.mengeKg = ev.target.value === '' ? null : Number(ev.target.value); bilanz(); },
          }),
          el('span', { class: 'muted' }, 'kg'),
          el('button', {
            class: 'link-danger', type: 'button', title: 'Befüllung entfernen',
            onclick: () => { g.befuellungen = g.befuellungen.filter(x => x.id !== b.id); befuellungenRendern(); bilanz(); },
          }, '✕'),
        ]));
      }

      const offen = store.listErnten()
        .filter(e => !schonDrin.has(e.id))
        .sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
      if (offen.length) {
        befBox.appendChild(el('div', { class: 'btn-reihe' }, [
          select(offen.map(e => ({
            wert: e.id,
            label: `${formatDatum(e.datum)} · ${e.tracht || 'ohne Tracht'} · ${formatZahl(models.ernteMenge(e), 1)} kg`,
          })), '', v => {
            if (!v) return;
            const e = store.getErnte(v);
            const b = models.emptyBefuellung();
            b.ernteId = v;
            // Voreinstellung: die volle Erntemenge minus dem, was schon
            // woanders eingelagert ist — meistens genau richtig.
            b.mengeKg = restVonErnte(e, g.id);
            g.befuellungen.push(b);
            befuellungenRendern(); bilanz();
          }, { leerLabel: '＋ Ernte einfüllen…' }),
        ]));
      }
    }
    befuellungenRendern();
    bilanz();

    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        feld('Nummer', input({ value: g.nummer || '', oninput: ev => g.nummer = ev.target.value })),
        feld('Bezeichnung', input({ value: g.bezeichnung || '', placeholder: 'z. B. Hobbock 25 kg', oninput: ev => g.bezeichnung = ev.target.value })),
        feld('Kapazität (kg)', input({
          type: 'number', step: '0.1', min: 0, value: g.kapazitaetKg ?? '',
          oninput: ev => { g.kapazitaetKg = ev.target.value === '' ? null : Number(ev.target.value); bilanz(); },
        })),
        feld('Lagerort', input({ value: g.standort || '', oninput: ev => g.standort = ev.target.value })),
      ]),
      el('h3', { class: 'abschnitt' }, 'Eingefüllte Ernten'),
      befBox,
      bilanzBox,
      el('h3', { class: 'abschnitt' }, 'Notiz'),
      textarea({ value: g.notiz || '', oninput: ev => g.notiz = ev.target.value }),
    ]);

    const m = modal(istNeu ? 'Neues Lagergebinde' : gebindeName(g), body, {
      fuss: [
        !istNeu ? el('button', {
          class: 'btn btn-danger', onclick: () => {
            const chargen = store.listAbfuellungen().filter(a => a.gebindeId === g.id);
            if (chargen.length) {
              toast(`${chargen.length} Abfüllcharge(n) verweisen auf dieses Gebinde — die Herkunft ginge verloren.`, 5000);
              return;
            }
            if (!confirmDialog('Dieses Gebinde löschen?')) return;
            store.deleteGebinde(g.id);
            m.close(); refresh();
          },
        }, 'Löschen') : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            g.befuellungen = g.befuellungen.filter(b => Number(b.mengeKg));
            store.saveGebinde(g);
            m.close(); refresh();
            toast('Gebinde gespeichert');
          },
        }, 'Speichern'),
      ],
    });
  }

  // Wie viel dieser Ernte ist noch nicht eingelagert? (ohne das Gebinde, das
  // gerade bearbeitet wird — dessen Wert wird ja neu gesetzt)
  function restVonErnte(ernte, ausserGebindeId) {
    if (!ernte) return null;
    const verteilt = store.listGebinde()
      .filter(g => g.id !== ausserGebindeId)
      .reduce((s, g) => s + (g.befuellungen || [])
        .filter(b => b.ernteId === ernte.id)
        .reduce((s2, b) => s2 + (Number(b.mengeKg) || 0), 0), 0);
    const rest = Math.round((models.ernteMenge(ernte) - verteilt) * 100) / 100;
    return rest > 0 ? rest : null;
  }

  // ===========================================================================
  // Stufe 3: Abfüllchargen
  // ===========================================================================
  function renderAbfuellungen(mount) {
    const alle = store.listAbfuellungen();
    mount.appendChild(el('div', { class: 'filterbar' }, [
      select(jahreAus(alle), jahrFilter, v => { jahrFilter = v; neuRendern(mount); }, { leerLabel: 'Alle Jahre' }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary',
        onclick: () => abfuellungBearbeiten(null, () => neuRendern(mount)),
      }, '＋ Abfüllung'),
    ]));

    const liste = nachJahr(alle).sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));
    if (!liste.length) {
      mount.appendChild(karte(null, leer('Noch keine Abfüllcharge erfasst.')));
      return;
    }

    const glaeser = liste.reduce((s, a) => s + (Number(a.anzahlGlaeser) || 0), 0);
    const kg = liste.reduce((s, a) => s + models.abfuellMenge(a), 0);
    mount.appendChild(el('div', { class: 'kennzahl' }, [
      el('strong', {}, `${glaeser} Gläser`),
      el('span', { class: 'muted' }, `= ${formatZahl(kg, 1)} kg in ${liste.length} Charge(n)${jahrFilter ? ' im Jahr ' + jahrFilter : ''}`),
    ]));

    const tab = el('table', { class: 'ds-tabelle' });
    tab.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Los'), el('th', {}, 'Abgefüllt'), el('th', {}, 'MHD'),
      el('th', {}, 'Sorte'), el('th', {}, 'Glas'), el('th', {}, 'Gläser'),
      el('th', {}, 'Menge'), el('th', {}, 'Herkunft'), el('th', {}, ''),
    ])));
    const body = el('tbody', {});
    for (const a of liste) {
      const h = models.chargenHerkunft(a, store.listGebinde(), store.listErnten());
      body.appendChild(el('tr', {
        class: 'ds-zeile', onclick: () => abfuellungBearbeiten(a, () => neuRendern(mount)),
      }, [
        el('td', { class: 'ds-sp-datum' }, a.losnummer || '—'),
        el('td', {}, formatDatum(a.datum)),
        el('td', {}, formatDatum(a.mhd)),
        el('td', {}, a.sorte || (h.trachten.join(', ') || '')),
        el('td', {}, a.glasGroesseG ? `${a.glasGroesseG} g` : ''),
        el('td', {}, String(a.anzahlGlaeser ?? '')),
        el('td', {}, `${formatZahl(models.abfuellMenge(a), 1)} kg`),
        el('td', {}, h.gebinde ? gebindeName(h.gebinde) : '—'),
        el('td', { class: 'ds-sp-aktion' }, el('button', {
          class: 'btn btn-sm',
          onclick: (ev) => { ev.stopPropagation(); IM.export.chargenblattPdf(a); },
        }, '📄')),
      ]));
    }
    tab.appendChild(body);
    mount.appendChild(karte(null, el('div', { class: 'tabelle-scroll' }, tab)));
  }

  function abfuellungBearbeiten(original, refresh) {
    const istNeu = !original;
    const a = original ? JSON.parse(JSON.stringify(original)) : models.emptyAbfuellung();
    if (istNeu) {
      a.losnummer = models.losnummerVorschlag(store.listAbfuellungen(), a.datum);
      a.mhd = models.mhdVorschlag(a.datum);
    }

    const bilanzBox = el('div', { class: 'kennzahl' });
    const herkunftBox = el('div', {});

    function bilanz() {
      bilanzBox.innerHTML = '';
      const menge = models.abfuellMenge(a);
      bilanzBox.appendChild(el('strong', {}, `${formatZahl(menge, 2)} kg`));
      bilanzBox.appendChild(el('span', { class: 'muted' }, `${a.anzahlGlaeser || 0} × ${a.glasGroesseG || 0} g`));

      const g = store.getGebinde(a.gebindeId);
      if (g) {
        // Verfügbar = Rest im Gebinde, wobei diese Charge selbst nicht doppelt
        // zählen darf, wenn sie schon gespeichert war.
        const andere = store.listAbfuellungen().filter(x => x.id !== a.id);
        const rest = Math.round((models.gebindeGefuellt(g) - models.gebindeEntnommen(g.id, andere)) * 100) / 100;
        const uebrig = Math.round((rest - menge) * 100) / 100;
        bilanzBox.appendChild(el('span', { class: 'badge' + (uebrig < 0 ? ' badge-kritisch' : '') },
          uebrig < 0
            ? `${formatZahl(-uebrig, 2)} kg mehr als im Gebinde liegt`
            : `${formatZahl(uebrig, 2)} kg bleiben im Gebinde`));
      }
    }

    function herkunft() {
      herkunftBox.innerHTML = '';
      const h = models.chargenHerkunft(a, store.listGebinde(), store.listErnten());
      if (!h.gebinde) { herkunftBox.appendChild(leer('Zuerst ein Gebinde wählen.')); return; }
      if (!h.posten.length) { herkunftBox.appendChild(leer('In dieses Gebinde wurde noch nichts eingefüllt.')); return; }
      const ul = el('ul', { class: 'liste' });
      for (const p of h.posten) {
        const anteil = models.ernteAnteil(h.gebinde, p.befuellung.ernteId);
        ul.appendChild(el('li', {}, p.ernte
          ? `${formatDatum(p.ernte.datum)} · ${p.ernte.tracht || 'ohne Tracht'} · ${formatZahl(p.befuellung.mengeKg, 1)} kg (${anteil} %) · ${volkListe(p.ernte.volkIds)}`
          : '(Ernte nicht mehr vorhanden)'));
      }
      herkunftBox.appendChild(ul);
      if (h.trachten.length > 1) {
        herkunftBox.appendChild(el('div', { class: 'ampel ampel-bald' },
          `Verschnitt aus ${h.trachten.length} Trachten — als Sortenangabe kommt nur „Blütenhonig gemischt" o. Ä. in Frage.`));
      }
    }

    const gebindeListe = store.listGebinde().slice()
      .sort((x, y) => String(x.nummer || '').localeCompare(String(y.nummer || ''), 'de', { numeric: true }));

    // Muss vor dem Formularaufbau stehen: das Datumsfeld greift beim Anlegen
    // schon darauf zu, und `let` hinter der Verwendung wäre ein TDZ-Fehler.
    let mhdFeld = null;

    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        feld('Losnummer', input({ value: a.losnummer || '', oninput: ev => a.losnummer = ev.target.value })),
        feld('Abgefüllt am', input({
          type: 'date', value: a.datum || '',
          oninput: ev => {
            a.datum = ev.target.value;
            // MHD zieht mit, solange es dem Vorschlag entspricht — ein selbst
            // gesetztes Datum bleibt unangetastet.
            if (!a.mhd || a.mhd === models.mhdVorschlag(original ? original.datum : '')) a.mhd = models.mhdVorschlag(a.datum);
            if (mhdFeld) mhdFeld.value = a.mhd;
          },
        })),
        feld('Mindestens haltbar bis', (function () {
          const i = input({ type: 'date', value: a.mhd || '', oninput: ev => a.mhd = ev.target.value });
          mhdFeld = i;
          return i;
        })()),
        feld('Sorte (fürs Etikett)', select(models.TRACHTEN, a.sorte, v => a.sorte = v), { breit: true }),
        feld('Glasgröße', select(models.GLASGROESSEN.map(g => ({ wert: g, label: `${g} g` })), a.glasGroesseG,
          v => { a.glasGroesseG = Number(v) || null; bilanz(); }, { leerLabel: false })),
        feld('Anzahl Gläser', input({
          type: 'number', min: 0, value: a.anzahlGlaeser ?? '',
          oninput: ev => { a.anzahlGlaeser = ev.target.value === '' ? null : Number(ev.target.value); bilanz(); },
        })),
      ]),
      el('h3', { class: 'abschnitt' }, 'Aus welchem Gebinde?'),
      select(gebindeListe.map(g => ({
        wert: g.id,
        label: `${gebindeName(g)} — ${formatZahl(models.gebindeRest(g, store.listAbfuellungen().filter(x => x.id !== a.id)), 1)} kg verfügbar`,
      })), a.gebindeId, v => { a.gebindeId = v; bilanz(); herkunft(); }),
      bilanzBox,
      el('h3', { class: 'abschnitt' }, 'Herkunft dieser Charge'),
      herkunftBox,
      el('h3', { class: 'abschnitt' }, 'Notiz'),
      textarea({ value: a.notiz || '', oninput: ev => a.notiz = ev.target.value }),
    ]);
    bilanz(); herkunft();

    const m = modal(istNeu ? 'Neue Abfüllcharge' : 'Charge ' + (a.losnummer || ''), body, {
      fuss: [
        !istNeu ? el('button', {
          class: 'btn btn-danger', onclick: () => {
            if (!confirmDialog('Diese Abfüllcharge löschen?')) return;
            store.deleteAbfuellung(a.id);
            m.close(); refresh();
          },
        }, 'Löschen') : null,
        !istNeu ? el('button', { class: 'btn', onclick: () => IM.export.chargenblattPdf(a) }, '📄 Chargenblatt') : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!a.losnummer.trim()) { toast('Bitte eine Losnummer vergeben.'); return; }
            if (!a.gebindeId) { toast('Bitte das Gebinde wählen — sonst fehlt die Herkunft.'); return; }
            if (!a.anzahlGlaeser) { toast('Bitte die Anzahl Gläser angeben.'); return; }
            const doppelt = store.listAbfuellungen()
              .some(x => x.id !== a.id && String(x.losnummer).trim() === a.losnummer.trim());
            if (doppelt && !confirmDialog(`Die Losnummer „${a.losnummer}" gibt es bereits. Trotzdem speichern?`)) return;
            store.saveAbfuellung(a);
            m.close(); refresh();
            toast('Charge gespeichert');
          },
        }, 'Speichern'),
      ],
    });
  }

  function neuRendern(mount) {
    mount.innerHTML = '';
    renderSeite(mount);
  }

  IM.views.renderHonig = renderHonig;
})();

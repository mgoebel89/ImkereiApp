(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.views = IM.views || {};
  const { el, karte, feld, input, textarea, select, chipGruppe, modal, toast, confirmDialog, leer,
          formatDatum, fotoPickButtons, resizeImageFile } = IM.ui;
  const { store, models } = IM;

  // Filterzustand überlebt das Neu-Rendern (jede Eingabe rendert die Liste neu).
  let filter = { standId: '', suche: '', nurAktive: true };

  function renderVoelker(mount, params) {
    params = params || {};
    if (params.id) return renderDetail(mount, params.id);
    if (params.stand !== undefined) filter.standId = params.stand;
    return renderListe(mount);
  }

  // ===========================================================================
  // Liste
  // ===========================================================================
  function renderListe(mount) {
    const staende = store.listStaende();
    let voelker = store.listVoelker();

    const toolbar = el('div', { class: 'toolbar' }, [
      el('h1', {}, 'Völker'),
      el('button', { class: 'btn btn-primary', onclick: () => neuesVolk(mount) }, '＋ Neues Volk'),
    ]);
    mount.appendChild(toolbar);

    const filterbar = el('div', { class: 'filterbar' }, [
      select(staende.map(s => ({ wert: s.id, label: s.name || 'Ohne Namen' })), filter.standId,
        v => { filter.standId = v; neuRendern(mount); }, { leerLabel: 'Alle Stände' }),
      input({
        type: 'search', placeholder: 'Suchen (Nummer, Name)…', value: filter.suche,
        oninput: e => { filter.suche = e.target.value; neuRendern(mount, true); },
      }),
      el('label', { class: 'inline-chk' }, [
        el('input', {
          type: 'checkbox', class: 'chk', checked: filter.nurAktive,
          onchange: e => { filter.nurAktive = e.target.checked; neuRendern(mount); },
        }),
        el('span', {}, 'nur aktive'),
      ]),
    ]);
    mount.appendChild(filterbar);

    if (filter.nurAktive) voelker = voelker.filter(v => v.status === 'aktiv');
    if (filter.standId) voelker = voelker.filter(v => models.aktuellerStandId(v) === filter.standId);
    if (filter.suche.trim()) {
      const q = filter.suche.trim().toLowerCase();
      voelker = voelker.filter(v => (`${v.nummer} ${v.name}`).toLowerCase().includes(q));
    }

    // Sortierung: Nummern numerisch, wo möglich — sonst landet #10 vor #2.
    voelker.sort((a, b) => {
      const na = parseInt(a.nummer, 10), nb = parseInt(b.nummer, 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return String(a.nummer || a.name || '').localeCompare(String(b.nummer || b.name || ''), 'de');
    });

    if (!voelker.length) {
      mount.appendChild(karte(null, leer(store.listVoelker().length
        ? 'Kein Volk passt zu diesem Filter.'
        : 'Noch kein Volk angelegt.')));
      return;
    }

    const grid = el('div', { class: 'kachel-grid' });
    for (const v of voelker) grid.appendChild(volkKachel(mount, v));
    mount.appendChild(grid);
  }

  function volkKachel(mount, v) {
    const faellig = models.durchsichtFaellig(v);
    const farbe = models.koeniginFarbe(v.koenigin && v.koenigin.jahr);
    const stand = store.getStand(models.aktuellerStandId(v));
    const wartezeit = models.offeneWartezeit(store.listBehandlungen(), v.id);

    return el('div', {
      class: 'kachel kachel-volk' + (v.status !== 'aktiv' ? ' kachel-inaktiv' : ''),
      onclick: () => { location.hash = `#/voelker?id=${encodeURIComponent(v.id)}`; },
    }, [
      el('div', { class: 'kachel-kopf' }, [
        // Der Farbpunkt ist der Königinnen-Jahrescode — im Feld die schnellste
        // Antwort auf „wie alt ist die Königin?".
        farbe ? el('span', {
          class: 'koenigin-punkt',
          style: `background:${farbe.hex}`,
          title: `Königin ${v.koenigin.jahr} (${farbe.name})`,
        }) : null,
        el('h3', {}, models.volkBezeichnung(v)),
        v.status !== 'aktiv' ? el('span', { class: 'tag' }, models.VOLK_STATUS_LABEL[v.status]) : null,
      ]),
      stand ? el('p', { class: 'muted' }, stand.name) : null,
      faellig ? el('div', { class: 'ampel ampel-' + faellig.stufe }, faellig.text) : null,
      wartezeit ? el('div', { class: 'ampel ampel-warnung' }, `Wartezeit bis ${formatDatum(wartezeit)}`) : null,
    ]);
  }

  function neuesVolk(mount) {
    const v = models.emptyVolk();
    // Nächste freie Nummer vorschlagen — spart bei 50 Völkern echtes Nachdenken.
    const nummern = store.listVoelker().map(x => parseInt(x.nummer, 10)).filter(n => !isNaN(n));
    v.nummer = String(nummern.length ? Math.max(...nummern) + 1 : 1);
    if (filter.standId) v.standId = filter.standId;
    const s = store.getSettings().imkerei || {};
    v.beutentyp = s.standardBeutentyp || '';
    v.rahmenmass = s.standardRahmenmass || '';
    stammdatenBearbeiten(mount, v, true);
  }

  // ===========================================================================
  // Detail: die Stockkarte
  // ===========================================================================
  function renderDetail(mount, id) {
    const v = store.getVolk(id);
    if (!v) {
      mount.appendChild(karte('Volk nicht gefunden', el('a', { href: '#/voelker' }, '‹ Zurück zur Liste')));
      return;
    }
    const refresh = () => { mount.innerHTML = ''; renderDetail(mount, id); };

    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('a', { class: 'btn btn-sm', href: '#/voelker' }, '‹ Völker'),
      el('h1', {}, models.volkBezeichnung(v)),
      el('button', {
        class: 'btn', onclick: () => IM.export.stockkartePdf(v),
      }, '📄 Stockkarte als PDF'),
    ]));

    mount.appendChild(stammdatenKarte(mount, v, refresh));
    mount.appendChild(koeniginKarte(v, refresh));
    mount.appendChild(durchsichtenKarte(v, refresh));
    mount.appendChild(massnahmenKarte(v));
    mount.appendChild(wanderungKarte(v, refresh));
  }

  function stammdatenKarte(mount, v, refresh) {
    const stand = store.getStand(models.aktuellerStandId(v));
    const zeilen = el('dl', { class: 'daten' }, [
      dz('Stand', stand ? stand.name : '—'),
      dz('Status', models.VOLK_STATUS_LABEL[v.status] || v.status),
      dz('Herkunft', v.herkunft || '—'),
      dz('Beute', [v.beutentyp, v.rahmenmass].filter(Boolean).join(' · ') || '—'),
      dz('Angelegt', formatDatum(v.erstelltAm) || '—'),
    ]);
    return karte('Stammdaten', zeilen, {
      aktion: el('button', { class: 'btn btn-sm', onclick: () => stammdatenBearbeiten(mount, v, false, refresh) }, 'Bearbeiten'),
    });
  }

  function dz(label, wert) {
    return el('div', { class: 'daten-zeile' }, [
      el('dt', {}, label),
      el('dd', {}, String(wert)),
    ]);
  }

  function stammdatenBearbeiten(mount, original, istNeu, refresh) {
    const v = JSON.parse(JSON.stringify(original));
    const staende = store.listStaende();

    const body = el('div', { class: 'form-grid' }, [
      feld('Nummer', input({ value: v.nummer || '', oninput: e => v.nummer = e.target.value })),
      feld('Name (optional)', input({ value: v.name || '', oninput: e => v.name = e.target.value })),
      feld('Stand', select(staende.map(s => ({ wert: s.id, label: s.name || 'Ohne Namen' })), v.standId,
        val => v.standId = val), { breit: true }),
      feld('Herkunft', select(models.VOLK_HERKUNFT, v.herkunft, val => v.herkunft = val)),
      feld('Status', select(
        models.VOLK_STATUS.map(s => ({ wert: s, label: models.VOLK_STATUS_LABEL[s] })),
        v.status, val => v.status = val, { leerLabel: false })),
      feld('Beutentyp', select(models.BEUTENTYPEN, v.beutentyp, val => v.beutentyp = val)),
      feld('Rähmchenmaß', select(models.RAHMENMASSE, v.rahmenmass, val => v.rahmenmass = val)),
      feld('Notiz zum Status', input({ value: v.statusNotiz || '', oninput: e => v.statusNotiz = e.target.value }), { breit: true }),
    ]);

    const m = modal(istNeu ? 'Neues Volk' : 'Stammdaten bearbeiten', body, {
      fuss: [
        !istNeu ? el('button', {
          class: 'btn btn-danger', onclick: () => {
            if (!confirmDialog(`Volk „${models.volkBezeichnung(v)}" mit allen Durchsichten löschen?\n\nDas lässt sich nur aus NocoDB zurückholen.`)) return;
            store.deleteVolk(v.id);
            m.close();
            location.hash = '#/voelker';
          },
        }, 'Löschen') : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!v.nummer.trim() && !v.name.trim()) { toast('Bitte Nummer oder Name angeben.'); return; }
            store.saveVolk(v);
            m.close();
            if (istNeu) location.hash = `#/voelker?id=${encodeURIComponent(v.id)}`;
            else if (refresh) refresh();
            toast('Gespeichert');
          },
        }, 'Speichern'),
      ],
    });
  }

  // --- Königin --------------------------------------------------------------
  function koeniginKarte(v, refresh) {
    const k = v.koenigin || {};
    const farbe = models.koeniginFarbe(k.jahr);
    const alter = models.koeniginAlter(v);

    const inhalt = el('div', {}, [
      el('div', { class: 'koenigin-kopf' }, [
        farbe ? el('span', { class: 'koenigin-punkt koenigin-punkt-gross', style: `background:${farbe.hex}` }) : null,
        el('div', {}, [
          el('strong', {}, k.jahr ? `Jahrgang ${k.jahr}${farbe ? ' (' + farbe.name + ')' : ''}` : 'Kein Jahrgang erfasst'),
          // Ab dem dritten Jahr lässt die Legeleistung typischerweise nach —
          // deshalb der Hinweis, nicht nur die Zahl.
          alter !== null ? el('div', { class: 'muted' }, `${alter} Jahr(e) alt${alter >= 3 ? ' — Umweiseln erwägen' : ''}`) : null,
        ]),
      ]),
      el('dl', { class: 'daten' }, [
        dz('Herkunft', k.herkunft || '—'),
        dz('Linie/Rasse', k.linie || '—'),
        dz('Gezeichnet', k.gezeichnet ? 'ja' : 'nein'),
        dz('Beschnitten', k.beschnitten ? 'ja' : 'nein'),
        dz('Im Volk seit', formatDatum(k.seitDatum) || '—'),
      ]),
      k.bemerkung ? el('p', {}, k.bemerkung) : null,
      (v.koeniginHistorie || []).length
        ? el('details', { class: 'aufklapp' }, [
            el('summary', {}, `Frühere Königinnen (${v.koeniginHistorie.length})`),
            el('ul', { class: 'liste' }, v.koeniginHistorie.map(alt =>
              el('li', {}, `${alt.jahr || '?'} · ${alt.herkunft || '—'}${alt.abgesetztAm ? ' · abgesetzt ' + formatDatum(alt.abgesetztAm) : ''}`))),
          ])
        : null,
    ]);

    const aktionen = el('div', { class: 'btn-reihe' }, [
      el('button', { class: 'btn btn-sm', onclick: () => koeniginBearbeiten(v, refresh) }, 'Bearbeiten'),
      el('button', { class: 'btn btn-sm', onclick: () => umweiseln(v, refresh) }, 'Umweiseln'),
    ]);

    return karte('Königin', inhalt, { aktion: aktionen });
  }

  function koeniginBearbeiten(v, refresh) {
    const k = JSON.parse(JSON.stringify(v.koenigin || models.emptyKoenigin()));
    const jahrInput = input({
      type: 'number', value: k.jahr ?? '', min: 2000, max: 2100,
      oninput: e => { k.jahr = e.target.value === '' ? null : Number(e.target.value); farbeAnzeigen(); },
    });
    const farbeBox = el('span', { class: 'farb-hinweis' });
    function farbeAnzeigen() {
      const f = models.koeniginFarbe(k.jahr);
      farbeBox.innerHTML = '';
      if (!f) { farbeBox.textContent = ''; return; }
      farbeBox.appendChild(el('span', { class: 'koenigin-punkt', style: `background:${f.hex}` }));
      farbeBox.appendChild(el('span', {}, ' Zeichenfarbe: ' + f.name));
    }
    farbeAnzeigen();

    const body = el('div', { class: 'form-grid' }, [
      feld('Schlupfjahr', el('div', { class: 'jahr-zeile' }, [jahrInput, farbeBox]), { breit: true }),
      feld('Herkunft', select(models.KOENIGIN_HERKUNFT, k.herkunft, val => k.herkunft = val)),
      feld('Linie / Rasse', input({ value: k.linie || '', oninput: e => k.linie = e.target.value })),
      feld('Im Volk seit', input({ type: 'date', value: k.seitDatum || '', oninput: e => k.seitDatum = e.target.value })),
      feld('Gezeichnet', el('input', { type: 'checkbox', class: 'chk', checked: !!k.gezeichnet, onchange: e => k.gezeichnet = e.target.checked })),
      feld('Flügel beschnitten', el('input', { type: 'checkbox', class: 'chk', checked: !!k.beschnitten, onchange: e => k.beschnitten = e.target.checked })),
      feld('Bemerkung', textarea({ value: k.bemerkung || '', oninput: e => k.bemerkung = e.target.value }), { breit: true }),
    ]);

    const m = modal('Königin', body, {
      fuss: [
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            v.koenigin = k;
            store.saveVolk(v);
            m.close(); refresh();
            toast('Königin gespeichert');
          },
        }, 'Speichern'),
      ],
    });
  }

  // Umweiseln legt die alte Königin in der Historie ab, statt sie zu
  // überschreiben — sonst ginge nachträglich verloren, welche Linie wie lief.
  function umweiseln(v, refresh) {
    const neu = models.emptyKoenigin();
    neu.jahr = new Date().getFullYear();
    neu.seitDatum = models.heute();

    const jahrInput = input({
      type: 'number', value: neu.jahr, min: 2000, max: 2100,
      oninput: e => { neu.jahr = e.target.value === '' ? null : Number(e.target.value); farbeAnzeigen(); },
    });
    const farbeBox = el('span', { class: 'farb-hinweis' });
    function farbeAnzeigen() {
      const f = models.koeniginFarbe(neu.jahr);
      farbeBox.innerHTML = '';
      if (!f) return;
      farbeBox.appendChild(el('span', { class: 'koenigin-punkt', style: `background:${f.hex}` }));
      farbeBox.appendChild(el('span', {}, ' ' + f.name));
    }
    farbeAnzeigen();

    const body = el('div', {}, [
      el('p', { class: 'muted' }, 'Die bisherige Königin wandert in die Historie des Volkes.'),
      el('div', { class: 'form-grid' }, [
        feld('Schlupfjahr der neuen Königin', el('div', { class: 'jahr-zeile' }, [jahrInput, farbeBox]), { breit: true }),
        feld('Herkunft', select(models.KOENIGIN_HERKUNFT, neu.herkunft, val => neu.herkunft = val)),
        feld('Linie / Rasse', input({ value: '', oninput: e => neu.linie = e.target.value })),
        feld('Im Volk seit', input({ type: 'date', value: neu.seitDatum, oninput: e => neu.seitDatum = e.target.value })),
        feld('Gezeichnet', el('input', { type: 'checkbox', class: 'chk', onchange: e => neu.gezeichnet = e.target.checked })),
        feld('Bemerkung', textarea({ oninput: e => neu.bemerkung = e.target.value }), { breit: true }),
      ]),
    ]);

    const m = modal('Umweiseln', body, {
      fuss: [
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            const alt = v.koenigin || {};
            if (alt.jahr || alt.herkunft || alt.linie) {
              v.koeniginHistorie = v.koeniginHistorie || [];
              v.koeniginHistorie.unshift({ ...alt, abgesetztAm: neu.seitDatum || models.heute() });
            }
            v.koenigin = neu;
            store.saveVolk(v);
            m.close(); refresh();
            toast('Umgeweiselt');
          },
        }, 'Übernehmen'),
      ],
    });
  }

  // --- Durchsichten (die eigentliche Stockkarte) ----------------------------
  function durchsichtenKarte(v, refresh) {
    const liste = models.durchsichtenSortiert(v); // jüngste zuerst
    const inhalt = el('div', {});

    if (!liste.length) {
      inhalt.appendChild(leer('Noch keine Durchsicht erfasst.'));
    } else {
      for (const d of liste) inhalt.appendChild(durchsichtZeile(v, d, refresh));
    }

    return karte(`Stockkarte — Durchsichten (${liste.length})`, inhalt, {
      aktion: el('button', {
        class: 'btn btn-sm btn-primary', onclick: () => durchsichtBearbeiten(v, null, refresh),
      }, '＋ Durchsicht'),
    });
  }

  function durchsichtZeile(v, d, refresh) {
    const fotos = store.listVolkFotos(v.id).filter(f => f.kind === 'ds_' + d.id);

    const kopf = el('div', { class: 'ds-kopf' }, [
      el('strong', {}, formatDatum(d.datum)),
      d.volksstaerke ? el('span', { class: 'badge' }, `Stärke ${d.volksstaerke}/5`) : null,
      d.weiselzellen && d.weiselzellen !== 'keine' ? el('span', { class: 'badge badge-warn' }, d.weiselzellen) : null,
      d.futter === 'Notfütterung nötig' ? el('span', { class: 'badge badge-warn' }, 'Futter knapp') : null,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-sm', onclick: () => durchsichtBearbeiten(v, d, refresh) }, 'Bearbeiten'),
    ]);

    const werte = [];
    const push = (label, wert) => { if (wert !== null && wert !== undefined && wert !== '' ) werte.push(`${label}: ${wert}`); };
    push('Brutbild', d.brutbild);
    push('Stifte', d.stifteGesehen ? 'ja' : null);
    push('Königin gesehen', d.koeniginGesehen ? 'ja' : null);
    push('Sanftmut', d.sanftmut ? d.sanftmut + '/5' : null);
    push('Wabensitz', d.wabensitz ? d.wabensitz + '/5' : null);
    push('Wabengassen', d.besetzteWabengassen);
    push('Zargen', d.zargen);
    push('Waben (ges./Brut/Futter)', [d.wabenGesamt, d.wabenBrut, d.wabenFutter].some(x => x != null)
      ? `${d.wabenGesamt ?? '–'}/${d.wabenBrut ?? '–'}/${d.wabenFutter ?? '–'}` : null);
    push('Futter', d.futter);
    push('Stimmung', d.stimmung);
    push('Wetter', d.wetter);

    const body = el('div', { class: 'ds-body' }, [
      werte.length ? el('p', { class: 'ds-werte' }, werte.join(' · ')) : null,
      (d.arbeiten || []).length ? el('div', { class: 'chips chips-statisch' },
        d.arbeiten.map(a => el('span', { class: 'chip chip-aktiv' }, a))) : null,
      d.notiz ? el('p', { class: 'ds-notiz' }, d.notiz) : null,
      fotos.length ? el('div', { class: 'foto-reihe' }, fotos.map(f =>
        el('img', { class: 'foto-thumb', src: store.volkFotoUrl(f.id), alt: 'Foto', loading: 'lazy' }))) : null,
    ]);

    return el('div', { class: 'ds-eintrag' }, [kopf, body]);
  }

  function durchsichtBearbeiten(v, original, refresh) {
    const istNeu = !original;
    const d = original ? JSON.parse(JSON.stringify(original)) : models.emptyDurchsicht();

    // Beim Anlegen die Zargen-/Wabenzahlen der letzten Durchsicht vorbelegen —
    // die ändern sich selten, und Tippen mit Handschuhen ist mühsam.
    if (istNeu) {
      const letzte = models.letzteDurchsicht(v);
      if (letzte) {
        d.zargen = letzte.zargen;
        d.wabenGesamt = letzte.wabenGesamt;
      }
    }

    const num = (key, attrs = {}) => input({
      type: 'number', value: d[key] ?? '', ...attrs,
      oninput: e => d[key] = e.target.value === '' ? null : Number(e.target.value),
    });

    const arbeitenBox = el('div', {});
    function arbeitenRendern() {
      arbeitenBox.innerHTML = '';
      arbeitenBox.appendChild(chipGruppe(models.ARBEITEN, d.arbeiten, (a, an) => {
        d.arbeiten = an ? [...d.arbeiten, a] : d.arbeiten.filter(x => x !== a);
        arbeitenRendern();
      }));
    }
    arbeitenRendern();

    // Fotos: erst nach dem Speichern hochladbar, weil der Upload an der
    // Durchsichts-ID hängt und ein Abbruch sonst Dateileichen hinterließe.
    const fotoBox = el('div', {});
    function fotosRendern() {
      fotoBox.innerHTML = '';
      if (istNeu) {
        fotoBox.appendChild(leer('Fotos lassen sich nach dem ersten Speichern hinzufügen.'));
        return;
      }
      const fotos = store.listVolkFotos(v.id).filter(f => f.kind === 'ds_' + d.id);
      if (fotos.length) {
        fotoBox.appendChild(el('div', { class: 'foto-reihe' }, fotos.map(f =>
          el('div', { class: 'foto-kachel' }, [
            el('img', { class: 'foto-thumb', src: store.volkFotoUrl(f.id), alt: 'Foto' }),
            el('button', {
              class: 'foto-weg', type: 'button', title: 'Foto entfernen',
              onclick: async () => { await store.deleteVolkFoto(v.id, f.id); fotosRendern(); },
            }, '✕'),
          ]))));
      }
      fotoBox.appendChild(fotoPickButtons(async (file) => {
        try {
          const klein = await resizeImageFile(file);
          await store.uploadVolkFoto(v.id, klein, 'ds_' + d.id);
          fotosRendern();
          toast('Foto gespeichert');
        } catch (e) {
          toast('Foto-Upload fehlgeschlagen: ' + e.message, 4000);
        }
      }));
    }
    fotosRendern();

    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        feld('Datum', input({ type: 'date', value: d.datum || '', oninput: e => d.datum = e.target.value })),
        feld('Wetter', input({ value: d.wetter || '', placeholder: 'z. B. 18 °C, sonnig', oninput: e => d.wetter = e.target.value })),
        feld('Volksstärke', select(models.SKALA.map(s => ({ wert: s.wert, label: s.label })), d.volksstaerke, val => d.volksstaerke = val ? Number(val) : null)),
        feld('Besetzte Wabengassen', num('besetzteWabengassen', { min: 0, max: 30 })),
        feld('Brutbild', select(models.BRUTBILD, d.brutbild, val => d.brutbild = val)),
        feld('Weiselzellen', select(models.WEISELZELLEN, d.weiselzellen, val => d.weiselzellen = val)),
        feld('Stifte gesehen', el('input', { type: 'checkbox', class: 'chk', checked: !!d.stifteGesehen, onchange: e => d.stifteGesehen = e.target.checked })),
        feld('Königin gesehen', el('input', { type: 'checkbox', class: 'chk', checked: !!d.koeniginGesehen, onchange: e => d.koeniginGesehen = e.target.checked })),
        feld('Sanftmut', select(models.SKALA_SANFTMUT.map(s => ({ wert: s.wert, label: s.label })), d.sanftmut, val => d.sanftmut = val ? Number(val) : null)),
        feld('Wabensitz', select(models.SKALA.map(s => ({ wert: s.wert, label: s.label })), d.wabensitz, val => d.wabensitz = val ? Number(val) : null)),
        feld('Zargen', num('zargen', { min: 0, max: 6 })),
        feld('Waben gesamt', num('wabenGesamt', { min: 0, max: 60 })),
        feld('davon Brutwaben', num('wabenBrut', { min: 0, max: 60 })),
        feld('davon Futterwaben', num('wabenFutter', { min: 0, max: 60 })),
        feld('Futtereinschätzung', select(models.FUTTER, d.futter, val => d.futter = val)),
        feld('Stimmung', select(models.STIMMUNG, d.stimmung, val => d.stimmung = val)),
      ]),
      el('h3', { class: 'abschnitt' }, 'Durchgeführte Arbeiten'),
      arbeitenBox,
      el('h3', { class: 'abschnitt' }, 'Notiz'),
      textarea({ value: d.notiz || '', rows: 4, oninput: e => d.notiz = e.target.value }),
      el('h3', { class: 'abschnitt' }, 'Fotos'),
      fotoBox,
    ]);

    const m = modal(istNeu ? 'Neue Durchsicht' : 'Durchsicht ' + formatDatum(d.datum), body, {
      fuss: [
        !istNeu ? el('button', {
          class: 'btn btn-danger', onclick: async () => {
            if (!confirmDialog('Diesen Durchsichts-Eintrag löschen?')) return;
            // Zugehörige Fotos mit entfernen, sonst bleiben sie unerreichbar liegen.
            for (const f of store.listVolkFotos(v.id).filter(f => f.kind === 'ds_' + d.id)) {
              try { await store.deleteVolkFoto(v.id, f.id); } catch (_) {}
            }
            v.durchsichten = (v.durchsichten || []).filter(x => x.id !== d.id);
            store.saveVolk(v);
            m.close(); refresh();
          },
        }, 'Löschen') : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!d.datum) { toast('Bitte ein Datum angeben.'); return; }
            v.durchsichten = v.durchsichten || [];
            const idx = v.durchsichten.findIndex(x => x.id === d.id);
            if (idx >= 0) v.durchsichten[idx] = d; else v.durchsichten.push(d);
            store.saveVolk(v);
            m.close(); refresh();
            toast('Durchsicht gespeichert');
          },
        }, 'Speichern'),
      ],
    });

    // Beim Anlegen einmal speichern, damit Fotos sofort möglich sind? Bewusst
    // nicht — ein versehentlich geöffnetes Formular soll keinen Eintrag erzeugen.
  }

  // --- Maßnahmen (Behandlungen/Fütterungen dieses Volkes) -------------------
  function massnahmenKarte(v) {
    const beh = models.massnahmenFuerVolk(store.listBehandlungen(), v.id);
    const fut = models.massnahmenFuerVolk(store.listFuetterungen(), v.id);
    const wartezeit = models.offeneWartezeit(store.listBehandlungen(), v.id);

    const inhalt = el('div', {}, [
      wartezeit ? el('div', { class: 'ampel ampel-warnung' },
        `Wartezeit läuft noch bis ${formatDatum(wartezeit)} — bis dahin nicht ernten.`) : null,
      el('h3', { class: 'abschnitt' }, `Behandlungen & Diagnosen (${beh.length})`),
      beh.length ? el('ul', { class: 'liste' }, beh.map(b => {
        const proTag = models.milbenProTag(b);
        const txt = b.art === 'diagnose'
          ? `${formatDatum(b.datum)} · Diagnose ${b.methode || ''}${proTag !== null ? ` · ${proTag} Milben/Tag` : ''}`
          : `${formatDatum(b.datum)} · ${b.praeparat || 'Behandlung'}${b.menge ? ` · ${b.menge} ${b.einheit}` : ''}`;
        return el('li', {}, [
          el('a', { href: `#/behandlungen?id=${encodeURIComponent(b.id)}` }, txt),
        ]);
      })) : leer('Noch nichts erfasst.'),
      el('h3', { class: 'abschnitt' }, `Fütterungen (${fut.length})`),
      fut.length ? el('ul', { class: 'liste' }, fut.map(f =>
        el('li', {}, `${formatDatum(f.datum)} · ${f.futterart || 'Futter'} · ${f.mengeProVolk ?? '?'} ${f.einheit}`))) : leer('Noch nichts erfasst.'),
    ]);

    return karte('Behandlungen & Fütterungen', inhalt, {
      aktion: el('a', { class: 'btn btn-sm', href: '#/behandlungen' }, 'Zum Modul'),
    });
  }

  // --- Wanderungen ----------------------------------------------------------
  function wanderungKarte(v, refresh) {
    const hist = (v.standHistorie || []).slice().sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));
    const inhalt = hist.length
      ? el('ul', { class: 'liste' }, hist.map(h => {
          const s = store.getStand(h.standId);
          return el('li', {}, [
            el('span', {}, `${formatDatum(h.datum)} → ${s ? s.name : 'unbekannter Stand'}${h.notiz ? ' · ' + h.notiz : ''}`),
            el('button', {
              class: 'link-danger', type: 'button', title: 'Eintrag entfernen',
              onclick: () => {
                v.standHistorie = v.standHistorie.filter(x => x.id !== h.id);
                store.saveVolk(v); refresh();
              },
            }, '✕'),
          ]);
        }))
      : IM.ui.leer('Keine Standortwechsel erfasst — das Volk steht seit Anlage am eingetragenen Stand.');

    return karte('Standortwechsel / Wanderungen', inhalt, {
      aktion: el('button', { class: 'btn btn-sm', onclick: () => umsetzen(v, refresh) }, '＋ Umsetzen'),
    });
  }

  function umsetzen(v, refresh) {
    const eintrag = { id: models.uuid(), datum: models.heute(), standId: '', notiz: '' };
    const staende = store.listStaende().filter(s => s.id !== models.aktuellerStandId(v));

    const body = el('div', { class: 'form-grid' }, [
      feld('Datum', input({ type: 'date', value: eintrag.datum, oninput: e => eintrag.datum = e.target.value })),
      feld('Neuer Stand', select(staende.map(s => ({ wert: s.id, label: s.name || 'Ohne Namen' })), '', val => eintrag.standId = val), { breit: true }),
      feld('Notiz', input({ oninput: e => eintrag.notiz = e.target.value }), { breit: true }),
    ]);

    const m = modal('Volk umsetzen', body, {
      fuss: [
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!eintrag.standId) { toast('Bitte einen Zielstand wählen.'); return; }
            v.standHistorie = v.standHistorie || [];
            v.standHistorie.push(eintrag);
            // standId mitziehen, damit auch Auswertungen ohne Historie stimmen.
            v.standId = eintrag.standId;
            store.saveVolk(v);
            m.close(); refresh();
            toast('Umgesetzt');
          },
        }, 'Übernehmen'),
      ],
    });
  }

  function neuRendern(mount, fokusSuche) {
    mount.innerHTML = '';
    renderListe(mount);
    if (fokusSuche) {
      const s = mount.querySelector('input[type="search"]');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
  }

  IM.views.renderVoelker = renderVoelker;
})();

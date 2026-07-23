(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.views = IM.views || {};
  const { el, karte, feld, input, textarea, select, modal, toast, confirmDialog, leer, formatDatum } = IM.ui;
  const { store, models } = IM;

  let reiter = 'behandlungen'; // 'behandlungen' | 'fuetterungen'
  let jahrFilter = '';

  function renderBehandlungen(mount, params) {
    params = params || {};
    if (params.id) {
      const b = store.getBehandlung(params.id);
      if (b) { renderListe(mount); behandlungBearbeiten(b, () => neuRendern(mount)); return; }
    }
    renderListe(mount);
  }

  function renderListe(mount) {
    mount.appendChild(el('div', { class: 'toolbar' }, [
      el('h1', {}, 'Behandlungen & Fütterungen'),
      el('button', {
        class: 'btn', onclick: () => IM.export.bestandsbuchPdf(jahrFilter || new Date().getFullYear()),
      }, '📄 Bestandsbuch'),
    ]));

    // Zwei Reiter statt zweier Menüpunkte: fachlich gehört beides zur
    // Volksführung und man springt beim Auffüttern häufig hin und her.
    mount.appendChild(el('div', { class: 'reiter' }, [
      el('button', {
        class: 'reiter-btn' + (reiter === 'behandlungen' ? ' aktiv' : ''),
        onclick: () => { reiter = 'behandlungen'; neuRendern(mount); },
      }, 'Behandlungen & Diagnosen'),
      el('button', {
        class: 'reiter-btn' + (reiter === 'fuetterungen' ? ' aktiv' : ''),
        onclick: () => { reiter = 'fuetterungen'; neuRendern(mount); },
      }, 'Fütterungen'),
    ]));

    const alle = reiter === 'behandlungen' ? store.listBehandlungen() : store.listFuetterungen();
    const jahre = [...new Set(alle.map(x => String(x.datum || '').slice(0, 4)).filter(Boolean))].sort().reverse();

    mount.appendChild(el('div', { class: 'filterbar' }, [
      select(jahre, jahrFilter, v => { jahrFilter = v; neuRendern(mount); }, { leerLabel: 'Alle Jahre' }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary',
        onclick: () => reiter === 'behandlungen'
          ? behandlungBearbeiten(null, () => neuRendern(mount))
          : fuetterungBearbeiten(null, () => neuRendern(mount)),
      }, reiter === 'behandlungen' ? '＋ Behandlung / Diagnose' : '＋ Fütterung'),
    ]));

    let liste = alle.slice();
    if (jahrFilter) liste = liste.filter(x => String(x.datum || '').startsWith(jahrFilter));
    liste.sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));

    if (!liste.length) {
      mount.appendChild(karte(null, leer('Noch nichts erfasst.')));
      return;
    }

    const box = el('div', {});
    for (const x of liste) {
      box.appendChild(reiter === 'behandlungen'
        ? behandlungZeile(mount, x)
        : fuetterungZeile(mount, x));
    }
    mount.appendChild(karte(null, box));
  }

  function volkListe(ids) {
    const namen = (ids || []).map(id => {
      const v = store.getVolk(id);
      return v ? models.volkBezeichnung(v) : '?';
    });
    if (!namen.length) return 'keine Völker zugeordnet';
    if (namen.length <= 4) return namen.join(', ');
    return `${namen.slice(0, 4).join(', ')} + ${namen.length - 4} weitere`;
  }

  function behandlungZeile(mount, b) {
    const proTag = models.milbenProTag(b);
    const monat = parseInt(String(b.datum || '').slice(5, 7), 10);
    const bew = models.milbenBewertung(proTag, monat);
    const stand = store.getStand(b.standId);

    return el('div', {
      class: 'eintrag', onclick: () => behandlungBearbeiten(b, () => neuRendern(mount)),
    }, [
      el('div', { class: 'eintrag-kopf' }, [
        el('strong', {}, formatDatum(b.datum)),
        el('span', { class: 'badge' }, b.art === 'diagnose' ? 'Diagnose' : 'Behandlung'),
        b.art === 'behandlung' && b.praeparat ? el('span', {}, b.praeparat) : null,
        b.art === 'diagnose' && proTag !== null
          ? el('span', { class: 'badge badge-' + (bew ? bew.stufe : 'ok') }, `${proTag} Milben/Tag`)
          : null,
      ]),
      el('div', { class: 'muted' }, [
        stand ? stand.name + ' · ' : '',
        `${(b.volkIds || []).length} Volk/Völker: ${volkListe(b.volkIds)}`,
      ].join('')),
      b.art === 'behandlung' && b.wartezeitTage
        ? el('div', { class: 'muted' }, `Wartezeit ${b.wartezeitTage} Tage — bis ${formatDatum(models.wartezeitBis(b))}`)
        : null,
    ]);
  }

  function fuetterungZeile(mount, f) {
    const stand = store.getStand(f.standId);
    return el('div', {
      class: 'eintrag', onclick: () => fuetterungBearbeiten(f, () => neuRendern(mount)),
    }, [
      el('div', { class: 'eintrag-kopf' }, [
        el('strong', {}, formatDatum(f.datum)),
        el('span', {}, f.futterart || 'Futter'),
        el('span', { class: 'badge' }, `${models.fuetterungGesamt(f)} ${f.einheit} gesamt`),
      ]),
      el('div', { class: 'muted' }, [
        stand ? stand.name + ' · ' : '',
        `${f.mengeProVolk ?? '?'} ${f.einheit} je Volk · ${volkListe(f.volkIds)}`,
      ].join('')),
    ]);
  }

  // --- Volk-Auswahl ---------------------------------------------------------
  // Eine Behandlung trifft fast immer den ganzen Stand. Deshalb: Stand wählen,
  // „alle" antippen, einzelne abwählen — nicht 20-mal einzeln ankreuzen.
  //
  // Arbeitet auf `obj.standId` und `obj.volkIds` und wird auch vom Honig-Modul
  // benutzt (eine Ernte betrifft ebenso mehrere Völker) — deshalb unten als
  // IM.views.volkAuswahl geteilt.
  function volkAuswahl(obj, onChange) {
    const wrap = el('div', {});
    function render() {
      wrap.innerHTML = '';
      const staende = store.listStaende();
      wrap.appendChild(feld('Stand', select(
        staende.map(s => ({ wert: s.id, label: s.name || 'Ohne Namen' })), obj.standId,
        v => { obj.standId = v; obj.volkIds = []; render(); onChange && onChange(); },
      ), { breit: true }));

      if (!obj.standId) {
        wrap.appendChild(leer('Zuerst einen Stand wählen — dann erscheinen dessen Völker.'));
        return;
      }
      const voelker = models.voelkerAmStand(store.listVoelker(), obj.standId, true)
        .sort((a, b) => (parseInt(a.nummer, 10) || 0) - (parseInt(b.nummer, 10) || 0));
      if (!voelker.length) {
        wrap.appendChild(leer('An diesem Stand steht kein aktives Volk.'));
        return;
      }

      const alleGewaehlt = voelker.every(v => obj.volkIds.includes(v.id));
      wrap.appendChild(el('div', { class: 'btn-reihe' }, [
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: () => {
            obj.volkIds = alleGewaehlt ? [] : voelker.map(v => v.id);
            render(); onChange && onChange();
          },
        }, alleGewaehlt ? 'Auswahl aufheben' : `Alle ${voelker.length} auswählen`),
        el('span', { class: 'muted' }, `${obj.volkIds.length} gewählt`),
      ]));

      const grid = el('div', { class: 'volk-auswahl' });
      for (const v of voelker) {
        const an = obj.volkIds.includes(v.id);
        grid.appendChild(el('button', {
          class: 'volk-chip' + (an ? ' aktiv' : ''), type: 'button',
          onclick: () => {
            obj.volkIds = an ? obj.volkIds.filter(x => x !== v.id) : [...obj.volkIds, v.id];
            render(); onChange && onChange();
          },
        }, models.volkBezeichnung(v)));
      }
      wrap.appendChild(grid);
    }
    render();
    return wrap;
  }

  // --- Behandlung bearbeiten ------------------------------------------------
  function behandlungBearbeiten(original, refresh) {
    const istNeu = !original;
    const b = original ? JSON.parse(JSON.stringify(original)) : models.emptyBehandlung();
    if (istNeu && !b.anwender) b.anwender = (store.getSettings().imkerei || {}).imker || '';

    const felderBox = el('div', {});

    function render() {
      felderBox.innerHTML = '';

      felderBox.appendChild(el('div', { class: 'form-grid' }, [
        feld('Datum', input({ type: 'date', value: b.datum || '', oninput: e => b.datum = e.target.value })),
        feld('Art', select(
          [{ wert: 'behandlung', label: 'Arzneimittel-Anwendung' }, { wert: 'diagnose', label: 'Varroa-Diagnose' }],
          b.art, v => { b.art = v; render(); }, { leerLabel: false })),
      ]));

      felderBox.appendChild(el('h3', { class: 'abschnitt' }, 'Betroffene Völker'));
      felderBox.appendChild(volkAuswahl(b));

      if (b.art === 'diagnose') {
        const proTagBox = el('div', { class: 'kennzahl' });
        function kennzahl() {
          const p = models.milbenProTag(b);
          const monat = parseInt(String(b.datum || '').slice(5, 7), 10);
          const bew = models.milbenBewertung(p, monat);
          proTagBox.innerHTML = '';
          if (p === null) {
            proTagBox.appendChild(el('span', { class: 'muted' }, 'Milbenzahl und Tage angeben, dann wird der Fall je Tag berechnet.'));
            return;
          }
          proTagBox.appendChild(el('strong', {}, `${p} Milben/Tag`));
          if (bew) proTagBox.appendChild(el('span', { class: 'badge badge-' + bew.stufe }, bew.text));
        }
        felderBox.appendChild(el('h3', { class: 'abschnitt' }, 'Diagnose'));
        felderBox.appendChild(el('div', { class: 'form-grid' }, [
          feld('Methode', select(models.DIAGNOSE_METHODEN, b.methode, v => b.methode = v), { breit: true }),
          feld('Gefundene Milben (gesamt)', input({
            type: 'number', min: 0, value: b.milbenGesamt ?? '',
            oninput: e => { b.milbenGesamt = e.target.value === '' ? null : Number(e.target.value); kennzahl(); },
          })),
          feld('Zähltage', input({
            type: 'number', min: 1, value: b.tage ?? '',
            oninput: e => { b.tage = e.target.value === '' ? null : Number(e.target.value); kennzahl(); },
          })),
        ]));
        felderBox.appendChild(proTagBox);
        kennzahl();
      } else {
        felderBox.appendChild(el('h3', { class: 'abschnitt' }, 'Arzneimittel'));
        felderBox.appendChild(el('p', { class: 'muted' },
          'Diese Angaben bilden das gesetzlich vorgeschriebene Bestandsbuch. Charge und Wartezeit gehören zwingend dazu.'));
        felderBox.appendChild(el('div', { class: 'form-grid' }, [
          feld('Präparat', select(models.PRAEPARATE.map(p => p.name), b.praeparat, v => {
            b.praeparat = v;
            // Wirkstoff und Wartezeit aus der Präparateliste vorbelegen — das
            // sind genau die Felder, die man sonst falsch aus dem Kopf einträgt.
            const p = models.PRAEPARATE.find(x => x.name === v);
            if (p) { b.wirkstoff = p.wirkstoff; b.wartezeitTage = p.wartezeit; }
            render();
          }), { breit: true }),
          feld('Wirkstoff', input({ value: b.wirkstoff || '', oninput: e => b.wirkstoff = e.target.value })),
          feld('Chargennummer', input({ value: b.chargennummer || '', oninput: e => b.chargennummer = e.target.value })),
          feld('Menge je Volk', input({
            type: 'number', step: 'any', min: 0, value: b.menge ?? '',
            oninput: e => b.menge = e.target.value === '' ? null : Number(e.target.value),
          })),
          feld('Einheit', select(['ml', 'g', 'Streifen', 'Stück'], b.einheit, v => b.einheit = v, { leerLabel: false })),
          feld('Anwendungsart', select(models.ANWENDUNGSARTEN, b.anwendungsart, v => b.anwendungsart = v)),
          feld('Wartezeit (Tage)', input({
            type: 'number', min: 0, value: b.wartezeitTage ?? 0,
            oninput: e => b.wartezeitTage = Number(e.target.value) || 0,
          })),
          feld('Anwender', input({ value: b.anwender || '', oninput: e => b.anwender = e.target.value })),
          feld('Indikation', input({ value: b.indikation || '', oninput: e => b.indikation = e.target.value })),
        ]));
      }

      felderBox.appendChild(el('h3', { class: 'abschnitt' }, 'Bemerkung'));
      felderBox.appendChild(textarea({ value: b.bemerkung || '', oninput: e => b.bemerkung = e.target.value }));
    }
    render();

    const m = modal(istNeu ? 'Neue Behandlung / Diagnose' : 'Eintrag bearbeiten', felderBox, {
      fuss: [
        !istNeu ? el('button', {
          class: 'btn btn-danger', onclick: () => {
            if (!confirmDialog('Eintrag löschen?')) return;
            store.deleteBehandlung(b.id);
            m.close(); refresh();
          },
        }, 'Löschen') : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!b.datum) { toast('Bitte ein Datum angeben.'); return; }
            if (!b.volkIds.length) { toast('Bitte mindestens ein Volk wählen.'); return; }
            if (b.art === 'behandlung' && !b.praeparat) { toast('Bitte das Präparat angeben — ohne geht kein Bestandsbuch.'); return; }
            store.saveBehandlung(b);
            m.close(); refresh();
            toast('Gespeichert');
          },
        }, 'Speichern'),
      ],
    });
  }

  // --- Fütterung bearbeiten -------------------------------------------------
  function fuetterungBearbeiten(original, refresh) {
    const istNeu = !original;
    const f = original ? JSON.parse(JSON.stringify(original)) : models.emptyFuetterung();

    const gesamtBox = el('div', { class: 'kennzahl' });
    function gesamt() {
      gesamtBox.innerHTML = '';
      const g = models.fuetterungGesamt(f);
      gesamtBox.appendChild(el('strong', {}, `Gesamtmenge: ${g} ${f.einheit}`));
      gesamtBox.appendChild(el('span', { class: 'muted' }, ` (${f.volkIds.length} Völker × ${f.mengeProVolk ?? 0})`));
    }

    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        feld('Datum', input({ type: 'date', value: f.datum || '', oninput: e => f.datum = e.target.value })),
        feld('Anlass', select(models.FUETTERUNG_ANLASS, f.anlass, v => f.anlass = v)),
      ]),
      el('h3', { class: 'abschnitt' }, 'Gefütterte Völker'),
      volkAuswahl(f, gesamt),
      el('h3', { class: 'abschnitt' }, 'Futter'),
      el('div', { class: 'form-grid' }, [
        feld('Futterart', select(models.FUTTERARTEN.map(x => x.name), f.futterart, v => {
          f.futterart = v;
          const fa = models.FUTTERARTEN.find(x => x.name === v);
          if (fa) f.einheit = fa.einheit;
          gesamt();
        }), { breit: true }),
        feld('Menge je Volk', input({
          type: 'number', step: 'any', min: 0, value: f.mengeProVolk ?? '',
          oninput: e => { f.mengeProVolk = e.target.value === '' ? null : Number(e.target.value); gesamt(); },
        })),
        feld('Einheit', select(['kg', 'l'], f.einheit, v => { f.einheit = v; gesamt(); }, { leerLabel: false })),
      ]),
      gesamtBox,
      el('h3', { class: 'abschnitt' }, 'Notiz'),
      textarea({ value: f.notiz || '', oninput: e => f.notiz = e.target.value }),
    ]);
    gesamt();

    const m = modal(istNeu ? 'Neue Fütterung' : 'Fütterung bearbeiten', body, {
      fuss: [
        !istNeu ? el('button', {
          class: 'btn btn-danger', onclick: () => {
            if (!confirmDialog('Eintrag löschen?')) return;
            store.deleteFuetterung(f.id);
            m.close(); refresh();
          },
        }, 'Löschen') : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!f.datum) { toast('Bitte ein Datum angeben.'); return; }
            if (!f.volkIds.length) { toast('Bitte mindestens ein Volk wählen.'); return; }
            store.saveFuetterung(f);
            m.close(); refresh();
            toast('Gespeichert');
          },
        }, 'Speichern'),
      ],
    });
  }

  function neuRendern(mount) {
    mount.innerHTML = '';
    renderListe(mount);
  }

  IM.views.renderBehandlungen = renderBehandlungen;
  IM.views.volkAuswahl = volkAuswahl;
})();

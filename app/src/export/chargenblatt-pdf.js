(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.export = IM.export || {};
  const { store, models } = IM;
  const { formatDatum, formatZahl } = IM.ui;

  // Chargenblatt: der Weg einer Abfüllcharge rückwärts bis zum einzelnen Volk.
  //
  // Das ist das Dokument, das im Ernstfall zählt: Wenn zu einem Glas eine Frage
  // kommt, muss aus der Losnummer hervorgehen, aus welchem Gebinde es stammt,
  // welche Ernten dort eingeflossen sind, von welchen Völkern diese kamen — und
  // ob an diesen Völkern in der Saison behandelt wurde.

  function chargenblattPdf(abfuellung) {
    if (!abfuellung) return;
    const B = IM.export.pdfBasis;
    const ctx = B.neuesDokument();
    const h = models.chargenHerkunft(abfuellung, store.listGebinde(), store.listErnten());

    B.kopfzeile(ctx, `Chargenblatt ${abfuellung.losnummer || ''}`.trim(),
      `Abgefüllt am ${formatDatum(abfuellung.datum)}`);

    // --- Die Charge selbst ---
    ctx.ueberschrift('Abfüllcharge');
    ctx.merkmale([
      ['Losnummer', abfuellung.losnummer || '—'],
      ['Abgefüllt am', formatDatum(abfuellung.datum)],
      ['Mindestens haltbar bis', formatDatum(abfuellung.mhd) || '—'],
      ['Sorte', abfuellung.sorte || (h.trachten.join(', ') || '—')],
      ['Glasgröße', abfuellung.glasGroesseG ? `${abfuellung.glasGroesseG} g` : '—'],
      ['Anzahl Gläser', abfuellung.anzahlGlaeser ?? '—'],
      ['Abgefüllte Menge', `${formatZahl(models.abfuellMenge(abfuellung), 2)} kg`],
      ['Lagergebinde', h.gebinde ? [h.gebinde.nummer ? '#' + h.gebinde.nummer : '', h.gebinde.bezeichnung].filter(Boolean).join(' ') : '—'],
    ]);
    if (abfuellung.notiz) ctx.text(abfuellung.notiz, { size: 9 });

    if (!h.gebinde) {
      ctx.abstand(3);
      ctx.text('Dieser Charge ist kein Lagergebinde zugeordnet — die Herkunft lässt sich nicht belegen.',
        { size: 10, farbe: [155, 44, 44] });
      B.ausgeben(ctx, dateiname(abfuellung));
      return;
    }

    // --- Stufe: eingeflossene Ernten ---
    ctx.ueberschrift('Eingeflossene Ernten');
    if (!h.posten.length) {
      ctx.text('In dieses Gebinde wurde nichts eingefüllt.', { size: 9, farbe: [120, 120, 120] });
    } else {
      ctx.tabelle(
        ['Entnahme', 'Geschleudert', 'Tracht', 'Menge im Gebinde', 'Anteil', 'Wasser', 'Völker'],
        h.posten.map(p => {
          const e = p.ernte;
          if (!e) return ['—', '', '(Ernte nicht mehr vorhanden)', `${formatZahl(p.befuellung.mengeKg, 2)} kg`, '', '', ''];
          return [
            formatDatum(e.datum),
            formatDatum(e.schleuderdatum) || '',
            e.tracht || '',
            `${formatZahl(p.befuellung.mengeKg, 2)} kg`,
            (models.ernteAnteil(h.gebinde, e.id) ?? '') + ' %',
            e.wassergehalt ? `${e.wassergehalt} %` : '',
            volkNamen(e.volkIds),
          ];
        }),
        [12, 12, 15, 13, 8, 8, 32],
      );
    }

    // --- Stufe: beteiligte Völker ---
    ctx.ueberschrift('Beteiligte Völker');
    if (!h.volkIds.length) {
      ctx.text('Den eingeflossenen Ernten sind keine Völker zugeordnet.', { size: 9, farbe: [120, 120, 120] });
    } else {
      ctx.tabelle(
        ['Volk', 'Stand', 'Königin', 'Beute'],
        h.volkIds.map(id => {
          const v = store.getVolk(id);
          if (!v) return [id, '(nicht mehr vorhanden)', '', ''];
          const stand = store.getStand(models.aktuellerStandId(v));
          const k = v.koenigin || {};
          const farbe = models.koeniginFarbe(k.jahr);
          return [
            models.volkBezeichnung(v),
            stand ? stand.name : '',
            k.jahr ? `${k.jahr}${farbe ? ' (' + farbe.name + ')' : ''}` : '',
            [v.beutentyp, v.rahmenmass].filter(Boolean).join(' / '),
          ];
        }),
        [22, 28, 25, 25],
      );
    }

    // --- Behandlungen an diesen Völkern ---
    // Der Punkt, an dem sich Rückverfolgung und Bestandsbuch treffen: gab es an
    // einem beteiligten Volk eine Anwendung, deren Wartezeit zum Erntezeitpunkt
    // noch lief, gehört das hierher und nirgendwo sonst.
    ctx.ueberschrift('Arzneimittel-Anwendungen an diesen Völkern');
    const relevanteJahre = new Set(h.posten.filter(p => p.ernte).map(p => models.saisonVon(p.ernte.datum)));
    const behandlungen = store.listBehandlungen().filter(b =>
      b.art === 'behandlung' &&
      relevanteJahre.has(models.saisonVon(b.datum)) &&
      (b.volkIds || []).some(id => h.volkIds.includes(id)),
    ).sort((a, b) => String(a.datum).localeCompare(String(b.datum)));

    if (!behandlungen.length) {
      ctx.text('Keine Anwendung in den betroffenen Erntejahren erfasst.', { size: 9, farbe: [120, 120, 120] });
    } else {
      ctx.tabelle(
        ['Datum', 'Präparat / Wirkstoff', 'Charge', 'Menge', 'Wartezeit bis', 'Betroffene Völker'],
        behandlungen.map(b => [
          formatDatum(b.datum),
          [b.praeparat, b.wirkstoff].filter(Boolean).join(' / '),
          b.chargennummer || '',
          b.menge ? `${b.menge} ${b.einheit}` : '',
          b.wartezeitTage ? formatDatum(models.wartezeitBis(b)) : '—',
          volkNamen((b.volkIds || []).filter(id => h.volkIds.includes(id))),
        ]),
        [12, 24, 12, 10, 14, 28],
      );

      // Kollision prüfen: lag eine Ernte innerhalb einer laufenden Wartezeit?
      const kollisionen = [];
      for (const p of h.posten) {
        if (!p.ernte) continue;
        for (const id of (p.ernte.volkIds || [])) {
          if (!h.volkIds.includes(id)) continue;
          const bis = models.offeneWartezeit(behandlungen, id, p.ernte.datum);
          if (bis) {
            const v = store.getVolk(id);
            kollisionen.push(`${formatDatum(p.ernte.datum)}: ${v ? models.volkBezeichnung(v) : id} (Wartezeit bis ${formatDatum(bis)})`);
          }
        }
      }
      if (kollisionen.length) {
        ctx.abstand(2);
        ctx.text('Achtung — Ernte innerhalb einer laufenden Wartezeit:', { size: 9.5, stil: 'bold', farbe: [155, 44, 44] });
        for (const k of kollisionen) ctx.text('  ' + k, { size: 9, farbe: [155, 44, 44] });
      }
    }

    B.ausgeben(ctx, dateiname(abfuellung));
  }

  function dateiname(a) {
    const los = String(a.losnummer || 'Charge').replace(/[^\w-]/g, '_');
    return `Chargenblatt_${los}.pdf`;
  }

  function volkNamen(ids) {
    return (ids || []).map(id => {
      const v = store.getVolk(id);
      return v ? models.volkBezeichnung(v) : '?';
    }).join(', ');
  }

  IM.export.chargenblattPdf = chargenblattPdf;
})();

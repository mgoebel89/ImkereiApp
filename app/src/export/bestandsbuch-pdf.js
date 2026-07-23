(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.export = IM.export || {};
  const { store, models } = IM;
  const { formatDatum } = IM.ui;

  // Bestandsbuch (Nachweis über Tierarzneimittel-Anwendungen), ein Jahrgang.
  //
  // Enthält die Angaben, die für die Dokumentation einer Anwendung verlangt
  // werden: Datum, Anzahl behandelter Tiere/Völker, Arzneimittel, Menge,
  // Chargennummer, Wartezeit und Anwender. Reine Diagnosen stehen bewusst in
  // einem eigenen Abschnitt — sie sind keine Anwendung, aber sie belegen die
  // Indikation und gehören deshalb mit aufs Blatt.
  //
  // Kein Rechtsdokument-Generator: was das Veterinäramt konkret sehen will,
  // entscheidet das Amt. Das PDF liefert die erfassten Daten vollständig und
  // prüffähig sortiert.

  function bestandsbuchPdf(jahr) {
    const j = parseInt(jahr, 10) || new Date().getFullYear();
    const B = IM.export.pdfBasis;
    const ctx = B.neuesDokument({ quer: true });

    const imkerei = store.getSettings().imkerei || {};
    B.kopfzeile(ctx, 'Bestandsbuch — Tierarzneimittel', `Bienen · Jahrgang ${j}`);

    ctx.merkmale([
      ['Imkerei', imkerei.name],
      ['Tierhalter', imkerei.imker],
      ['Anschrift', imkerei.anschrift],
      ['Registriernummer', imkerei.registriernummer],
    ], 2);
    ctx.abstand(2);

    const alle = store.listBehandlungen().filter(b => models.saisonVon(b.datum) === j);
    const anwendungen = alle.filter(b => b.art === 'behandlung')
      .sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    const diagnosen = alle.filter(b => b.art === 'diagnose')
      .sort((a, b) => String(a.datum).localeCompare(String(b.datum)));

    ctx.ueberschrift(`Arzneimittel-Anwendungen (${anwendungen.length})`);
    if (!anwendungen.length) {
      ctx.text('Für dieses Jahr ist keine Anwendung erfasst.', { size: 9, farbe: [120, 120, 120] });
    } else {
      ctx.tabelle(
        ['Datum', 'Stand', 'Völker (Anzahl)', 'Arzneimittel / Wirkstoff', 'Charge', 'Menge je Volk', 'Anwendung', 'Wartezeit', 'Anwender'],
        anwendungen.map(b => [
          formatDatum(b.datum),
          standName(b.standId),
          `${(b.volkIds || []).length}`,
          [b.praeparat, b.wirkstoff].filter(Boolean).join(' / '),
          b.chargennummer || '',
          b.menge ? `${b.menge} ${b.einheit}` : '',
          b.anwendungsart || '',
          b.wartezeitTage ? `${b.wartezeitTage} T → ${formatDatum(models.wartezeitBis(b))}` : '0 Tage',
          b.anwender || '',
        ]),
        [9, 12, 8, 22, 10, 10, 10, 12, 10],
      );

      // Welche Völker das im Einzelnen waren, gehört dazu — die Tabelle oben
      // bliebe sonst unbelegt. Deshalb die Auflistung im Anschluss.
      ctx.abstand(3);
      ctx.ueberschrift('Behandelte Völker im Einzelnen', 11);
      for (const b of anwendungen) {
        ctx.text(`${formatDatum(b.datum)} · ${b.praeparat || 'Anwendung'}: ${volkNamen(b.volkIds)}`, { size: 8.5 });
        if (b.bemerkung) ctx.text('   ' + b.bemerkung, { size: 8, farbe: [110, 110, 110] });
      }
    }

    ctx.abstand(4);
    ctx.ueberschrift(`Varroa-Diagnosen (${diagnosen.length})`);
    if (!diagnosen.length) {
      ctx.text('Für dieses Jahr ist keine Diagnose erfasst.', { size: 9, farbe: [120, 120, 120] });
    } else {
      ctx.tabelle(
        ['Datum', 'Stand', 'Völker', 'Methode', 'Milben gesamt', 'Tage', 'Milben/Tag', 'Bewertung'],
        diagnosen.map(b => {
          const proTag = models.milbenProTag(b);
          const bew = models.milbenBewertung(proTag, parseInt(String(b.datum || '').slice(5, 7), 10));
          return [
            formatDatum(b.datum),
            standName(b.standId),
            `${(b.volkIds || []).length}`,
            b.methode || '',
            b.milbenGesamt ?? '',
            b.tage ?? '',
            proTag === null ? '' : String(proTag),
            bew ? bew.text : '',
          ];
        }),
        [10, 15, 8, 22, 12, 8, 10, 18],
      );
    }

    ctx.abstand(6);
    ctx.text('Die Richtigkeit der Angaben wird bestätigt.', { size: 9 });
    ctx.abstand(12);
    ctx.doc.setDrawColor(120);
    ctx.doc.line(ctx.links, ctx.y, ctx.links + 70, ctx.y);
    ctx.y += 4;
    ctx.text('Ort, Datum, Unterschrift', { size: 8, farbe: [120, 120, 120] });

    B.ausgeben(ctx, `Bestandsbuch_${j}.pdf`);
  }

  function standName(id) {
    const s = store.getStand(id);
    return s ? s.name : '';
  }

  function volkNamen(ids) {
    return (ids || []).map(id => {
      const v = store.getVolk(id);
      return v ? models.volkBezeichnung(v) : '?';
    }).join(', ') || '—';
  }

  IM.export.bestandsbuchPdf = bestandsbuchPdf;
})();

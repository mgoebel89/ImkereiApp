(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.export = IM.export || {};
  const { store, models } = IM;
  const { formatDatum } = IM.ui;

  // Stockkarte als PDF: ein Dokument je Volk und Saison.
  //
  // Reihenfolge im PDF ist AUFSTEIGEND (älteste zuerst) — anders als am
  // Bildschirm. Eine ausgedruckte Karte liest man von oben nach unten durch die
  // Saison, während man am Schirm den letzten Stand zuerst sehen will.

  function stockkartePdf(volk, saison) {
    if (!volk) return;
    const jahre = [...new Set((volk.durchsichten || []).map(d => models.saisonVon(d.datum)).filter(Boolean))].sort();
    const jahr = saison || (jahre.length ? jahre[jahre.length - 1] : new Date().getFullYear());

    // Mehrere Saisons vorhanden? Dann fragen, welche gedruckt werden soll.
    if (!saison && jahre.length > 1) {
      return saisonWaehlen(volk, jahre, j => stockkartePdf(volk, j));
    }

    const B = IM.export.pdfBasis;
    const ctx = B.neuesDokument();
    B.kopfzeile(ctx, `Stockkarte ${models.volkBezeichnung(volk)}`, `Saison ${jahr}`);

    schreibeStammdaten(ctx, volk, jahr);
    schreibeDurchsichten(ctx, volk, jahr);
    schreibeBehandlungen(ctx, volk, jahr);
    schreibeFuetterungen(ctx, volk, jahr);

    const name = `Stockkarte_${(volk.nummer || volk.name || 'Volk').replace(/[^\w-]/g, '')}_${jahr}.pdf`;
    B.ausgeben(ctx, name);
  }

  function saisonWaehlen(volk, jahre, weiter) {
    const { el, modal } = IM.ui;
    const knoepfe = el('div', { class: 'btn-reihe' });
    let m;
    for (const j of jahre.slice().reverse()) {
      knoepfe.appendChild(el('button', {
        class: 'btn', onclick: () => { m.close(); weiter(j); },
      }, String(j)));
    }
    m = modal('Welche Saison?', el('div', {}, [
      el('p', { class: 'muted' }, 'Für dieses Volk gibt es Einträge aus mehreren Jahren.'),
      knoepfe,
    ]));
  }

  function schreibeStammdaten(ctx, v, jahr) {
    const stand = store.getStand(models.aktuellerStandId(v));
    const k = v.koenigin || {};
    const farbe = models.koeniginFarbe(k.jahr);

    ctx.ueberschrift('Volk');
    ctx.merkmale([
      ['Nummer', v.nummer || '—'],
      ['Name', v.name || '—'],
      ['Stand', stand ? stand.name : '—'],
      ['Status', models.VOLK_STATUS_LABEL[v.status] || v.status],
      ['Herkunft', v.herkunft],
      ['Beute', [v.beutentyp, v.rahmenmass].filter(Boolean).join(' / ')],
      ['Angelegt am', formatDatum(v.erstelltAm)],
    ]);

    ctx.ueberschrift('Königin');
    ctx.merkmale([
      ['Schlupfjahr', k.jahr ? `${k.jahr}${farbe ? ' (' + farbe.name + ')' : ''}` : '—'],
      ['Alter in dieser Saison', k.jahr ? `${jahr - k.jahr} Jahr(e)` : '—'],
      ['Herkunft', k.herkunft],
      ['Linie / Rasse', k.linie],
      ['Gezeichnet', k.jahr ? (k.gezeichnet ? 'ja' : 'nein') : ''],
      ['Im Volk seit', formatDatum(k.seitDatum)],
    ]);
    if (k.bemerkung) ctx.text(k.bemerkung, { size: 9 });

    // Wanderungen der Saison gehören auf die Karte — der Standort bestimmt die
    // Tracht und damit die Deutung aller folgenden Einträge.
    const wanderungen = (v.standHistorie || [])
      .filter(h => models.saisonVon(h.datum) === jahr)
      .sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    if (wanderungen.length) {
      ctx.ueberschrift('Standortwechsel');
      ctx.tabelle(['Datum', 'Neuer Stand', 'Notiz'], wanderungen.map(h => {
        const s = store.getStand(h.standId);
        return [formatDatum(h.datum), s ? s.name : '—', h.notiz || ''];
      }), [18, 32, 50]);
    }
  }

  function schreibeDurchsichten(ctx, v, jahr) {
    const liste = models.durchsichtenSortiert(v, true).filter(d => models.saisonVon(d.datum) === jahr);
    ctx.ueberschrift(`Durchsichten (${liste.length})`);
    if (!liste.length) {
      ctx.text('Keine Durchsichten in dieser Saison erfasst.', { size: 9, farbe: [120, 120, 120] });
      return;
    }

    for (const d of liste) {
      // Ein Block je Durchsicht statt einer breiten Tabelle: die Felder sind zu
      // viele und zu ungleich gefüllt, um in Spalten lesbar zu bleiben.
      ctx.platz(14);
      ctx.abstand(2);
      ctx.doc.setFillColor(250, 246, 236);
      const startY = ctx.y - 4;

      ctx.text(formatDatum(d.datum) + (d.wetter ? `   ·   ${d.wetter}` : ''), { size: 10.5, stil: 'bold' });
      ctx.merkmale([
        ['Volksstärke', d.volksstaerke ? d.volksstaerke + '/5' : ''],
        ['Wabengassen', d.besetzteWabengassen],
        ['Brutbild', d.brutbild],
        ['Weiselzellen', d.weiselzellen],
        ['Stifte', d.stifteGesehen ? 'gesehen' : ''],
        ['Königin', d.koeniginGesehen ? 'gesehen' : ''],
        ['Sanftmut', d.sanftmut ? d.sanftmut + '/5' : ''],
        ['Wabensitz', d.wabensitz ? d.wabensitz + '/5' : ''],
        ['Zargen', d.zargen],
        ['Waben ges./Brut/Futter', [d.wabenGesamt, d.wabenBrut, d.wabenFutter].some(x => x != null)
          ? `${d.wabenGesamt ?? '–'} / ${d.wabenBrut ?? '–'} / ${d.wabenFutter ?? '–'}` : ''],
        ['Futter', d.futter],
        ['Stimmung', d.stimmung],
      ]);
      if ((d.arbeiten || []).length) {
        ctx.text('Arbeiten: ' + d.arbeiten.join(', '), { size: 9 });
      }
      if (d.notiz) {
        ctx.text(d.notiz, { size: 9 });
      }
      const fotos = store.listVolkFotos(v.id).filter(f => f.kind === 'ds_' + d.id);
      if (fotos.length) {
        ctx.text(`(${fotos.length} Foto(s) in der App hinterlegt)`, { size: 8, farbe: [140, 140, 140] });
      }
      ctx.trennlinie({ hell: true });
    }
  }

  function schreibeBehandlungen(ctx, v, jahr) {
    const liste = models.massnahmenFuerVolk(store.listBehandlungen(), v.id)
      .filter(b => models.saisonVon(b.datum) === jahr)
      .sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    if (!liste.length) return;

    ctx.ueberschrift(`Varroa-Diagnosen und Behandlungen (${liste.length})`);
    ctx.tabelle(
      ['Datum', 'Art', 'Präparat / Methode', 'Menge', 'Charge', 'Wartezeit bis'],
      liste.map(b => [
        formatDatum(b.datum),
        b.art === 'diagnose' ? 'Diagnose' : 'Behandlung',
        b.art === 'diagnose'
          ? `${b.methode || ''}${models.milbenProTag(b) !== null ? ` (${models.milbenProTag(b)}/Tag)` : ''}`
          : (b.praeparat || ''),
        b.art === 'behandlung' && b.menge ? `${b.menge} ${b.einheit}` : '',
        b.chargennummer || '',
        b.art === 'behandlung' && b.wartezeitTage ? formatDatum(models.wartezeitBis(b)) : '',
      ]),
      [14, 13, 30, 13, 15, 15],
    );
  }

  function schreibeFuetterungen(ctx, v, jahr) {
    const liste = models.massnahmenFuerVolk(store.listFuetterungen(), v.id)
      .filter(f => models.saisonVon(f.datum) === jahr)
      .sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
    if (!liste.length) return;

    const summe = liste.reduce((acc, f) => {
      const e = f.einheit || 'kg';
      acc[e] = (acc[e] || 0) + (Number(f.mengeProVolk) || 0);
      return acc;
    }, {});

    ctx.ueberschrift(`Fütterungen (${liste.length})`);
    ctx.tabelle(
      ['Datum', 'Futterart', 'Menge', 'Anlass', 'Notiz'],
      liste.map(f => [
        formatDatum(f.datum), f.futterart || '',
        `${f.mengeProVolk ?? ''} ${f.einheit || ''}`.trim(),
        f.anlass || '', f.notiz || '',
      ]),
      [15, 25, 13, 22, 25],
    );
    const summenText = Object.entries(summe).map(([e, m]) => `${Math.round(m * 100) / 100} ${e}`).join(' + ');
    ctx.abstand(1);
    ctx.text(`Summe für dieses Volk: ${summenText}`, { size: 9, stil: 'bold' });
  }

  IM.export.stockkartePdf = stockkartePdf;
})();

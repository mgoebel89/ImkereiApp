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

    // Querformat: die Durchsichten stehen als Tabelle, und neun Spalten plus
    // Notizspalte werden im Hochformat unlesbar schmal.
    const B = IM.export.pdfBasis;
    const ctx = B.neuesDokument({ quer: true });
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

    // Eine Zeile je Durchsicht. Die letzte Spalte nimmt auf, was sich nicht in
    // eine Zahl fassen lässt (Arbeiten, Notiz, Beobachtungen) — die Tabelle
    // rechnet die Zeilenhöhe danach aus, sodass nichts abgeschnitten wird.
    ctx.tabelle(
      ['Datum', 'Stärke', 'Gassen', 'Brutbild', 'Weiselzellen', 'Sanftmut', 'Zargen', 'Waben G/B/F', 'Futter', 'Arbeiten und Bemerkungen'],
      liste.map(d => {
        const fotos = store.listVolkFotos(v.id).filter(f => f.kind === 'ds_' + d.id);
        const bemerkung = [];
        if ((d.arbeiten || []).length) bemerkung.push(d.arbeiten.join(', '));
        if (d.notiz) bemerkung.push(d.notiz);
        const beobachtet = [];
        if (d.wetter) beobachtet.push(d.wetter);
        if (d.stifteGesehen) beobachtet.push('Stifte');
        if (d.koeniginGesehen) beobachtet.push('Königin gesehen');
        if (d.wabensitz) beobachtet.push(`Wabensitz ${d.wabensitz}/5`);
        if (d.stimmung) beobachtet.push(d.stimmung);
        if (fotos.length) beobachtet.push(`${fotos.length} Foto(s) in der App`);
        if (beobachtet.length) bemerkung.push('(' + beobachtet.join(', ') + ')');
        return [
          formatDatum(d.datum),
          d.volksstaerke ? `${d.volksstaerke}/5` : '',
          d.besetzteWabengassen ?? '',
          d.brutbild || '',
          d.weiselzellen || '',
          models.sanftmutKurz(d.sanftmut),
          d.zargen ?? '',
          [d.wabenGesamt, d.wabenBrut, d.wabenFutter].some(x => x != null)
            ? `${d.wabenGesamt ?? '–'}/${d.wabenBrut ?? '–'}/${d.wabenFutter ?? '–'}` : '',
          d.futter || '',
          bemerkung.join(' — '),
        ];
      }),
      [9, 6, 6, 12, 12, 7, 5, 8, 10, 25],
    );
    ctx.abstand(2);
    ctx.text('Sanftmut als Schulnote: 1 = sehr friedlich … 6 = stechlustig. Volksstärke und Wabensitz 1–5, 5 = sehr gut.',
      { size: 7.5, farbe: [130, 130, 130] });
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

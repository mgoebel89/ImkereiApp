(function () {
  'use strict';
  window.IM = window.IM || {};

  const SCHEMA_VERSION = 1;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ---------------------------------------------------------------------------
  // Datum
  // ---------------------------------------------------------------------------
  // WICHTIG: NIE toISOString() benutzen, um ein Kalenderdatum zu bilden. Das
  // rechnet nach UTC und schiebt in unserer Zeitzone die lokale Mitternacht auf
  // den Vortag. Immer über die lokalen Komponenten gehen.
  function dateToIso(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  }
  function heute() { return dateToIso(new Date()); }
  function jahrVon(iso) { return iso ? parseInt(String(iso).slice(0, 4), 10) : null; }

  // Ein Bienenjahr ist kein Kalenderjahr — die Saison läuft vom Frühjahr bis zur
  // Einwinterung. Für die Stockkarte reicht aber das Kalenderjahr, weil die
  // Winterruhe ohnehin fast eintragsfrei ist. Bewusste Vereinfachung.
  function saisonVon(iso) { return jahrVon(iso); }

  // ---------------------------------------------------------------------------
  // Königinnen
  // ---------------------------------------------------------------------------
  // Internationaler Farbcode nach Schlupfjahr — die Farbe wiederholt sich alle
  // fünf Jahre und ergibt sich zwingend aus der letzten Ziffer des Jahres.
  const KOENIGIN_FARBEN = {
    1: { name: 'weiß', hex: '#f5f5f5', text: '#333' },
    2: { name: 'gelb', hex: '#ffd400', text: '#333' },
    3: { name: 'rot', hex: '#e03131', text: '#fff' },
    4: { name: 'grün', hex: '#2f9e44', text: '#fff' },
    5: { name: 'blau', hex: '#1971c2', text: '#fff' },
    6: { name: 'weiß', hex: '#f5f5f5', text: '#333' },
    7: { name: 'gelb', hex: '#ffd400', text: '#333' },
    8: { name: 'rot', hex: '#e03131', text: '#fff' },
    9: { name: 'grün', hex: '#2f9e44', text: '#fff' },
    0: { name: 'blau', hex: '#1971c2', text: '#fff' },
  };
  function koeniginFarbe(jahr) {
    const j = parseInt(jahr, 10);
    if (!j) return null;
    return KOENIGIN_FARBEN[j % 10] || null;
  }
  // Alter der Königin in Jahren — ab dem dritten Jahr lässt die Legeleistung
  // typischerweise nach, deshalb blendet die Oberfläche das ein.
  function koeniginAlter(volk, bezugsjahr) {
    const j = volk && volk.koenigin && parseInt(volk.koenigin.jahr, 10);
    if (!j) return null;
    return (bezugsjahr || new Date().getFullYear()) - j;
  }

  const KOENIGIN_HERKUNFT = ['eigene Nachzucht', 'Schwarm', 'Nachschaffung', 'zugekauft', 'unbekannt'];

  // ---------------------------------------------------------------------------
  // Volk
  // ---------------------------------------------------------------------------
  const VOLK_STATUS = ['aktiv', 'aufgeloest', 'eingegangen', 'verkauft', 'vereinigt'];
  const VOLK_STATUS_LABEL = {
    aktiv: 'aktiv',
    aufgeloest: 'aufgelöst',
    eingegangen: 'eingegangen',
    verkauft: 'verkauft',
    vereinigt: 'vereinigt',
  };

  const VOLK_HERKUNFT = ['Ableger', 'Kunstschwarm', 'Schwarm', 'Teilung', 'zugekauft', 'Altvolk'];
  const BEUTENTYPEN = ['Segeberger', 'Zander-Holz', 'Dadant', 'Liebig', 'Warré', 'Top-Bar', 'sonstige'];
  const RAHMENMASSE = ['Zander', 'Deutsch Normal (DN)', 'Dadant', 'Langstroth', 'Kuntzsch', 'sonstige'];

  function emptyStand() {
    return {
      id: uuid(),
      name: '',
      adresse: '',
      lat: null,
      lng: null,
      notiz: '',
      aktiv: true,
      erstelltAm: heute(),
      lastModifiedAt: '',
      schemaVersion: SCHEMA_VERSION,
    };
  }

  function emptyVolk() {
    return {
      id: uuid(),
      nummer: '',
      name: '',
      standId: '',
      status: 'aktiv',
      statusDatum: '',
      statusNotiz: '',
      vereinigtMitId: '',
      herkunft: '',
      beutentyp: '',
      rahmenmass: '',
      koenigin: emptyKoenigin(),
      koeniginHistorie: [],  // frühere Königinnen (beim Umweiseln abgelegt)
      standHistorie: [],     // Wanderungen: [{id, datum, standId, notiz}]
      durchsichten: [],
      paperlessDocs: [],
      erstelltAm: heute(),
      lastModifiedAt: '',
      schemaVersion: SCHEMA_VERSION,
    };
  }

  function emptyKoenigin() {
    return {
      jahr: null,
      herkunft: '',
      linie: '',
      gezeichnet: false,
      beschnitten: false,
      seitDatum: '',
      bemerkung: '',
    };
  }

  // ---------------------------------------------------------------------------
  // Durchsicht (ein Stockkarten-Eintrag)
  // ---------------------------------------------------------------------------
  // Die Skalen sind bewusst 1–5 und einheitlich gerichtet: 5 ist immer „gut".
  // Das erspart beim Blättern durch die Historie das Umdenken.
  const SKALA = [
    { wert: 1, label: '1 – sehr schwach' },
    { wert: 2, label: '2 – schwach' },
    { wert: 3, label: '3 – mittel' },
    { wert: 4, label: '4 – gut' },
    { wert: 5, label: '5 – sehr gut' },
  ];
  const SKALA_SANFTMUT = [
    { wert: 1, label: '1 – stechlustig' },
    { wert: 2, label: '2 – unruhig' },
    { wert: 3, label: '3 – normal' },
    { wert: 4, label: '4 – ruhig' },
    { wert: 5, label: '5 – sehr sanft' },
  ];

  const BRUTBILD = ['sehr gut geschlossen', 'gut', 'lückig', 'nur Drohnenbrut', 'keine Brut'];
  const WEISELZELLEN = ['keine', 'Spielnäpfchen', 'Schwarmzellen', 'Nachschaffungszellen', 'drohnenbrütig'];
  const FUTTER = ['reichlich', 'ausreichend', 'knapp', 'Notfütterung nötig'];
  const STIMMUNG = ['ruhig', 'Schwarmstimmung', 'Räuberei', 'weisellos'];

  // Standard-Arbeiten als Mehrfachauswahl. Freitext bleibt zusätzlich möglich —
  // die Liste soll die häufigen Handgriffe wegtippen, nicht einschränken.
  const ARBEITEN = [
    'Honigraum aufgesetzt',
    'Honigraum abgenommen',
    'Absperrgitter eingelegt',
    'Zarge erweitert',
    'Zarge entnommen',
    'Drohnenrahmen geschnitten',
    'Schwarmzellen gebrochen',
    'Ableger gebildet',
    'Königin umgeweiselt',
    'Volk vereinigt',
    'Waben erneuert',
    'Mittelwände gegeben',
    'Fluglochkeil gesetzt',
    'Windel eingelegt',
    'Windel entnommen',
    'Beute gereinigt',
  ];

  function emptyDurchsicht() {
    return {
      id: uuid(),
      datum: heute(),
      wetter: '',
      volksstaerke: null,        // 1–5
      besetzteWabengassen: null, // konkrete Zahl, falls gezählt
      brutbild: '',
      stifteGesehen: false,
      koeniginGesehen: false,
      weiselzellen: '',
      sanftmut: null,            // 1–5
      wabensitz: null,           // 1–5
      stimmung: '',
      zargen: null,
      wabenGesamt: null,
      wabenBrut: null,
      wabenFutter: null,
      futter: '',
      arbeiten: [],
      notiz: '',
      fotoIds: [],
      schemaVersion: SCHEMA_VERSION,
    };
  }

  // ---------------------------------------------------------------------------
  // Behandlungen (Varroa-Diagnose und Arzneimittel-Anwendung)
  // ---------------------------------------------------------------------------
  // Eine Behandlung betrifft in der Praxis meist einen ganzen Stand, deshalb
  // volkIds[] statt einem Eintrag je Volk. Das Bestandsbuch braucht genau diese
  // Sicht: eine Anwendung, mehrere behandelte Völker.
  const BEHANDLUNG_ART = ['diagnose', 'behandlung'];
  const DIAGNOSE_METHODEN = ['Gemülldiagnose (Windel)', 'Puderzuckermethode', 'Auswaschmethode', 'Bodeneinlage'];

  // Gängige Präparate mit Wirkstoff und Wartezeit. Die Wartezeit ist der Grund,
  // warum das hier steht: sie entscheidet, ob geerntet werden darf.
  const PRAEPARATE = [
    { name: 'Ameisensäure 60 %', wirkstoff: 'Ameisensäure', wartezeit: 0 },
    { name: 'Oxalsäure 3,5 % (Träufeln)', wirkstoff: 'Oxalsäuredihydrat', wartezeit: 0 },
    { name: 'Oxalsäure (Sublimation)', wirkstoff: 'Oxalsäuredihydrat', wartezeit: 0 },
    { name: 'Milchsäure 15 %', wirkstoff: 'Milchsäure', wartezeit: 0 },
    { name: 'Thymol (Apiguard/Thymovar)', wirkstoff: 'Thymol', wartezeit: 0 },
    { name: 'Bienenwohl', wirkstoff: 'Oxalsäure', wartezeit: 0 },
    { name: 'sonstiges', wirkstoff: '', wartezeit: 0 },
  ];
  const ANWENDUNGSARTEN = ['Träufeln', 'Sprühen', 'Verdunsten', 'Sublimation', 'Streifen einhängen', 'Schwammtuch'];

  function emptyBehandlung() {
    return {
      id: uuid(),
      datum: heute(),
      art: 'behandlung',
      volkIds: [],
      standId: '',
      // Diagnose
      methode: '',
      milbenGesamt: null,
      tage: null,
      // Anwendung (Pflichtangaben fürs Bestandsbuch)
      praeparat: '',
      wirkstoff: '',
      chargennummer: '',
      menge: null,
      einheit: 'ml',
      anwendungsart: '',
      wartezeitTage: 0,
      anwender: '',
      indikation: 'Varroose',
      bemerkung: '',
      lastModifiedAt: '',
      schemaVersion: SCHEMA_VERSION,
    };
  }

  // Natürlicher Milbenfall je Tag — die Kennzahl, an der die Behandlungs-
  // schwelle hängt. Ohne Tage-Angabe ist die Zahl wertlos, dann null.
  function milbenProTag(b) {
    const n = Number(b && b.milbenGesamt);
    const t = Number(b && b.tage);
    if (!n && n !== 0) return null;
    if (!t) return null;
    return Math.round((n / t) * 10) / 10;
  }

  // Faustzahlen aus der Imkerpraxis: im Sommer gilt ein Fall über 10 Milben/Tag
  // als behandlungsbedürftig, im Frühjahr schon ab etwa 5. Das ist eine grobe
  // Orientierung, keine Diagnose — deshalb nur als Ampel in der Oberfläche.
  function milbenBewertung(proTag, monat) {
    if (proTag === null || proTag === undefined) return null;
    const schwelle = (monat >= 6 && monat <= 9) ? 10 : 5;
    if (proTag >= schwelle) return { stufe: 'kritisch', text: `über Schwelle (${schwelle}/Tag)` };
    if (proTag >= schwelle / 2) return { stufe: 'warnung', text: 'beobachten' };
    return { stufe: 'ok', text: 'unauffällig' };
  }

  // Bis wann darf nach einer Anwendung nicht geerntet werden?
  function wartezeitBis(b) {
    const tage = Number(b && b.wartezeitTage) || 0;
    if (!b || !b.datum || !tage) return '';
    const d = new Date(b.datum + 'T00:00:00');
    d.setDate(d.getDate() + tage);
    return dateToIso(d);
  }

  // ---------------------------------------------------------------------------
  // Fütterungen
  // ---------------------------------------------------------------------------
  const FUTTERARTEN = [
    { name: 'Zuckerwasser 3:2', einheit: 'l' },
    { name: 'Zuckerwasser 1:1', einheit: 'l' },
    { name: 'Invertzuckersirup', einheit: 'kg' },
    { name: 'Futterteig', einheit: 'kg' },
    { name: 'eigener Honig', einheit: 'kg' },
  ];

  function emptyFuetterung() {
    return {
      id: uuid(),
      datum: heute(),
      volkIds: [],
      standId: '',
      futterart: '',
      mengeProVolk: null,
      einheit: 'kg',
      anlass: '',           // z. B. Auffütterung, Reizfütterung, Notfütterung
      notiz: '',
      lastModifiedAt: '',
      schemaVersion: SCHEMA_VERSION,
    };
  }

  const FUETTERUNG_ANLASS = ['Auffütterung (Einwinterung)', 'Reizfütterung', 'Notfütterung', 'Ableger'];

  // Gesamtmenge einer Fütterung über alle beteiligten Völker.
  function fuetterungGesamt(f) {
    const m = Number(f && f.mengeProVolk) || 0;
    const n = (f && f.volkIds ? f.volkIds.length : 0);
    return Math.round(m * n * 100) / 100;
  }

  // ---------------------------------------------------------------------------
  // Abgeleitete Sichten aufs Volk
  // ---------------------------------------------------------------------------
  function volkBezeichnung(v) {
    if (!v) return '';
    const nr = v.nummer ? `#${v.nummer}` : '';
    return [nr, v.name].filter(Boolean).join(' ') || 'Ohne Nummer';
  }

  // Durchsichten immer absteigend — die jüngste zuerst, so liest man eine
  // Stockkarte am Bildschirm. Das PDF dreht das bewusst um (siehe stockkarte-pdf).
  function durchsichtenSortiert(v, aufsteigend) {
    const list = (v && v.durchsichten ? v.durchsichten.slice() : []);
    list.sort((a, b) => String(a.datum || '').localeCompare(String(b.datum || '')));
    return aufsteigend ? list : list.reverse();
  }

  function letzteDurchsicht(v) {
    return durchsichtenSortiert(v)[0] || null;
  }

  // Tage seit der letzten Durchsicht — die Zahl, die auf der Übersicht zeigt,
  // welches Volk zu lange nicht gesehen wurde.
  function tageSeitDurchsicht(v) {
    const d = letzteDurchsicht(v);
    if (!d || !d.datum) return null;
    const then = new Date(d.datum + 'T00:00:00');
    const now = new Date(heute() + 'T00:00:00');
    return Math.round((now - then) / 86400000);
  }

  // In der Schwarmzeit (April–Juni) will man alle 7–9 Tage nachsehen, sonst
  // reicht deutlich weniger. Die Ampel richtet sich danach.
  function durchsichtFaellig(v, heuteIso) {
    if (!v || v.status !== 'aktiv') return null;
    const tage = tageSeitDurchsicht(v);
    if (tage === null) return { stufe: 'offen', text: 'noch keine Durchsicht' };
    const monat = parseInt(String(heuteIso || heute()).slice(5, 7), 10);
    const schwarmzeit = monat >= 4 && monat <= 6;
    const limit = schwarmzeit ? 9 : 21;
    if (tage > limit) return { stufe: 'faellig', text: `seit ${tage} Tagen nicht gesehen` };
    if (tage > limit - 3) return { stufe: 'bald', text: `vor ${tage} Tagen` };
    return { stufe: 'ok', text: `vor ${tage} Tagen` };
  }

  // Wo steht das Volk gerade? Die Wanderungshistorie gewinnt, wenn sie einen
  // jüngeren Eintrag hat als das Feld — so bleibt beides konsistent.
  function aktuellerStandId(v) {
    if (!v) return '';
    const h = (v.standHistorie || []).slice().sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));
    return (h[0] && h[0].standId) || v.standId || '';
  }

  function voelkerAmStand(voelker, standId, nurAktive) {
    return (voelker || []).filter(v => {
      if (nurAktive && v.status !== 'aktiv') return false;
      return aktuellerStandId(v) === standId;
    });
  }

  // Alle Behandlungen/Fütterungen, die dieses Volk betreffen — chronologisch.
  function massnahmenFuerVolk(list, volkId) {
    return (list || [])
      .filter(x => (x.volkIds || []).includes(volkId))
      .sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));
  }

  // Läuft für dieses Volk gerade eine Wartezeit? Dann darf nicht geerntet
  // werden — das Honigmodul wird das später abfragen.
  function offeneWartezeit(behandlungen, volkId, stichtag) {
    const tag = stichtag || heute();
    let bis = '';
    for (const b of massnahmenFuerVolk(behandlungen, volkId)) {
      if (b.art !== 'behandlung') continue;
      const w = wartezeitBis(b);
      if (w && w >= tag && w > bis) bis = w;
    }
    return bis || null;
  }

  IM.models = {
    SCHEMA_VERSION, uuid,
    dateToIso, heute, jahrVon, saisonVon,
    KOENIGIN_FARBEN, koeniginFarbe, koeniginAlter, KOENIGIN_HERKUNFT,
    VOLK_STATUS, VOLK_STATUS_LABEL, VOLK_HERKUNFT, BEUTENTYPEN, RAHMENMASSE,
    emptyStand, emptyVolk, emptyKoenigin, emptyDurchsicht,
    SKALA, SKALA_SANFTMUT, BRUTBILD, WEISELZELLEN, FUTTER, STIMMUNG, ARBEITEN,
    BEHANDLUNG_ART, DIAGNOSE_METHODEN, PRAEPARATE, ANWENDUNGSARTEN,
    emptyBehandlung, milbenProTag, milbenBewertung, wartezeitBis,
    FUTTERARTEN, FUETTERUNG_ANLASS, emptyFuetterung, fuetterungGesamt,
    volkBezeichnung, durchsichtenSortiert, letzteDurchsicht, tageSeitDurchsicht,
    durchsichtFaellig, aktuellerStandId, voelkerAmStand, massnahmenFuerVolk, offeneWartezeit,
  };
})();

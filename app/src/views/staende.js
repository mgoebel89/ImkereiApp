(function () {
  'use strict';
  window.IM = window.IM || {};
  IM.views = IM.views || {};
  const { el, karte, feld, input, textarea, modal, toast, confirmDialog, leer } = IM.ui;
  const { store, models } = IM;

  function renderStaende(mount) {
    const staende = store.listStaende().slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
    const voelker = store.listVoelker();

    const toolbar = el('div', { class: 'toolbar' }, [
      el('h1', {}, 'Bienenstände'),
      el('button', { class: 'btn btn-primary', onclick: () => neuerStand(mount) }, '＋ Neuer Stand'),
    ]);
    mount.appendChild(toolbar);

    if (!staende.length) {
      mount.appendChild(karte(null, leer('Noch kein Bienenstand angelegt. Ein Stand ist der Aufstellungsort — jedes Volk gehört zu genau einem.')));
      return;
    }

    const grid = el('div', { class: 'kachel-grid' });
    for (const s of staende) {
      const amStand = models.voelkerAmStand(voelker, s.id, true);
      // Wie viele Völker sind hier überfällig? Das ist die Zahl, wegen der man
      // überhaupt auf diese Seite schaut.
      const faellig = amStand.filter(v => {
        const f = models.durchsichtFaellig(v);
        return f && (f.stufe === 'faellig' || f.stufe === 'offen');
      }).length;

      const kachel = el('div', {
        class: 'kachel' + (s.aktiv ? '' : ' kachel-inaktiv'),
        onclick: () => { location.hash = `#/voelker?stand=${encodeURIComponent(s.id)}`; },
      }, [
        el('div', { class: 'kachel-kopf' }, [
          el('h3', {}, s.name || 'Ohne Namen'),
          !s.aktiv ? el('span', { class: 'tag' }, 'inaktiv') : null,
        ]),
        s.adresse ? el('p', { class: 'muted' }, s.adresse) : null,
        el('div', { class: 'kachel-zahlen' }, [
          el('div', { class: 'zahl' }, [el('strong', {}, String(amStand.length)), el('span', {}, 'Völker')]),
          faellig
            ? el('div', { class: 'zahl zahl-warn' }, [el('strong', {}, String(faellig)), el('span', {}, 'fällig')])
            : null,
        ]),
        el('div', { class: 'kachel-fuss' }, [
          el('button', {
            class: 'btn btn-sm',
            onclick: (e) => { e.stopPropagation(); standBearbeiten(mount, s); },
          }, 'Bearbeiten'),
        ]),
      ]);
      grid.appendChild(kachel);
    }
    mount.appendChild(grid);
  }

  function neuerStand(mount) {
    standBearbeiten(mount, models.emptyStand(), true);
  }

  function standBearbeiten(mount, original, istNeu) {
    // Auf einer Kopie arbeiten: Abbrechen soll wirklich nichts hinterlassen.
    const s = JSON.parse(JSON.stringify(original));

    const body = el('div', { class: 'form-grid' }, [
      feld('Name des Standes', input({ value: s.name || '', oninput: e => s.name = e.target.value, placeholder: 'z. B. Hausstand, Streuobstwiese' }), { breit: true }),
      feld('Adresse / Lagebeschreibung', input({ value: s.adresse || '', oninput: e => s.adresse = e.target.value }), { breit: true }),
      feld('Breitengrad (Lat)', input({ type: 'number', step: 'any', value: s.lat ?? '', oninput: e => s.lat = e.target.value === '' ? null : Number(e.target.value) })),
      feld('Längengrad (Lng)', input({ type: 'number', step: 'any', value: s.lng ?? '', oninput: e => s.lng = e.target.value === '' ? null : Number(e.target.value) })),
      feld('Notiz', textarea({ value: s.notiz || '', oninput: e => s.notiz = e.target.value }), { breit: true }),
      feld('Aktiv', el('input', {
        type: 'checkbox', class: 'chk', checked: !!s.aktiv,
        onchange: e => s.aktiv = e.target.checked,
      })),
    ]);

    const m = modal(istNeu ? 'Neuer Bienenstand' : 'Stand bearbeiten', body, {
      fuss: [
        !istNeu ? el('button', {
          class: 'btn btn-danger', onclick: () => {
            const anzahl = models.voelkerAmStand(store.listVoelker(), s.id, false).length;
            if (anzahl > 0) {
              toast(`Stand hat noch ${anzahl} Volk/Völker — bitte erst umsetzen.`, 4000);
              return;
            }
            if (!confirmDialog(`Stand „${s.name}" wirklich löschen?`)) return;
            store.deleteStand(s.id);
            m.close();
            neuRendern(mount);
          },
        }, 'Löschen') : null,
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'),
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            if (!s.name.trim()) { toast('Bitte einen Namen vergeben.'); return; }
            store.saveStand(s);
            m.close();
            neuRendern(mount);
            toast('Stand gespeichert');
          },
        }, 'Speichern'),
      ],
    });
  }

  function neuRendern(mount) {
    mount.innerHTML = '';
    renderStaende(mount);
  }

  IM.views.renderStaende = renderStaende;
})();

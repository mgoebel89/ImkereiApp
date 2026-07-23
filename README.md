# Imkereiverwaltung

Verwaltungssoftware für die Imkerei, betrieben als LXC-Container auf Proxmox.
Installation über ein einziges Kommando, Aktualisierung über Git.

Die App ist von vornherein für **Handy und Desktop** gebaut: erfasst wird am
Bienenstand auf dem Telefon, ausgewertet wird daheim am Rechner.

---

## Inhalt

- [Installation](#installation)
- [Aktualisieren](#aktualisieren)
- [Sicherung und Wiederherstellung](#sicherung-und-wiederherstellung)
- [Module](#module)
  - [Bienenstöcke](#modul-bienenstöcke)
  - [Honig](#modul-honig-geplant)
  - [Lager](#modul-lager-geplant)
  - [Bienenkasse](#modul-bienenkasse-geplant)
- [Architektur](#architektur)
- [Entwicklung](#entwicklung)

---

## Installation

Auf dem **Proxmox-Host** als root:

```bash
bash -c "$(wget -qO- https://raw.githubusercontent.com/mgoebel89/ImkereiApp/master/deploy/proxmox-install.sh)"
```

Das Skript legt einen unprivilegierten Debian-12-Container an, installiert Node,
nginx und die App, richtet einen systemd-Dienst ein und erzeugt ein
selbstsigniertes TLS-Zertifikat.

Konfigurierbar über Umgebungsvariablen:

```bash
CTID=220 HOSTNAME=imkerei BRIDGE=vmbr0 IPV4=192.168.1.60/24 GATEWAY=192.168.1.1 \
  bash -c "$(wget -qO- https://raw.githubusercontent.com/mgoebel89/ImkereiApp/master/deploy/proxmox-install.sh)"
```

| Variable | Vorgabe | Bedeutung |
|---|---|---|
| `CTID` | nächste freie | Container-ID |
| `HOSTNAME` | `imkerei` | Hostname |
| `STORAGE` | `local-lvm` | Storage für das Volume |
| `DISK_GB` | `8` | Plattengröße (Fotos brauchen Platz) |
| `MEMORY_MB` | `512` | Arbeitsspeicher |
| `IPV4` | `dhcp` | statisch z. B. `192.168.1.60/24` |
| `GATEWAY` | — | Pflicht bei statischer IP |
| `HTTP_PORT` | `80` | leitet nur auf HTTPS um |
| `HTTPS_PORT` | `443` | hier läuft die App |

### Warum HTTPS Pflicht ist

Browser geben Kamera und Barcode-Scanner nur in einem *secure context* frei.
Über `http://<IP>` bleibt die Kamera am Handy stumm — Fotos an der Stockkarte und
der geplante Barcode-Scan fürs Lager funktionieren dann nicht. Deshalb erzeugt
der Installer ein selbstsigniertes Zertifikat und leitet HTTP auf HTTPS um.

Beim ersten Aufruf warnt der Browser einmal; die Ausnahme muss bestätigt werden.
Der Container ist ohnehin nur über den VPN-Tunnel im privaten Netz erreichbar.

### Keine Nutzerverwaltung

Bewusst nicht vorhanden. Der Container läuft in einem abgetrennten privaten Netz,
das nur per VPN erreichbar ist; weitere Nutzer sind nicht vorgesehen. Zugänge zu
Paperless, Homebox und NocoDB liegen serverseitig und werden nie an den Browser
ausgeliefert.

---

## Aktualisieren

In der Container-Konsole:

```bash
update
```

Oder vom Proxmox-Host:

```bash
pct exec <CTID> -- update
```

Das Skript holt den aktuellen Stand aus Git, installiert bei Bedarf neue
Backend-Abhängigkeiten und übernimmt geänderte nginx- und systemd-Konfiguration.
Die gewählten Ports bleiben dabei erhalten.

---

## Sicherung und Wiederherstellung

Es gibt zwei voneinander unabhängige Wege:

**1. Lokal im Container.** Täglich um 03:30 sichert `imkerei-backup` die
SQLite-Datenbank (WAL-sicher über die SQLite-Backup-API) und die Fotos nach
`/var/backups/imkerei`; Sicherungen älter als 30 Tage werden gelöscht. Manuell:

```bash
imkerei-backup
```

**2. Extern nach NocoDB.** Die App sichert jede Änderung automatisch in eine
NocoDB-Base (Einstellungen → Daten & Sicherung). Jede Tabelle führt neben
lesbaren Spalten eine **`Payload`-Spalte mit dem vollständigen Datensatz als
JSON** — daraus stellt sich die App vollständig wieder her. Die lesbaren Spalten
sind für die Auswertung in NocoDB gedacht, die Payload-Spalte für die
Wiederherstellung.

- **Verbindung testen** — prüft Server, Token und Base und zieht die Tabellen-IDs nach.
- **Schema initialisieren** — legt fehlende Tabellen und Spalten an (bestehende Daten bleiben unangetastet).
- **Jetzt sichern** — stößt den Sync sofort an; sonst läuft er automatisch alle 60 Sekunden.
- **Aus NocoDB wiederherstellen** — ergänzt fehlende Datensätze. Bei gleicher ID
  gewinnt immer der lokale Stand: es wird ergänzt, nie überschrieben.

Der Sync ist bewusst einseitig (App → NocoDB). NocoDB ist die Sicherung, nicht die
führende Quelle.

Fotos laufen **nicht** über NocoDB — sie liegen als Dateien im Container und
werden über das lokale Backup gesichert.

---

## Module

### Modul Bienenstöcke

Umgesetzt. Umfasst Stände, Völker mit Stockkarte, Behandlungen und Fütterungen.

**Stände** — Aufstellungsorte mit Adresse und optionalen Koordinaten. Jede
Standkachel zeigt, wie viele Völker dort stehen und wie viele davon überfällig
sind.

**Völker** — Stammdaten (Nummer, Herkunft, Beutentyp, Rähmchenmaß) und die
Königin. Der Jahrgang der Königin ergibt automatisch die internationale
Zeichenfarbe (weiß, gelb, rot, grün, blau im Fünfjahreszyklus); der farbige Punkt
an jeder Volkskachel beantwortet die Frage nach dem Alter auf einen Blick. Ab drei
Jahren weist die App aufs Umweiseln hin. **Umweiseln** legt die bisherige Königin
in der Historie des Volkes ab, statt sie zu überschreiben.

**Stockkarte** — je Volk eine Reihe von Durchsichten mit Volksstärke, besetzten
Wabengassen, Brutbild, Stiften, Weiselzellen, Sanftmut, Wabensitz, Zargen- und
Wabenzahlen, Futtereinschätzung, Stimmung, durchgeführten Arbeiten (Mehrfachauswahl
aus 16 Standardhandgriffen), Notiz und Fotos. Beim Anlegen werden Zargen- und
Wabenzahl aus der letzten Durchsicht vorbelegt. Alle Skalen laufen 1–5 und sind
gleich gerichtet: 5 ist immer gut.

**Standortwechsel** — Wanderungen mit Datum und Zielstand; der aktuelle Standort
ergibt sich aus dem jüngsten Eintrag.

**Behandlungen und Diagnosen** — eigene Datensätze mit einer Liste betroffener
Völker, weil eine Behandlung in der Praxis den ganzen Stand trifft. Ein Stand wird
gewählt, „alle auswählen" gedrückt, Einzelne abgewählt.

- *Varroa-Diagnose*: Methode, gefundene Milben, Zähltage. Der Fall je Tag wird
  berechnet und gegen die übliche Schwelle geampelt (Sommer 10/Tag, sonst 5/Tag).
  Das ist eine grobe Orientierung, keine Diagnose.
- *Arzneimittel-Anwendung*: Präparat, Wirkstoff, Chargennummer, Menge,
  Anwendungsart, Wartezeit, Anwender. Die Auswahl eines Präparats belegt Wirkstoff
  und Wartezeit vor. Läuft eine Wartezeit, zeigt die App das am Volk und auf der
  Übersicht an — bis dahin darf nicht geerntet werden.

**Fütterungen** — Futterart, Menge je Volk, Anlass; die Gesamtmenge über alle
gefütterten Völker wird laufend mitgerechnet.

**PDF-Ausgaben**

- *Stockkarte* — ein Dokument je Volk und Saison. Stammdaten, Königin,
  Standortwechsel, alle Durchsichten **aufsteigend** (eine ausgedruckte Karte liest
  man durch die Saison, am Bildschirm steht die jüngste oben), dazu Behandlungen
  und Fütterungen des Jahres mit Futtersumme. Gibt es mehrere Saisons, fragt die
  App, welche gedruckt werden soll.
- *Bestandsbuch* — Nachweis der Tierarzneimittel-Anwendungen eines Jahrgangs im
  Querformat: Datum, Stand, Anzahl behandelter Völker, Arzneimittel und Wirkstoff,
  Charge, Menge, Anwendungsart, Wartezeit und Anwender, dazu die behandelten Völker
  im Einzelnen und die Diagnosen des Jahres. Kopf und Registriernummer stammen aus
  den Einstellungen.

  Das ist ein Ausgabeformat für die erfassten Daten, kein Rechtsdokument-Generator
  — was das Veterinäramt konkret verlangt, entscheidet das Amt.

### Modul Honig (geplant)

Rückverfolgbarkeit in drei Stufen:

1. **Ernte** je Volk oder Stand mit Datum, Tracht, Menge und Wassergehalt.
2. **Lagergebinde** (Hobbock) mit eigener Nummer, gespeist aus einer oder mehreren
   Ernten — damit ist Verschnitt abbildbar.
3. **Abfüllcharge** mit Losnummer, MHD, Glasgröße und Stückzahl.

Von jedem Glas führt der Weg rückwärts bis zum Volk. Die Wartezeiten aus dem
Behandlungsmodul sperren die Ernte betroffener Völker.

### Modul Lager (geplant)

Fassade auf eine bestehende **Homebox**-Instanz über einen Backend-Proxy —
Homebox bleibt die führende Quelle, es gibt keine lokale Kopie und damit keine
Sync-Konflikte. Artikel suchen, anlegen, bearbeiten, Bestand ändern; jeder Artikel
mit Hersteller-Barcode, erfasst per Handykamera (`BarcodeDetector` mit ZXing als
Rückfallebene).

Einzige modulübergreifende Buchung: eine Abfüllcharge reduziert nach Rückfrage den
Bestand der verwendeten Gläser.

### Modul Bienenkasse (geplant)

Einnahmen-Überschuss-Rechnung für Kleinunternehmer (ohne Umsatzsteuer):
Kategorien, Zahlungsart, Jahresübersicht, PDF- und CSV-Ausgabe. Belege lassen sich
mit **Paperless-ngx** verknüpfen oder direkt dorthin hochladen — dieselbe Instanz
wie die Gemeindeverwaltung, getrennt über eigene Tags.

---

## Architektur

```
ImkereiApp/
├── deploy/           Installer, systemd-Unit, nginx-Site, Update, Backup
├── backend/          Node/Express + better-sqlite3 + WebSocket
│   ├── server.js     Routen-Montage, Snapshot, WebSocket-Broadcast
│   ├── db.js         Payload-Store je Entität, Datei-Anhänge
│   └── routes/       ein Router je Modul
└── app/              Frontend ohne Build-Schritt
    ├── index.html    lädt die Skripte in fester Reihenfolge
    ├── styles.css
    ├── vendor/       jsPDF (offline, der Container hat kein Internet)
    └── src/
        ├── models.js         fachliches Datenmodell und Berechnungen
        ├── api.js            HTTP + WebSocket zum Backend
        ├── store.js          Cache, optimistisches Speichern, Sync-Zustand
        ├── ui/components.js  Formular- und Layout-Bausteine
        ├── integrations/     NocoDB-Client, Auto-Sync
        ├── export/           PDF-Bauer
        ├── views/            eine Datei je Bildschirm
        └── app.js            Navigation, Router, Start
```

**Payload-Store.** Jede Entität liegt als ein JSON-Payload in einer schmalen
Tabelle (`id`, `payload`, `last_modified`). Neue Felder brauchen keine Migration,
und der NocoDB-Sync bekommt seine Payload-Spalte geschenkt. Fotos liegen dagegen
als Dateien auf der Platte plus Zeile in `volk_files` — sonst würde jeder Sync die
Bilder mitschleppen.

**Optimistisches Speichern.** Eingaben landen sofort im Cache und gehen parallel
ans Backend; am Bienenstand soll niemand auf das Netz warten. Schlägt der
Schreibvorgang fehl, erscheint eine Meldung.

**WebSocket.** Änderungen werden an alle offenen Geräte verteilt (Handy am Stand ↔
Rechner daheim). Eigene Echos werden anhand einer Client-Kennung verworfen, damit
beim Tippen nicht neu gerendert wird.

**Namespace `IM`.** Klassische Skripte ohne Build-Schritt, alles unter `window.IM`.
Die Ladereihenfolge in `index.html` ist deshalb bedeutsam.

**Ein neues Modul** braucht: Tabelle in `db.js`, Router in `backend/routes/`,
Eintrag im Snapshot, Cache-Feld und Zugriffsmethoden in `store.js`, einen Eintrag
in der `MODULE`-Registry von `nocodb-client.js` samt Row-Builder, eine View und
einen Eintrag in `NAV` in `app.js`.

### Datumsfalle

Kalenderdaten werden **nie** über `toISOString()` gebildet. Das rechnet nach UTC
und schiebt in unserer Zeitzone die lokale Mitternacht auf den Vortag. Immer
`IM.models.dateToIso()` verwenden, das über die lokalen Komponenten geht.

---

## Entwicklung

Das Frontend braucht keinen Build-Schritt und läuft gegen einen einfachen
statischen Server:

```bash
python -m http.server 8201 --directory ImkereiApp/app
```

Ohne Backend zeigt die App ein Warnbanner; der Cache funktioniert weiter, sodass
sich alle Ansichten mit Testdaten bedienen lassen.

Das Backend braucht Node ≥ 20 und `better-sqlite3` (native Erweiterung), lässt
sich also nur dort starten, wo beides vorhanden ist — in der Regel direkt im
Container.

---

## Lizenz

Siehe [LICENSE](LICENSE).

#!/usr/bin/env bash
# Richtet die Imkereiverwaltung INNERHALB des Containers ein.
#
# Wird vom proxmox-install.sh aufgerufen, lässt sich aber auch von Hand
# ausführen, um eine halb fertige oder kaputte Installation zu reparieren —
# alle Schritte sind wiederholbar (idempotent):
#
#   In der Container-Konsole:   imkerei-setup
#   Vom Proxmox-Host:           pct exec <CTID> -- imkerei-setup
#
# Frisch aus dem Netz (wenn noch gar nichts installiert ist):
#   bash -c "$(wget -qO- https://raw.githubusercontent.com/mgoebel89/ImkereiApp/master/deploy/container-setup.sh)"

set -euo pipefail

: "${REPO_URL:=https://github.com/mgoebel89/ImkereiApp.git}"
: "${REPO_BRANCH:=master}"
: "${APP_DIR:=/opt/imkerei}"
: "${DATA_DIR:=/var/lib/imkerei}"
: "${HTTP_PORT:=80}"
: "${HTTPS_PORT:=443}"
: "${CERT_HOST:=$(hostname)}"

log()  { printf '\033[1;34m[*]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[✓]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }

# Bei einem Abbruch klar sagen, WO es hakte — sonst steht man wie beim ersten
# Versuch vor einer nginx-Standardseite und rät.
schritt='Start'
trap 'err "Abgebrochen bei: ${schritt}"; err "Details oben. Nach dem Beheben einfach erneut ausführen — das Skript ist wiederholbar."' ERR

if [[ $EUID -ne 0 ]]; then err "Bitte als root im Container ausführen."; exit 1; fi

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- Pakete ----
schritt='Pakete installieren'
log "$schritt…"
apt-get update -qq
# build-essential und python3 sind der Rückfallweg für better-sqlite3: gibt es
# für die Node-Version kein fertiges Binary, wird die Erweiterung übersetzt.
apt-get install -y -qq nginx git ca-certificates curl sqlite3 cron openssl \
  build-essential python3 >/dev/null
ok "Pakete da."

schritt='Node.js installieren'
if ! command -v node >/dev/null 2>&1; then
  log "$schritt (20.x via NodeSource)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node --version)"

# ------------------------------------------------------------------ Repo ----
schritt='Repository holen'
mkdir -p "$DATA_DIR" /var/backups/imkerei
if [[ -d "$APP_DIR/.git" ]]; then
  log "Repo vorhanden — aktualisiere…"
  git -C "$APP_DIR" fetch --depth=1 origin "$REPO_BRANCH"
  git -C "$APP_DIR" reset --hard "origin/${REPO_BRANCH}"
else
  log "Klone ${REPO_URL} (${REPO_BRANCH})…"
  rm -rf "$APP_DIR"
  git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi
ok "Stand: $(git -C "$APP_DIR" log -1 --pretty=format:'%h %s')"

# --------------------------------------------------------------- Backend ----
schritt='Backend-Abhängigkeiten installieren (better-sqlite3 kann übersetzt werden, das dauert)'
log "$schritt…"
(cd "$APP_DIR/backend" && npm install --omit=dev --no-audit --no-fund)
ok "Abhängigkeiten installiert."

schritt='Backend-Dienst einrichten'
cp "$APP_DIR/deploy/backend.service" /etc/systemd/system/imkerei-backend.service
systemctl daemon-reload
systemctl enable imkerei-backend >/dev/null 2>&1
systemctl restart imkerei-backend
# Kurz Luft lassen und dann wirklich nachsehen — `systemctl enable --now` meldet
# auch dann Erfolg, wenn der Dienst gleich darauf wieder aussteigt.
sleep 2
if ! systemctl is-active --quiet imkerei-backend; then
  err "Backend läuft nicht. Letzte Zeilen aus dem Journal:"
  journalctl -u imkerei-backend -n 30 --no-pager >&2 || true
  exit 1
fi
ok "Backend läuft."

# ------------------------------------------------------------ Zertifikat ----
schritt='TLS-Zertifikat erzeugen'
install -d -m 0700 /etc/ssl/imkerei
if [[ ! -f /etc/ssl/imkerei/server.crt ]]; then
  IPADDR=$(hostname -I | awk '{print $1}')
  log "Erzeuge selbstsigniertes Zertifikat für ${CERT_HOST} / ${IPADDR}…"
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout /etc/ssl/imkerei/server.key \
    -out /etc/ssl/imkerei/server.crt \
    -subj "/CN=${CERT_HOST}" \
    -addext "subjectAltName=DNS:${CERT_HOST},DNS:localhost,IP:${IPADDR},IP:127.0.0.1" >/dev/null 2>&1
  chmod 0600 /etc/ssl/imkerei/server.key
fi
ok "Zertifikat vorhanden."

# ----------------------------------------------------------------- nginx ----
schritt='nginx konfigurieren'
install -d /var/www
ln -sfn "$APP_DIR/app" /var/www/imkerei

if [[ "$HTTPS_PORT" == "443" ]]; then HTTPS_SUFFIX=""; else HTTPS_SUFFIX=":${HTTPS_PORT}"; fi
sed -e "s/__HTTP_PORT__/${HTTP_PORT}/g" \
    -e "s/__HTTPS_PORT__/${HTTPS_PORT}/g" \
    -e "s/__HTTPS_SUFFIX__/${HTTPS_SUFFIX}/g" \
    "$APP_DIR/deploy/nginx-site.conf" > /etc/nginx/sites-available/imkerei
ln -sfn /etc/nginx/sites-available/imkerei /etc/nginx/sites-enabled/imkerei

# Erst prüfen, DANN die Standard-Site entfernen. Andersherum hinterlässt ein
# Konfigurationsfehler einen Container, der weiter die nginx-Startseite zeigt.
schritt='nginx-Konfiguration prüfen'
if ! nginx -t; then
  err "nginx-Konfiguration fehlerhaft — Standard-Site bleibt aktiv, damit der Container erreichbar bleibt."
  exit 1
fi
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null 2>&1
systemctl reload nginx || systemctl restart nginx
ok "nginx konfiguriert."

# ------------------------------------------------------ Hilfsskripte/Cron ----
schritt='Hilfsskripte einrichten'
install -m 0755 "$APP_DIR/deploy/update.sh" /usr/local/bin/imkerei-update
install -m 0755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/imkerei-backup
install -m 0755 "$APP_DIR/deploy/container-setup.sh" /usr/local/bin/imkerei-setup
ln -sfn /usr/local/bin/imkerei-update /usr/local/bin/update
printf 'Imkereiverwaltung\n  App aktualisieren:  update\n  Backup jetzt:       imkerei-backup\n  Einrichtung neu:    imkerei-setup\n' > /etc/motd

echo '30 3 * * * root /usr/local/bin/imkerei-backup >/var/log/imkerei-backup.log 2>&1' > /etc/cron.d/imkerei-backup
chmod 0644 /etc/cron.d/imkerei-backup
systemctl enable --now cron >/dev/null 2>&1 || true
ok "Hilfsskripte eingerichtet."

# -------------------------------------------------------------- Abnahme ----
schritt='Installation prüfen'
FEHLER=0

if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
  ok "Backend antwortet auf /api/health."
else
  err "Backend antwortet NICHT auf /api/health."; FEHLER=1
fi

if curl -fsSk "https://127.0.0.1:${HTTPS_PORT}/api/health" >/dev/null 2>&1; then
  ok "nginx reicht /api/ ans Backend durch."
else
  err "nginx erreicht das Backend nicht über HTTPS."; FEHLER=1
fi

if curl -fsSk "https://127.0.0.1:${HTTPS_PORT}/" 2>/dev/null | grep -q 'Imkereiverwaltung'; then
  ok "Oberfläche wird ausgeliefert."
else
  err "Statt der App kommt etwas anderes (vermutlich noch die nginx-Startseite)."; FEHLER=1
fi

trap - ERR
if [[ "$FEHLER" -ne 0 ]]; then
  err "Einrichtung unvollständig — siehe Meldungen oben."
  exit 1
fi

IPADDR=$(hostname -I | awk '{print $1}')
if [[ "$HTTPS_PORT" == "443" ]]; then SUFFIX=""; else SUFFIX=":${HTTPS_PORT}"; fi
echo
ok "Einrichtung abgeschlossen."
echo "   URL: https://${IPADDR}${SUFFIX}"
echo "   Das Zertifikat ist selbstsigniert — die Browserwarnung einmal je Gerät bestätigen."

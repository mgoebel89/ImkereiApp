#!/usr/bin/env bash
# Aktualisiert die App im Container: zieht den aktuellen Stand aus Git,
# installiert ggf. neue Backend-Dependencies, übernimmt nginx-Config und
# reloadet Backend + nginx.
#
# Aufruf in der Container-Konsole:  update
# Oder vom Proxmox-Host:            pct exec <CTID> -- update

set -euo pipefail

REPO_DIR="/opt/imkerei"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Repo nicht gefunden unter $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"
git fetch --depth=1 origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git reset --hard "origin/${BRANCH}"

# Backend-Abhängigkeiten installieren, falls package.json sich geändert hat
if [[ -f backend/package.json ]]; then
  if [[ ! -d backend/node_modules ]] || ! diff -q backend/package.json backend/node_modules/.package.json.last >/dev/null 2>&1; then
    (cd backend && npm install --omit=dev --no-audit --no-fund)
    cp backend/package.json backend/node_modules/.package.json.last 2>/dev/null || true
  fi
  systemctl restart imkerei-backend || true
fi

# nginx-Site übernehmen, falls geändert. Die Ports werden aus der installierten
# Config übernommen, damit eine abweichende Port-Wahl beim Update erhalten bleibt.
SITE=/etc/nginx/sites-available/imkerei
if [[ -f "$SITE" ]]; then
  HTTP_PORT=$(awk '/listen / && $0 !~ /ssl/ && $2 !~ /\[/ {sub(";","",$2); print $2; exit}' "$SITE" 2>/dev/null || echo 80)
  HTTPS_PORT=$(awk '/listen / && $0 ~ /ssl/ && $2 !~ /\[/ {sub(";","",$2); print $2; exit}' "$SITE" 2>/dev/null || echo 443)
  [[ -z "$HTTP_PORT" ]] && HTTP_PORT=80
  [[ -z "$HTTPS_PORT" ]] && HTTPS_PORT=443
  if [[ "$HTTPS_PORT" == "443" ]]; then HTTPS_SUFFIX=""; else HTTPS_SUFFIX=":${HTTPS_PORT}"; fi
  TMP=$(mktemp)
  sed -e "s/__HTTP_PORT__/${HTTP_PORT}/g" \
      -e "s/__HTTPS_PORT__/${HTTPS_PORT}/g" \
      -e "s/__HTTPS_SUFFIX__/${HTTPS_SUFFIX}/g" deploy/nginx-site.conf > "$TMP"
  if ! diff -q "$TMP" "$SITE" >/dev/null 2>&1; then
    cp "$TMP" "$SITE"
    nginx -t && systemctl reload nginx
  fi
  rm -f "$TMP"
fi

# systemd-Unit übernehmen, falls geändert
if ! diff -q deploy/backend.service /etc/systemd/system/imkerei-backend.service >/dev/null 2>&1; then
  cp deploy/backend.service /etc/systemd/system/imkerei-backend.service
  systemctl daemon-reload
  systemctl restart imkerei-backend
fi

# Hilfsskripte aktualisieren
install -m 0755 deploy/backup.sh /usr/local/bin/imkerei-backup
install -m 0755 deploy/update.sh /usr/local/bin/imkerei-update
ln -sfn /usr/local/bin/imkerei-update /usr/local/bin/update
printf 'Imkereiverwaltung\n  App aktualisieren:  update\n  Backup jetzt:       imkerei-backup\n' > /etc/motd

echo "Update abgeschlossen: $(git log -1 --pretty=format:'%h %s')"

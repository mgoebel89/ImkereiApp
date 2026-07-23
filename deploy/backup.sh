#!/usr/bin/env bash
# Sichert die SQLite-Datenbank und die Foto-Anhänge der Imkereiverwaltung.
# Läuft täglich per cron (siehe proxmox-install.sh) und lässt sich jederzeit
# von Hand aufrufen:  imkerei-backup
#
# Das ist die LOKALE Sicherung. Die zusätzliche externe Sicherung nach NocoDB
# macht die App selbst (Auto-Sync), unabhängig hiervon.

set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/imkerei}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/imkerei}"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)

# Konsistente DB-Kopie (WAL-sicher) über die SQLite-Backup-API
if [[ -f "$DATA_DIR/data.db" ]]; then
  sqlite3 "$DATA_DIR/data.db" ".backup '$BACKUP_DIR/data-$STAMP.db'"
  gzip -f "$BACKUP_DIR/data-$STAMP.db"
fi

# Fotos/Anhänge
if [[ -d "$DATA_DIR/attachments" ]]; then
  tar -czf "$BACKUP_DIR/attachments-$STAMP.tar.gz" -C "$DATA_DIR" attachments
fi

# Alte Sicherungen aufräumen
find "$BACKUP_DIR" -type f -name '*.gz' -mtime "+$KEEP_DAYS" -delete

echo "Backup abgeschlossen: $BACKUP_DIR (Stand $STAMP)"

#!/bin/bash
# Otomatik veritabanı yedekleme - Linux/Mac cron için
# Kullanım: chmod +x scripts/schedule-backup.sh
# Cron: Her gece 02:00 için: 0 2 * * * cd /path/to/futbol-okulu && ./scripts/schedule-backup.sh
cd "$(dirname "$0")/.."
node scripts/backup-db.js

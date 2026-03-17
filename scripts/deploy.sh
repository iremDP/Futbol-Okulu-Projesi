#!/bin/bash
# Deploy script - Linux/Mac
# Uygulamayı günceller ve yeniden başlatır
# Kullanım: ./scripts/deploy.sh

set -e
cd "$(dirname "$0")/.."

echo "=== Futbol Okulu Deploy ==="

# 1. Git'ten son kodu çek (git varsa)
if [ -d .git ]; then
  echo "[1/4] Git pull..."
  git pull
else
  echo "[1/4] Git yok, atlanıyor"
fi

# 2. Bağımlılıkları kur
echo "[2/4] npm install..."
npm install --production

# 3. Migration (PostgreSQL kullanıyorsanız)
if [ -n "$DATABASE_URL" ] && [ "$USE_SQLITE" != "true" ]; then
  echo "[3/4] Migration kontrolü..."
  npm run migrate 2>/dev/null || true
else
  echo "[3/4] SQLite - migration atlanıyor"
fi

# 4. Uygulamayı yeniden başlat
echo "[4/4] PM2 restart..."
if command -v pm2 &>/dev/null; then
  pm2 restart futbol-okulu 2>/dev/null || pm2 start ecosystem.config.cjs --env production
  echo "✅ Deploy tamamlandı. pm2 status ile kontrol edin."
else
  echo "⚠ PM2 yok. Manuel: npm start veya node index.js"
fi

# Deploy Kılavuzu

## Deploy Script Nedir?

Deploy script, uygulamayı sunucuya veya production ortamına **tek komutla** güncellemek için kullanılır. Şunları yapar:

1. **Git pull** – Son kodu çeker
2. **npm install** – Bağımlılıkları kurar
3. **Migration** – Veritabanı değişikliklerini uygular (PostgreSQL)
4. **Restart** – Uygulamayı yeniden başlatır (PM2 ile)

## Kullanım

### Linux / Mac
```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

### Windows (PowerShell)
```powershell
.\scripts\deploy.ps1
```

## Ön Gereksinimler

- Node.js kurulu
- `.env` dosyası yapılandırılmış
- PM2 (opsiyonel, production için önerilir): `npm install -g pm2`

## Manuel Deploy

Script kullanmadan:
```bash
git pull
npm install --production
npm run migrate   # PostgreSQL kullanıyorsanız
pm2 restart futbol-okulu   # veya npm start
```

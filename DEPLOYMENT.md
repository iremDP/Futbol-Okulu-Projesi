# Futbol Okulu - Yayına Alma Rehberi

## Ortam Değişkenleri (Production)

`.env` dosyasında mutlaka ayarlayın:

| Değişken | Açıklama |
|----------|----------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | En az 32 karakter, güçlü rastgele değer |
| `CORS_ORIGIN` | İzin verilen frontend URL(ler), virgülle ayrılmış |
| `PORT` | Sunucu portu (varsayılan: 3000) |

PostgreSQL kullanıyorsanız: `DATABASE_URL`

## Başlatma

```bash
# Geliştirme
npm start

# Production (PM2 ile)
npm run pm2:prod
```

## Veritabanı Yedekleme

```bash
npm run backup
```

Yedekler `backups/` klasörüne kaydedilir. Cron ile günlük yedek önerilir.

## Güvenlik Kontrol Listesi

- [ ] JWT_SECRET güçlü ve benzersiz
- [ ] CORS_ORIGIN sadece güvenilen domain(ler)
- [ ] HTTPS (reverse proxy: nginx, Caddy vb.)
- [ ] Düzenli veritabanı yedekleme

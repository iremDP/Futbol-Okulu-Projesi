# Futbol Okulu - Production Yayın Öncesi Kontrol Listesi

**Son güncelleme:** Mart 2026

Bu liste, uygulamayı online açmadan önce tamamlanması gereken adımları içerir.

---

## 1. Ortam Değişkenleri (.env)

| Kontrol | Açıklama | Durum |
|---------|----------|-------|
| `JWT_SECRET` | En az 32 karakter, güçlü rastgele değer. Örn: `openssl rand -base64 32` | ☐ |
| `NODE_ENV=production` | Production modu aktif | ☐ |
| `CORS_ORIGIN` | Kendi domain'iniz (virgülle ayırın). Örn: `https://futbolokulu.com,https://www.futbolokulu.com` | ☐ |
| `PORT` | Sunucu portu (varsayılan: 3000) | ☐ |

### Opsiyonel (önerilir)

| Değişken | Açıklama |
|----------|----------|
| `JWT_EXPIRES` | Token süresi (varsayılan: 1d) |
| `DATABASE_URL` | PostgreSQL bağlantı dizesi (yüksek trafik için) |
| `SMTP_*` | E-posta gönderimi (makbuz için) |
| `NETGSM_*` | SMS gönderimi (makbuz için) |

---

## 2. Güvenlik Kontrolleri

| Kontrol | Açıklama |
|---------|----------|
| ☐ | Admin şifresi varsayılandan değiştirildi |
| ☐ | `.env` dosyası Git'e eklenmedi (.gitignore'da) |
| ☐ | `futbol-okulu.db` (SQLite) yedeklendi ve güvenli yerde |
| ☐ | HTTPS kullanılıyor (reverse proxy: nginx, Caddy vb.) |

---

## 3. Sunucu / Hosting

| Kontrol | Açıklama |
|---------|----------|
| ☐ | Node.js 18+ yüklü |
| ☐ | `npm install` çalıştırıldı |
| ☐ | Process manager (PM2, systemd) ile otomatik yeniden başlatma ayarlandı |
| ☐ | Firewall: sadece 80, 443 (ve gerekirse 3000) açık |

---

## 4. HTTPS (Zorunlu)

Production'da **mutlaka** HTTPS kullanın. Öneriler:

- **Nginx reverse proxy:** SSL sertifikası (Let's Encrypt ücretsiz)
- **Caddy:** Otomatik HTTPS
- **Railway / Render / Vercel:** Kendi SSL'leri var

---

## 5. İlk Çalıştırma Sonrası

| Kontrol | Açıklama |
|---------|----------|
| ☐ | Admin hesabıyla giriş yapıldı |
| ☐ | Şube oluşturuldu |
| ☐ | Test kullanıcısı (antrenör/veli) oluşturuldu |
| ☐ | Veli paneli test edildi |

---

## 6. Yedekleme

| Kontrol | Açıklama |
|---------|----------|
| ☐ | SQLite: `futbol-okulu.db` düzenli yedekleniyor |
| ☐ | PostgreSQL: `pg_dump` ile yedekleme planlandı |

---

## Hızlı Başlatma Komutu

```bash
# .env dosyasını oluştur (örn: .env.example'dan kopyala)
cp .env.example .env
# Düzenle: JWT_SECRET, CORS_ORIGIN, NODE_ENV=production

# Başlat
npm start
```

---

## Sorun Giderme

- **401 Unauthorized:** Token süresi dolmuş veya geçersiz. Yeniden giriş yapın.
- **CORS hatası:** `CORS_ORIGIN`'de domain tam ve doğru yazılmış mı?
- **Veritabanı hatası:** SQLite için yazma izni var mı? PostgreSQL için bağlantı dizesi doğru mu?

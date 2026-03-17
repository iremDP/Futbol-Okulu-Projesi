# PostgreSQL Sorun Giderme

## Veriler görünmüyor / Site takılıyor

### 1. Veritabanını kontrol edin

```bash
npm run pg:verify
```

Çıktıda kayıt sayıları görünmeli (subeler: 3, students: 71, vb.). 0 ise veri yok.

### 2. Migrate'i yeniden çalıştırın

**ÖNEMLİ:** Önce sunucuyu durdurun (Ctrl+C).

```bash
# 1. Veritabanı var mı?
npm run pg:setup

# 2. Verileri SQLite'dan taşı
npm run migrate

# 3. Kontrol et
npm run pg:verify

# 4. Sunucuyu başlat
npm start
```

### 3. futbol-okulu.db dosyası

Migrate, proje kökündeki `futbol-okulu.db` dosyasından okur. Dosya yoksa veya boşsa veri taşınamaz.

### 4. Site takılıyorsa

- Tarayıcıda F12 > Network sekmesi: Hangi istek takılıyor?
- Sunucu konsolunda hata var mı?
- `http://localhost:3000/api/health?db=1` adresine gidin – db bilgisi geliyor mu?

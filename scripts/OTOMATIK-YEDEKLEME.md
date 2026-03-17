# Otomatik Yedekleme Kurulumu

## Linux / Mac (cron)

1. Script'i çalıştırılabilir yapın:
   ```bash
   chmod +x scripts/schedule-backup.sh
   ```

2. Crontab'ı düzenleyin:
   ```bash
   crontab -e
   ```

3. Her gece 02:00'de yedek almak için ekleyin:
   ```
   0 2 * * * cd /tam/yol/futbol-okulu && ./scripts/schedule-backup.sh >> /var/log/futbol-backup.log 2>&1
   ```

## Windows (Görev Zamanlayıcı)

1. **Görev Zamanlayıcı**'yı açın (taskschd.msc)
2. **Temel Görev Oluştur** → İsim: "Futbol Okulu Yedek"
3. Tetikleyici: **Günlük**, Saat: **02:00**
4. Eylem: **Program başlat**
5. Program: `node`
6. Bağımsız değişkenler: `scripts\backup-db.js`
7. Başlangıç konumu: Proje klasörünün tam yolu (örn: `C:\Users\...\Futbol Okulu`)

Alternatif: `scripts\schedule-backup.bat` dosyasını doğrudan çalıştırabilirsiniz.

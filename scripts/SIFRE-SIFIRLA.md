# PostgreSQL Şifre Sıfırlama

PostgreSQL kurulumunda belirlediğiniz şifreyi unuttuysanız:

## Yöntem 1: Otomatik (Yönetici gerekli)

PowerShell'i **Yönetici olarak** açın ve çalıştırın:

```powershell
cd "c:\Users\devra\OneDrive\Masaüstü\Futbol Okulu"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\reset-pg-password.ps1
```

Bu script postgres şifresini `futbol2026` olarak ayarlar.

## Yöntem 2: Manuel

1. **pg_hba.conf** dosyasını açın (Notepad'i Yönetici olarak açın):
   ```
   C:\Program Files\PostgreSQL\18\data\pg_hba.conf
   (veya 16: ...\PostgreSQL\16\data\pg_hba.conf)
   ```

2. Şu satırları bulun:
   ```
   host    all    all    127.0.0.1/32    scram-sha-256
   host    all    all    ::1/128         scram-sha-256
   ```

3. Son sütunu `trust` yapın:
   ```
   host    all    all    127.0.0.1/32    trust
   host    all    all    ::1/128         trust
   ```

4. Kaydedin. **Services** (services.msc) > **postgresql** > Sağ tık > **Restart**

5. Bu proje klasöründe:
   ```bash
   node scripts/set-pg-password.js
   ```

6. pg_hba.conf'u tekrar `scram-sha-256` yapıp kaydedin, servisi yeniden başlatın.

## Sonra

```bash
npm run pg:setup
npm start
```

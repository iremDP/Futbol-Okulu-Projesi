@echo off
REM Otomatik veritabanı yedekleme - Windows Task Scheduler için
REM Görev Zamanlayıcı'da bu dosyayı günlük çalıştırın (örn: 02:00)
cd /d "%~dp0.."
node scripts\backup-db.js

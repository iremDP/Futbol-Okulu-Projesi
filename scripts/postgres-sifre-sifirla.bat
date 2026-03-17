@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================
echo  PostgreSQL Sifre Sifirlama
echo ============================================
echo.
echo Yonetici izni istenecek - Evet deyin.
echo.
powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File','%~dp0reset-pg-password.ps1' -WorkingDirectory '%~dp0..'"
echo.
echo Pencere kapandi. npm run pg:setup calistirin.
pause

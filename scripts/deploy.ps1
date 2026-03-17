# Deploy script - Windows PowerShell
# Uygulamayı günceller ve yeniden başlatır
# Kullanım: .\scripts\deploy.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "=== Futbol Okulu Deploy ===" -ForegroundColor Cyan

# 1. Git'ten son kodu çek
if (Test-Path .git) {
    Write-Host "[1/4] Git pull..." -ForegroundColor Yellow
    git pull
} else {
    Write-Host "[1/4] Git yok, atlanıyor" -ForegroundColor Gray
}

# 2. Bağımlılıkları kur
Write-Host "[2/4] npm install..." -ForegroundColor Yellow
npm install --production

# 3. Migration (PostgreSQL)
if ($env:DATABASE_URL -and $env:USE_SQLITE -ne "true") {
    Write-Host "[3/4] Migration kontrolü..." -ForegroundColor Yellow
    try { npm run migrate 2>$null } catch { }
} else {
    Write-Host "[3/4] SQLite - migration atlanıyor" -ForegroundColor Gray
}

# 4. PM2 ile yeniden başlat (varsa)
Write-Host "[4/4] Uygulama yeniden başlatılıyor..." -ForegroundColor Yellow
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    pm2 restart futbol-okulu 2>$null
    if ($LASTEXITCODE -ne 0) {
        pm2 start ecosystem.config.cjs --env production
    }
    Write-Host "Deploy tamamlandı. pm2 status ile kontrol edin." -ForegroundColor Green
} else {
    Write-Host "PM2 yok. Manuel: npm start" -ForegroundColor Yellow
}

# PostgreSQL postgres sifresini futbol2026 olarak sifirlar
# Yonetici olarak calistirin: PowerShell > Sag tik > "Run as Administrator"

# PostgreSQL 16 veya 18 - otomatik bul
$pgDir = if (Test-Path "C:\Program Files\PostgreSQL\18") { "C:\Program Files\PostgreSQL\18" }
         elseif (Test-Path "C:\Program Files\PostgreSQL\16") { "C:\Program Files\PostgreSQL\16" }
         else { "C:\Program Files\PostgreSQL\16" }
$pgHba = "$pgDir\data\pg_hba.conf"

if (-not (Test-Path $pgHba)) {
    Write-Host "HATA: $pgHba bulunamadi" -ForegroundColor Red
    exit 1
}

# Yedek
Copy-Item $pgHba "$pgHba.bak" -Force
Write-Host "Yedek: $pgHba.bak"

# trust yap - local ve host satirlari
(Get-Content $pgHba) | ForEach-Object {
    if ($_ -match '^\s*(local|host)\s+all\s+all' -and $_ -notmatch 'trust') {
        $_ -replace '\s+(scram-sha-256|md5)\s*$', ' trust'
    } else {
        $_
    }
} | Out-File $pgHba -Encoding ASCII

# Servis yeniden baslat
Restart-Service "postgresql" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4

# Node ile sifre degistir (proje kokunde node_modules var)
$projRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projRoot
$result = node "$PSScriptRoot\do-reset-pg.js" 2>&1
Pop-Location

# Geri yukle
Copy-Item "$pgHba.bak" $pgHba -Force
Restart-Service "postgresql" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

if ($result -match 'OK') {
    Write-Host "`nBasarili! postgres sifresi: futbol2026" -ForegroundColor Green
    Write-Host "Simdi: npm run pg:setup" -ForegroundColor Cyan
} else {
    Write-Host "`nHata olustu. pg_hba.conf geri yuklendi." -ForegroundColor Red
    Write-Host $result
}

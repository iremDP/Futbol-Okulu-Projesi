#!/usr/bin/env node
/**
 * Dağıtım paketi oluşturur - .env, .git, *.db, node_modules, hassas dosyalar HARİÇ
 * Kullanım: node scripts/create-dist.js
 * Çıktı: dist/futbol-okulu-<versiyon>.zip
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';
const distDir = path.join(root, 'dist');
const zipName = `futbol-okulu-${version}.zip`;

// Hariç tutulacaklar (güvenlik + boyut)
const EXCLUDE = [
  '.env',
  '.env.*',
  '.git',
  '.gitignore',
  '*.db',
  'node_modules',
  'backups',
  'admin-initial-credentials.txt',
  '.DS_Store',
  'dist',
  '*.zip',
  '*.log',
  '.cursor'
];

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Geçici klasörde paket oluştur
const tempDir = path.join(root, '.dist-temp');
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true });
}
fs.mkdirSync(tempDir, { recursive: true });

function shouldExclude(relPath) {
  const parts = relPath.split(path.sep);
  for (const exc of EXCLUDE) {
    const pattern = exc.replace(/\*/g, '.*');
    const regex = new RegExp(`^${pattern}$`, 'i');
    if (parts.some(p => regex.test(p))) return true;
    if (relPath.includes('.env')) return true;
    if (relPath.includes('.git')) return true;
    if (relPath.endsWith('.db')) return true;
    if (relPath.includes('node_modules')) return true;
    if (relPath.includes('admin-initial-credentials')) return true;
  }
  return false;
}

function copyRecursive(src, dest, base = '') {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const relPath = path.join(base, e.name);
    if (shouldExclude(relPath)) continue;
    const destPath = path.join(dest, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath, relPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('Paket oluşturuluyor (hassas dosyalar hariç)...');
copyRecursive(root, tempDir);

// .env.example'ı .env.example olarak kopyala (kullanıcı .env oluşturabilsin)
const envExample = path.join(root, '.env.example');
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, path.join(tempDir, '.env.example'));
}

// Zip oluştur (PowerShell veya zip kullan)
const zipPath = path.join(distDir, zipName);
try {
  if (process.platform === 'win32') {
    execSync(`powershell -Command "Compress-Archive -Path '${path.join(tempDir, '*')}' -DestinationPath '${zipPath}' -Force"`, { cwd: root });
  } else {
    execSync(`cd "${tempDir}" && zip -rq "${zipPath}" . -x "*.DS_Store"`, { cwd: root });
  }
} catch (e) {
  console.warn('Zip oluşturulamadı:', e.message);
  console.warn('Lütfen dist/ klasörünü manuel sıkıştırın veya "npm install archiver" ile tekrar deneyin.');
}

// Temizlik
fs.rmSync(tempDir, { recursive: true });

console.log(`\n✅ Dağıtım paketi: ${zipPath}`);
console.log('   (.env, .git, *.db, node_modules dahil edilmedi)\n');

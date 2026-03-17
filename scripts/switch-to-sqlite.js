#!/usr/bin/env node
/**
 * PostgreSQL'den SQLite'a geçiş.
 * .env dosyasını günceller - artık futbol-okulu.db kullanılacak.
 * Kullanım: node scripts/switch-to-sqlite.js
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('HATA: .env dosyası bulunamadı');
  process.exit(1);
}

let content = fs.readFileSync(envPath, 'utf8');

// DATABASE_URL satirini yorum yap (henuz yorumlu degilse)
content = content.replace(/^([ \t]*)(DATABASE_URL=.*)$/gm, (_, indent, rest) => {
  const line = indent + rest;
  return line.trimStart().startsWith('#') ? line : indent + '# ' + rest;
});

// USE_SQLITE yoksa ekle (dosya basina), varsa true yap
if (!/USE_SQLITE=/i.test(content)) {
  content = 'USE_SQLITE=true\n\n' + content;
} else {
  content = content.replace(/USE_SQLITE=.*/i, 'USE_SQLITE=true');
}

fs.writeFileSync(envPath, content);
console.log('\n✓ SQLite\'a geçildi.');
console.log('  - USE_SQLITE=true');
console.log('  - DATABASE_URL devre dışı');
console.log('\nŞimdi: npm start');
console.log('Veriler futbol-okulu.db dosyasından okunacak.\n');

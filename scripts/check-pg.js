#!/usr/bin/env node
/**
 * PostgreSQL bağlantı teşhis script'i
 * Adım adım kontrol eder, sorunu tespit eder.
 * Kullanım: node scripts/check-pg.js  veya  npm run pg:check
 */
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');

function log(msg, type = 'info') {
  const icons = { ok: '✓', fail: '✗', warn: '!', info: '·' };
  const icon = icons[type] || icons.info;
  console.log(`  ${icon} ${msg}`);
}

function logSection(title) {
  console.log('\n' + '─'.repeat(50));
  console.log(' ' + title);
  console.log('─'.repeat(50));
}

async function main() {
  console.log('\nPostgreSQL Bağlantı Teşhisi\n');

  // 1. .env dosyası var mı?
  logSection('1. .env dosyası');
  if (!fs.existsSync(envPath)) {
    log('.env dosyası bulunamadı!', 'fail');
    console.log('\n  Çözüm: copy .env.example .env');
    console.log('  Sonra .env içinde DATABASE_URL ve JWT_SECRET ayarlayın.\n');
    process.exit(1);
  }
  log('.env dosyası mevcut', 'ok');

  // 2. dotenv yükle
  require('dotenv').config({ path: envPath });

  // 3. DATABASE_URL tanımlı mı?
  logSection('2. DATABASE_URL');
  const url = process.env.DATABASE_URL;
  if (!url || typeof url !== 'string' || !url.trim()) {
    log('DATABASE_URL tanımlı değil', 'fail');
    console.log('\n  .env dosyasına ekleyin:');
    console.log('  DATABASE_URL=postgresql://postgres:SIFRENIZ@localhost:5432/futbol_okulu');
    console.log('\n  SQLite kullanıyorsanız bu adımı atlayın (DATABASE_URL boş = SQLite)\n');
    process.exit(1);
  }
  log('DATABASE_URL tanımlı', 'ok');

  // Şifre görünür mü kontrol et (güvenlik uyarısı)
  if (url.includes('SIZIN_SIFRENIZ') || url.includes('your-password')) {
    log('DATABASE_URL içinde örnek şifre kalmış! Gerçek PostgreSQL şifrenizi yazın.', 'warn');
  }

  // 4. PostgreSQL bağlantısı
  logSection('3. PostgreSQL bağlantısı');
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url.trim(),
    connectionTimeoutMillis: 8000
  });

  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    log('Bağlantı başarılı', 'ok');
  } catch (e) {
    log('Bağlantı başarısız: ' + e.message, 'fail');
    if (/password authentication failed/i.test(e.message)) {
      console.log('\n  >>> Şifre yanlış! <<<');
      console.log('  .env içinde DATABASE_URL\'deki şifreyi PostgreSQL kurulumunda');
      console.log('  belirlediğiniz postgres şifresi ile değiştirin.\n');
    } else if (/ECONNREFUSED|connect.*refused/i.test(e.message)) {
      console.log('\n  >>> PostgreSQL servisi çalışmıyor! <<<');
      console.log('  Windows: Services > postgresql-x64-16 > Start');
      console.log('  Veya: pg_ctl -D "C:\\Program Files\\PostgreSQL\\16\\data" start\n');
    } else if (/database.*does not exist/i.test(e.message)) {
      console.log('\n  >>> futbol_okulu veritabanı yok! <<<');
      console.log('  Çözüm: npm run pg:setup\n');
    } else {
      console.log('\n  Hata:', e.message, '\n');
    }
    process.exit(1);
  } finally {
    if (client) client.release();
  }

  // 5. Veritabanı içeriği
  logSection('4. Veritabanı içeriği');
  try {
    const tables = ['subeler', 'students', 'users', 'groups', 'payment_periods', 'student_period_payments'];
    for (const t of tables) {
      try {
        const r = await pool.query(`SELECT COUNT(*)::int as c FROM ${t}`);
        const c = r.rows[0]?.c ?? 0;
        log(`${t}: ${c} kayıt`, c > 0 ? 'ok' : 'warn');
      } catch (e) {
        log(`${t}: tablo yok veya hata - ${e.message}`, 'fail');
      }
    }

    const subeCount = (await pool.query('SELECT COUNT(*)::int as c FROM subeler')).rows[0]?.c ?? 0;
    if (subeCount === 0) {
      console.log('\n  Veri yok. İlk kurulumda schema otomatik oluşur.');
      console.log('  SQLite verisi varsa: npm run migrate\n');
    }
  } catch (e) {
    log('Sorgu hatası: ' + e.message, 'fail');
  } finally {
    await pool.end();
  }

  console.log('\n' + '─'.repeat(50));
  console.log(' Teşhis tamamlandı. Sorun yoksa: npm start');
  console.log('─'.repeat(50) + '\n');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * subeId backfill - Öğrenci, grup ve kullanıcılara şube bilgisi doldurur
 * Dashboard'da 0 görünüyorsa bu scripti çalıştırın.
 * Kullanım: node scripts/backfill-subeid.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('HATA: DATABASE_URL tanımlı değil');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log('subeId backfill başlıyor...\n');

    // 1. Gruplar: Eğitmenin şubesinden al
    const r1 = await client.query(`
      UPDATE groups SET subeid = (SELECT subeid FROM users WHERE id = groups.instructorid AND subeid IS NOT NULL)
      WHERE subeid IS NULL AND instructorid IS NOT NULL
    `);
    console.log('  Gruplar güncellendi:', r1.rowCount);

    // 2. Öğrenciler: Grubun şubesinden al
    const r2 = await client.query(`
      UPDATE students SET subeid = (SELECT subeid FROM groups WHERE id = students.groupid AND subeid IS NOT NULL)
      WHERE subeid IS NULL AND groupid IS NOT NULL
    `);
    console.log('  Öğrenciler güncellendi:', r2.rowCount);

    // 3. Öğrenciler: Eğitmen üzerinden (grup subeId yoksa)
    const r3 = await client.query(`
      UPDATE students s SET subeid = (SELECT u.subeid FROM groups g JOIN users u ON g.instructorid = u.id WHERE g.id = s.groupid AND u.subeid IS NOT NULL)
      WHERE s.subeid IS NULL AND s.groupid IS NOT NULL
    `);
    console.log('  Öğrenciler (eğitmen):', r3.rowCount);

    // 4. Veliler: Öğrencinin şubesinden al
    const r4 = await client.query(`
      UPDATE users SET subeid = (SELECT subeid FROM students WHERE id = users.studentid AND subeid IS NOT NULL)
      WHERE rol = 'veli' AND studentid IS NOT NULL AND subeid IS NULL
    `);
    console.log('  Veliler güncellendi:', r4.rowCount);

    // Kontrol
    const check = await client.query('SELECT COUNT(*) as c FROM students WHERE subeid IS NOT NULL');
    console.log('\n  Şubesi dolu öğrenci sayısı:', check.rows[0].c);

    const total = await client.query('SELECT COUNT(*) as c FROM students');
    console.log('  Toplam öğrenci:', total.rows[0].c);
    console.log('\n✓ Backfill tamamlandı. Sunucuyu yeniden başlatın veya dashboard\'u yenileyin.');
  } catch (e) {
    console.error('HATA:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

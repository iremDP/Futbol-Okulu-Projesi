#!/usr/bin/env node
/**
 * SQLite -> PostgreSQL Veri Taşıma Script'i
 * Kullanım: node migrate-sqlite-to-pg.js
 * 
 * Önce .env'de DATABASE_URL tanımlı olmalı.
 * futbol-okulu.db dosyası proje kökünde olmalı.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

if (!process.env.DATABASE_URL) {
  console.error('HATA: .env dosyasında DATABASE_URL tanımlı değil!');
  process.exit(1);
}

const Database = require('better-sqlite3');
const { Pool } = require('pg');

const sqlitePath = path.join(__dirname, 'futbol-okulu.db');
if (!fs.existsSync(sqlitePath)) {
  console.error('HATA: futbol-okulu.db bulunamadi:', sqlitePath);
  process.exit(1);
}
const sqlite = new Database(sqlitePath, { readonly: true });
const pg = new Pool({ connectionString: process.env.DATABASE_URL });

function toPgDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  return s;
}

async function run() {
  const client = await pg.connect();
  try {
    console.log('SQLite -> PostgreSQL taşıma başlıyor...\n');

    // Tablolar yoksa schema yükle
    const schemaPath = path.join(__dirname, 'schema-postgres.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const stmts = schema.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of stmts) {
        if (stmt.toUpperCase().startsWith('CREATE') || stmt.toUpperCase().startsWith('INSERT')) {
          await client.query(stmt + ';').catch(() => {});
        }
      }
      console.log('  ✓ Şema kontrol edildi');
    }

    // Önce PostgreSQL tablolarını temizle (FK sırasına göre)
    const truncateOrder = [
      'attendance_entries', 'attendance_sessions', 'test_metrics', 'test_sessions',
      'student_period_payments', 'parent_notes', 'student_status_history',
      'accounting_incomes', 'accounting_expenses', 'payments', 'groups', 'users',
      'students', 'payment_periods', 'subeler'
    ];
    for (const tbl of truncateOrder) {
      try {
        await client.query(`TRUNCATE ${tbl} RESTART IDENTITY CASCADE`);
      } catch (e) {
        // Tablo yoksa atla
      }
    }

    // 1. Şubeler
    const subeler = sqlite.prepare('SELECT * FROM subeler').all();
    if (subeler.length > 0) {
      for (const r of subeler) {
        await client.query(
          `INSERT INTO subeler (id, subeAdi, adres, telefon, aktif, olusturmaTarihi)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [r.id, r.subeAdi, r.adres || null, r.telefon || null, r.aktif ?? 1, r.olusturmaTarihi || new Date().toISOString()]
        );
      }
      await client.query("SELECT setval(pg_get_serial_sequence('subeler','id'), (SELECT COALESCE(MAX(id),1) FROM subeler))");
      console.log('  ✓ Şubeler:', subeler.length);
    }

    // 2. Öğrenciler
    const students = sqlite.prepare('SELECT * FROM students').all();
    if (students.length > 0) {
      for (const r of students) {
        await client.query(
          `INSERT INTO students (id, ad, soyad, tcNo, dogumTarihi, durum, veliAdi, email, veliTelefon1, veliTelefon2, mahalle, okul, kayitKaynagi, kayitTarihi, ayrilmaTarihi, notlar, groupId, subeId)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [r.id, r.ad, r.soyad, r.tcNo || null, r.dogumTarihi, r.durum || 'Aktif', r.veliAdi, r.email || null, r.veliTelefon1, r.veliTelefon2 || null, r.mahalle || null, r.okul || null, r.kayitKaynagi || null, r.kayitTarihi, r.ayrilmaTarihi || null, r.notlar || null, r.groupId || null, r.subeId || null]
        );
      }
      await client.query("SELECT setval(pg_get_serial_sequence('students','id'), (SELECT COALESCE(MAX(id),1) FROM students))");
      console.log('  ✓ Öğrenciler:', students.length);
    }

    // 3. Kullanıcılar
    const users = sqlite.prepare('SELECT * FROM users').all();
    if (users.length > 0) {
      for (const r of users) {
        await client.query(
          `INSERT INTO users (id, kullaniciAdi, sifre, rol, adSoyad, telefon, email, studentId, subeId, aktif, olusturmaTarihi)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [r.id, r.kullaniciAdi, r.sifre, r.rol, r.adSoyad, r.telefon || null, r.email || null, r.studentId || null, r.subeId || null, r.aktif ?? 1, r.olusturmaTarihi || new Date().toISOString()]
        );
      }
      await client.query("SELECT setval(pg_get_serial_sequence('users','id'), (SELECT COALESCE(MAX(id),1) FROM users))");
      console.log('  ✓ Kullanıcılar:', users.length);
    }

    // 4. Gruplar
    try {
      const groups = sqlite.prepare('SELECT * FROM groups').all();
      if (groups.length > 0) {
        for (const r of groups) {
          await client.query(
            `INSERT INTO groups (id, groupName, subeId, instructorId, durum, olusturmaTarihi, kapanis, notlar)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [r.id, r.groupName, r.subeId || null, r.instructorId || null, r.durum || 'Aktif', r.olusturmaTarihi || null, r.kapanis || r.kapatmaTarihi || null, r.notlar || null]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('groups','id'), (SELECT COALESCE(MAX(id),1) FROM groups))");
        console.log('  ✓ Gruplar:', groups.length);
      }
    } catch (e) {
      console.log('  ⚠ Gruplar atlandı:', e.message);
    }

    // 5. Ödemeler
    const payments = sqlite.prepare('SELECT * FROM payments').all();
    if (payments.length > 0) {
      await client.query('TRUNCATE payments RESTART IDENTITY CASCADE');
      for (const r of payments) {
        await client.query(
          `INSERT INTO payments (id, studentId, miktar, odemeTipi, donem, donemBaslangic, donemBitis, odemeTarihi, notlar)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [r.id, r.studentId, r.miktar, r.odemeTipi, r.donem, r.donemBaslangic, r.donemBitis, r.odemeTarihi, r.notlar || null]
        );
      }
      await client.query("SELECT setval(pg_get_serial_sequence('payments','id'), (SELECT COALESCE(MAX(id),1) FROM payments))");
      console.log('  ✓ Ödemeler:', payments.length);
    }

    // 6. Ayarlar (merge - conflict'te güncelleme)
    try {
      const settings = sqlite.prepare('SELECT * FROM settings').all();
      for (const r of settings) {
        await client.query(
          `INSERT INTO settings (anahtar, deger) VALUES ($1, $2) ON CONFLICT (anahtar) DO UPDATE SET deger = EXCLUDED.deger`,
          [r.anahtar, r.deger]
        );
      }
      if (settings.length > 0) console.log('  ✓ Ayarlar:', settings.length);
    } catch (e) {
      console.log('  ⚠ Ayarlar atlandı:', e.message);
    }

    // 7. Ödeme dönemleri
    try {
      const periods = sqlite.prepare('SELECT * FROM payment_periods').all();
      if (periods.length > 0) {
        for (const r of periods) {
          await client.query(
            `INSERT INTO payment_periods (id, donemAdi, baslangicTarihi, bitisTarihi, tutar, durum, subeId, olusturmaTarihi)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [r.id, r.donemAdi, r.baslangicTarihi, r.bitisTarihi, r.tutar, r.durum || 'Bekliyor', r.subeId || null, r.olusturmaTarihi || new Date().toISOString()]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('payment_periods','id'), (SELECT COALESCE(MAX(id),1) FROM payment_periods))");
        console.log('  ✓ Ödeme dönemleri:', periods.length);
      }
    } catch (e) {
      console.log('  ⚠ Ödeme dönemleri atlandı:', e.message);
    }

    // 8. Öğrenci dönem ödemeleri
    try {
      const spp = sqlite.prepare('SELECT * FROM student_period_payments').all();
      if (spp.length > 0) {
        await client.query('TRUNCATE student_period_payments RESTART IDENTITY CASCADE');
        for (const r of spp) {
          await client.query(
            `INSERT INTO student_period_payments (id, studentId, periodId, tutar, odemeDurumu, odemeTarihi, odemeYontemi, notlar, olusturmaTarihi)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [r.id, r.studentId, r.periodId, r.tutar, r.odemeDurumu || 'Borçlu', r.odemeTarihi || null, r.odemeYontemi || null, r.notlar || null, r.olusturmaTarihi || new Date().toISOString()]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('student_period_payments','id'), (SELECT COALESCE(MAX(id),1) FROM student_period_payments))");
        console.log('  ✓ Öğrenci dönem ödemeleri:', spp.length);
      }
    } catch (e) {
      console.log('  ⚠ Öğrenci dönem ödemeleri atlandı:', e.message);
    }

    // 9. Veli notları
    try {
      const notes = sqlite.prepare('SELECT * FROM parent_notes').all();
      if (notes.length > 0) {
        for (const r of notes) {
          await client.query(
            `INSERT INTO parent_notes (id, parentUserId, studentId, note, createdBy, createdAt, isPublic)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [r.id, r.parentUserId || null, r.studentId || null, r.note, r.createdBy, r.createdAt || new Date().toISOString(), r.isPublic ?? 0]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('parent_notes','id'), (SELECT COALESCE(MAX(id),1) FROM parent_notes))");
        console.log('  ✓ Veli notları:', notes.length);
      }
    } catch (e) {
      console.log('  ⚠ Veli notları atlandı:', e.message);
    }

    // 10. Yoklama
    try {
      const sessions = sqlite.prepare('SELECT * FROM attendance_sessions').all();
      if (sessions.length > 0) {
        let entries = [];
        try { entries = sqlite.prepare('SELECT * FROM attendance_entries').all(); } catch (_) {}
        for (const r of sessions) {
          await client.query(
            `INSERT INTO attendance_sessions (id, groupId, date, instructorId, createdAt)
             VALUES ($1, $2, $3, $4, $5)`,
            [r.id, r.groupId, r.date, r.instructorId || null, r.createdAt || new Date().toISOString()]
          );
        }
        for (const r of entries) {
          await client.query(
            `INSERT INTO attendance_entries (id, sessionId, studentId, status, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [r.id, r.sessionId, r.studentId, r.status, r.note || null]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('attendance_sessions','id'), (SELECT COALESCE(MAX(id),1) FROM attendance_sessions))");
        await client.query("SELECT setval(pg_get_serial_sequence('attendance_entries','id'), (SELECT COALESCE(MAX(id),1) FROM attendance_entries))");
        console.log('  ✓ Yoklama:', sessions.length, 'oturum,', entries?.length || 0, 'kayıt');
      }
    } catch (e) {
      console.log('  ⚠ Yoklama atlandı:', e.message);
    }

    // 11. Performans testleri
    try {
      const testSessions = sqlite.prepare('SELECT * FROM test_sessions').all();
      if (testSessions.length > 0) {
        let metrics = [];
        try { metrics = sqlite.prepare('SELECT * FROM test_metrics').all(); } catch (_) {}
        for (const r of testSessions) {
          await client.query(
            `INSERT INTO test_sessions (id, studentId, olcumNo, date, groupId, createdBy, createdRole, notes, aiComment, createdAt)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [r.id, r.studentId, r.olcumNo || null, r.date, r.groupId || null, r.createdBy || null, r.createdRole || null, r.notes || null, r.aiComment || null, r.createdAt || new Date().toISOString()]
          );
        }
        for (const r of metrics) {
          await client.query(
            `INSERT INTO test_metrics (id, sessionId, metricKey, label, value, unit, teamAvg, generalAvg)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [r.id, r.sessionId, r.metricKey, r.label, r.value, r.unit || null, r.teamAvg || null, r.generalAvg || null]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('test_sessions','id'), (SELECT COALESCE(MAX(id),1) FROM test_sessions))");
        await client.query("SELECT setval(pg_get_serial_sequence('test_metrics','id'), (SELECT COALESCE(MAX(id),1) FROM test_metrics))");
        console.log('  ✓ Performans testleri:', testSessions.length);
      }
    } catch (e) {
      console.log('  ⚠ Performans testleri atlandı:', e.message);
    }

    // 12. Öğrenci durum geçmişi
    try {
      const ssh = sqlite.prepare('SELECT * FROM student_status_history').all();
      if (ssh.length > 0) {
        for (const r of ssh) {
          await client.query(
            `INSERT INTO student_status_history (id, studentId, eskiDurum, yeniDurum, degisimTarihi, sebep, aciklama, degistirenKullanici, groupId)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [r.id, r.studentId, r.eskiDurum, r.yeniDurum, r.degisimTarihi, r.sebep || null, r.aciklama || null, r.degistirenKullanici || null, r.groupId || null]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('student_status_history','id'), (SELECT COALESCE(MAX(id),1) FROM student_status_history))");
        console.log('  ✓ Öğrenci durum geçmişi:', ssh.length);
      }
    } catch (e) {
      console.log('  ⚠ Öğrenci durum geçmişi atlandı:', e.message);
    }

    // 13. Muhasebe
    try {
      const incomes = sqlite.prepare('SELECT * FROM accounting_incomes').all();
      if (incomes.length > 0) {
        for (const r of incomes) {
          await client.query(
            `INSERT INTO accounting_incomes (id, subeId, kaynak, tutar, odemeTarihi, odemeYontemi, aciklama, paymentId, olusturmaTarihi)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [r.id, r.subeId || null, r.kaynak, r.tutar, r.odemeTarihi, r.odemeYontemi || null, r.aciklama || null, r.paymentId || null, r.olusturmaTarihi || new Date().toISOString()]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('accounting_incomes','id'), (SELECT COALESCE(MAX(id),1) FROM accounting_incomes))");
        console.log('  ✓ Muhasebe gelirleri:', incomes.length);
      }
      const expenses = sqlite.prepare('SELECT * FROM accounting_expenses').all();
      if (expenses.length > 0) {
        for (const r of expenses) {
          await client.query(
            `INSERT INTO accounting_expenses (id, subeId, kategori, tutar, giderTarihi, aciklama, olusturmaTarihi)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [r.id, r.subeId || null, r.kategori, r.tutar, r.giderTarihi, r.aciklama || null, r.olusturmaTarihi || new Date().toISOString()]
          );
        }
        await client.query("SELECT setval(pg_get_serial_sequence('accounting_expenses','id'), (SELECT COALESCE(MAX(id),1) FROM accounting_expenses))");
        console.log('  ✓ Muhasebe giderleri:', expenses.length);
      }
    } catch (e) {
      console.log('  ⚠ Muhasebe atlandı:', e.message);
    }

    console.log('\n✅ Taşıma tamamlandı!');
  } finally {
    client.release();
    sqlite.close();
    pg.end();
  }
}

run().catch(err => {
  console.error('\n❌ HATA:', err.message);
  process.exit(1);
});

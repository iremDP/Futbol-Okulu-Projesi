#!/usr/bin/env node
/**
 * PostgreSQL veri doğrulama - Verilerin taşınıp taşınmadığını kontrol eder
 * Kullanım: node scripts/verify-pg.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.DATABASE_URL) {
  console.error('HATA: DATABASE_URL tanımlı değil');
  process.exit(1);
}

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });

async function run() {
  const client = await pool.connect();
  try {
    const tables = ['subeler', 'students', 'users', 'groups', 'payment_periods', 'student_period_payments'];
    console.log('PostgreSQL veri kontrolü:\n');
    for (const t of tables) {
      try {
        const r = await client.query(`SELECT COUNT(*)::int as c FROM ${t}`);
        console.log(`  ${t}: ${r.rows[0].c} kayıt`);
      } catch (e) {
        console.log(`  ${t}: HATA - ${e.message}`);
      }
    }
    console.log('\nBeklenen: subeler=3, students=71, users=81, groups=5');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * PostgreSQL kurulum script'i
 * Veritabanı oluşturur, DATABASE_URL ile bağlanır.
 * Kullanım: node scripts/setup-pg.js
 * 
 * .env'de DATABASE_URL tanımlı olmalı.
 * Örnek: postgresql://postgres:SIFRE@localhost:5432/futbol_okulu
 * Postgres kurulumunda belirlediğiniz şifreyi kullanın.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('HATA: .env dosyasında DATABASE_URL tanımlı değil!');
  console.error('Örnek: DATABASE_URL=postgresql://postgres:SIFRE@localhost:5432/futbol_okulu');
  process.exit(1);
}

// postgres veritabanına bağlan (futbol_okulu henüz yok)
const adminUrl = url.replace(/\/[^/?]+(\?.*)?$/, '/postgres$1');
const pool = new Pool({ connectionString: adminUrl });

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'futbol_okulu'"
    );
    if (res.rows.length > 0) {
      console.log('✓ futbol_okulu veritabanı zaten mevcut.');
    } else {
      await client.query('CREATE DATABASE futbol_okulu');
      console.log('✓ futbol_okulu veritabanı oluşturuldu.');
    }
  } catch (e) {
    console.error('HATA:', e.message);
    if (e.message.includes('password authentication failed')) {
      console.error('\n>>> PostgreSQL şifresi yanlış! <<<');
      console.error('.env dosyasında DATABASE_URL içindeki şifreyi güncelleyin.');
      console.error('Örnek: postgresql://postgres:SIZIN_SIFRENIZ@localhost:5432/futbol_okulu');
      console.error('(Kurulum sırasında belirlediğiniz postgres şifresini kullanın)');
    } else if (e.message.includes('connect') || e.code === 'ECONNREFUSED') {
      console.error('\nPostgreSQL\'e bağlanılamadı. Servis çalışıyor mu?');
      console.error('Windows: Services > postgresql-x64-16 > Start');
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

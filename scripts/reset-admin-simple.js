#!/usr/bin/env node
/**
 * Admin şifresini sıfırlar - doğrudan PostgreSQL, init yok.
 * Kullanım: node scripts/reset-admin-simple.js
 *          node scripts/reset-admin-simple.js yeniSifre123
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('HATA: DATABASE_URL tanımlı değil');
  process.exit(1);
}

async function main() {
  const newPassword = process.argv[2] || 'admin123';
  if (newPassword.length < 6) {
    console.error('Hata: Şifre en az 6 karakter olmalı.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();

  try {
    const r = await client.query("SELECT id FROM users WHERE kullaniciadi = 'admin'");
    if (r.rows.length === 0) {
      console.error('Hata: admin kullanıcısı bulunamadı.');
      process.exit(1);
    }
    const adminId = r.rows[0].id;
    const hash = await bcrypt.hash(newPassword, 10);
    await client.query('UPDATE users SET sifre = $1 WHERE id = $2', [hash, adminId]);
    await client.query("DELETE FROM settings WHERE anahtar = 'admin_initial_password_hash'").catch(() => {});

    console.log('\n✓ Admin şifresi sıfırlandı.');
    console.log('  Kullanıcı: admin');
    console.log('  Yeni şifre:', newPassword);
    console.log('\nhttp://localhost:3000 adresinden giriş yapın.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Hata:', err.message);
  process.exit(1);
});

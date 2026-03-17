#!/usr/bin/env node
/**
 * Admin şifresini sıfırlar - SQLite veya PostgreSQL otomatik seçer.
 * Kullanım: node scripts/reset-admin.js [yeniSifre]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const useSqlite = process.env.USE_SQLITE === 'true' || process.env.USE_SQLITE === '1';
const hasPg = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim();

if (useSqlite || !hasPg) {
  require('./reset-admin-password');
} else {
  require('./reset-admin-simple');
}

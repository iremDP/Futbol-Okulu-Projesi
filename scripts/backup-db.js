#!/usr/bin/env node
/**
 * Veritabanı yedekleme scripti
 * SQLite: futbol-okulu.db dosyasını kopyalar
 * PostgreSQL: pg_dump kullanır (DATABASE_URL gerekli)
 * Kullanım: node scripts/backup-db.js
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const backupDir = path.join(root, 'backups');

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

if (process.env.DATABASE_URL && process.env.USE_SQLITE !== 'true') {
  // PostgreSQL yedekleme
  const outFile = path.join(backupDir, `futbol-okulu-pg-${timestamp}.sql`);
  try {
    execSync(`pg_dump "${process.env.DATABASE_URL}" > "${outFile}"`, { stdio: 'inherit' });
    console.log('PostgreSQL yedek alındı:', outFile);
  } catch (e) {
    console.error('pg_dump hatası. pg_dump PATH\'te olmalı.');
    process.exit(1);
  }
} else {
  // SQLite yedekleme
  const dbPath = path.join(root, 'futbol-okulu.db');
  if (!fs.existsSync(dbPath)) {
    console.error('futbol-okulu.db bulunamadı');
    process.exit(1);
  }
  const outFile = path.join(backupDir, `futbol-okulu-${timestamp}.db`);
  fs.copyFileSync(dbPath, outFile);
  console.log('SQLite yedek alındı:', outFile);
}

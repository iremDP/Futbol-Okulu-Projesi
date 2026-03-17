#!/usr/bin/env node
/**
 * pg_hba.conf trust modundayken çalıştırın.
 * postgres şifresini futbol2026 yapar.
 */
const { Client } = require('pg');

const c = new Client({ connectionString: 'postgresql://postgres@localhost:5432/postgres' });

c.connect()
  .then(() => c.query("ALTER USER postgres WITH PASSWORD 'futbol2026'"))
  .then(() => {
    console.log('✓ postgres şifresi futbol2026 olarak ayarlandı.');
    return c.end();
  })
  .catch((e) => {
    console.error('HATA:', e.message);
    console.error('pg_hba.conf trust modunda mı? Servis yeniden başlatıldı mı?');
    process.exit(1);
  });

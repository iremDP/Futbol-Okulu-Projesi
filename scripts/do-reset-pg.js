const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres@localhost:5432/postgres' });

async function run() {
  await c.connect();
  await c.query("ALTER USER postgres WITH PASSWORD 'futbol2026'");
  const r = await c.query("SELECT 1 FROM pg_database WHERE datname = 'futbol_okulu'");
  if (r.rows.length === 0) await c.query('CREATE DATABASE futbol_okulu');
  await c.end();
  console.log('OK');
}

run().catch(e => { console.error(e.message); process.exit(1); });

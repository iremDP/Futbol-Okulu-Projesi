/**
 * Veritabanı yükleyici
 * DATABASE_URL ayarlıysa PostgreSQL, değilse SQLite kullanır.
 * USE_SQLITE=true ile PostgreSQL atlanıp SQLite kullanılır (PG erişilemezse).
 * Tüm fonksiyonlar Promise döndürür (async/await ile kullanılır).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let db;

function loadSqlite() {
  const sqliteDb = require('./database');
  const d = {};
  for (const [key, fn] of Object.entries(sqliteDb)) {
    if (typeof fn === 'function') {
      d[key] = function (...args) {
        try {
          const result = fn.apply(sqliteDb, args);
          return Promise.resolve(result);
        } catch (err) {
          return Promise.reject(err);
        }
      };
    }
  }
  d.init = () => Promise.resolve();
  return d;
}

if (process.env.USE_SQLITE === 'true' || process.env.USE_SQLITE === '1') {
  db = loadSqlite();
} else if (process.env.DATABASE_URL) {
  db = require('./database-pg');
} else {
  db = loadSqlite();
}

module.exports = db;

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { normalizeRows, normalizeRow } = require('./pg-normalize');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || typeof DATABASE_URL !== 'string' || !DATABASE_URL.trim()) {
  throw new Error('DATABASE_URL ortam değişkeni tanımlı değil. .env dosyasında postgresql://... formatında ayarlayın.');
}

const pool = new Pool({
  connectionString: DATABASE_URL.trim(),
  max: 15,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000 // 15 sn - takılmayı önler
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool hatası:', err.message);
});

/** Bağlantı hatasını kullanıcı dostu mesaja çevir */
function formatConnectionError(err) {
  const msg = (err && err.message) || String(err);
  if (/password authentication failed/i.test(msg)) {
    return 'PostgreSQL şifresi yanlış. .env dosyasında DATABASE_URL içindeki şifreyi kontrol edin.\n  Örnek: postgresql://postgres:SIZIN_SIFRENIZ@localhost:5432/futbol_okulu';
  }
  if (/ECONNREFUSED|connect.*refused/i.test(msg)) {
    return 'PostgreSQL servisine bağlanılamadı. Servis çalışıyor mu?\n  Windows: Services > postgresql-x64-16 > Start\n  Veya: pg_ctl -D "C:\\Program Files\\PostgreSQL\\16\\data" start';
  }
  if (/ETIMEDOUT|timeout/i.test(msg)) {
    return 'PostgreSQL bağlantı zaman aşımı. Sunucu erişilebilir mi? Port 5432 açık mı?';
  }
  if (/database.*does not exist/i.test(msg)) {
    return 'futbol_okulu veritabanı yok. Önce: npm run pg:setup';
  }
  if (/role.*does not exist/i.test(msg)) {
    return 'PostgreSQL kullanıcısı bulunamadı. DATABASE_URL\'deki kullanıcı adını kontrol edin (genelde postgres).';
  }
  return msg;
}

function normRows(rows) {
  return rows ? normalizeRows(rows) : rows;
}
function normRow(row) {
  return row ? normalizeRow(row) : row;
}

// Tüm query sonuçlarını camelCase'e çevir (frontend uyumu)
function wrapQuery(originalQuery) {
  return function(...args) {
    return originalQuery.apply(this, args).then(res => {
      if (res && res.rows && res.rows.length > 0) {
        res.rows = normRows(res.rows);
      }
      return res;
    });
  };
}
pool.query = wrapQuery(pool.query.bind(pool));

const _connect = pool.connect.bind(pool);
pool.connect = function() {
  return _connect().then(client => {
    const _clientQuery = client.query.bind(client);
    client.query = wrapQuery(_clientQuery);
    return client;
  });
};

let initPromise = null;

async function ensureReady() {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}

async function createMissingParentUsers() {
  try {
    const res = await pool.query(`
      SELECT s.id, s.veliadi, s.tcno, s.velitelefon1, s.email FROM students s
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.rol = 'veli' AND u.studentid = s.id)
    `);
    let created = 0;
    for (const st of res.rows) {
      const kullaniciAdi = st.tcNo || st.tcno || ('veli' + st.id);
      const check = await pool.query('SELECT id FROM users WHERE kullaniciadi = $1', [kullaniciAdi]);
      if (check.rows.length > 0) continue;
      const sifre = st.tcNo || st.tcno || crypto.randomBytes(4).toString('hex');
      const studentRes = await pool.query('SELECT subeid FROM students WHERE id = $1', [st.id]);
      const subeId = studentRes.rows[0]?.subeid ?? studentRes.rows[0]?.subeId ?? null;
      const hashedSifre = await bcrypt.hash(sifre, 10);
      const veliAdi = st.veliAdi || st.veliadi || 'Veli';
      const telefon = st.veliTelefon1 || st.velitelefon1 || '';
      await pool.query(`
        INSERT INTO users (kullaniciadi, sifre, rol, adsoyad, telefon, email, studentid, subeid, aktif, olusturmatarihi)
        VALUES ($1, $2, 'veli', $3, $4, $5, $6, $7, 1, $8)
      `, [kullaniciAdi, hashedSifre, veliAdi, telefon || null, st.email || null, st.id, subeId, new Date().toISOString()]);
      created++;
    }
    if (created > 0) console.log('Eksik veli oluşturuldu:', created);
  } catch (e) {
    console.error('Eksik veli oluşturma hatası:', e.message);
  }
}

async function backfillSubeIds() {
  const yield = () => new Promise(r => setImmediate(r));
  try {
    await createMissingParentUsers();
    await yield();
    await pool.query(`UPDATE groups SET subeid = (SELECT subeid FROM users WHERE id = groups.instructorid AND subeid IS NOT NULL) WHERE subeid IS NULL AND instructorid IS NOT NULL`);
    await yield();
    await pool.query(`UPDATE students SET subeid = (SELECT subeid FROM groups WHERE id = students.groupid AND subeid IS NOT NULL) WHERE subeid IS NULL AND groupid IS NOT NULL`);
    await yield();
    await pool.query(`UPDATE students s SET subeid = (SELECT u.subeid FROM groups g JOIN users u ON g.instructorid = u.id WHERE g.id = s.groupid AND u.subeid IS NOT NULL) WHERE s.subeid IS NULL AND s.groupid IS NOT NULL`);
    await yield();
    await pool.query(`UPDATE users SET subeid = (SELECT subeid FROM students WHERE id = users.studentid AND subeid IS NOT NULL) WHERE rol = 'veli' AND studentid IS NOT NULL`);
    await yield();
    await pool.query(`UPDATE users u SET subeid = (SELECT COALESCE(s.subeid, g.subeid, u2.subeid) FROM students s LEFT JOIN groups g ON s.groupid = g.id LEFT JOIN users u2 ON g.instructorid = u2.id WHERE s.id = u.studentid AND (s.subeid IS NOT NULL OR g.subeid IS NOT NULL OR u2.subeid IS NOT NULL) LIMIT 1) WHERE u.rol = 'veli' AND u.studentid IS NOT NULL AND u.subeid IS NULL`);
  } catch (e) {
    console.error('subeId backfill hatası:', e.message);
  }
}

async function init() {
  process.stdout.write('PostgreSQL baglaniyor... ');
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    process.stdout.write('OK\n');
  } catch (e) {
    if (client) try { client.release(); } catch (_) {}
    const friendly = formatConnectionError(e);
    console.error('\n\n>>> PostgreSQL baglanti HATASI <<<\n');
    console.error(friendly);
    console.error('\nKontrol: npm run pg:check');
    throw new Error(friendly);
  }

  process.stdout.write('Sema kontrol ediliyor... ');
  const schemaTimeout = 45000; // 45 sn
  try {
    await Promise.race([
      createSchema(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sema 45 sn icinde tamamlanamadi. Veritabani kilitli olabilir - pgAdmin veya baska bir baglanti acik mi?')), schemaTimeout)
      )
    ]);
    process.stdout.write('OK\n');
  } catch (e) {
    console.error('\n\n>>> Sema hatasi <<<\n', formatConnectionError(e));
    throw e;
  }

  process.stdout.write('Indexler... ');
  await ensureIndexes();
  process.stdout.write('OK\n');
  process.stdout.write('Admin kullanici... ');
  await Promise.race([
    ensureAdminUser(),
    new Promise((_, r) => setTimeout(() => r(new Error('Admin 15sn timeout - pgAdmin veya baska baglanti kapatip tekrar deneyin')), 15000))
  ]);
  process.stdout.write('OK\n');
  // Sifre migration 20 sn sonra baslasin - ilk giris bloke olmasin
  setTimeout(() => migratePasswordsToHash().catch(e => console.error('Sifre migration:', e.message)), 20000);
  // Backfill kapalı - takılmaya neden oluyordu. Gerekirse: npm run pg:backfill
}

async function ensureIndexes() {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_students_subeId ON students(subeId)',
    'CREATE INDEX IF NOT EXISTS idx_students_durum ON students(durum)',
    'CREATE INDEX IF NOT EXISTS idx_students_groupId ON students(groupId)',
    'CREATE INDEX IF NOT EXISTS idx_students_kayitTarihi ON students(kayitTarihi)',
    'CREATE INDEX IF NOT EXISTS idx_users_kullaniciAdi ON users(kullaniciAdi)',
    'CREATE INDEX IF NOT EXISTS idx_users_subeId ON users(subeId)',
    'CREATE INDEX IF NOT EXISTS idx_groups_subeId ON groups(subeId)',
    'CREATE INDEX IF NOT EXISTS idx_groups_durum ON groups(durum)',
    'CREATE INDEX IF NOT EXISTS idx_spp_studentId ON student_period_payments(studentId)',
    'CREATE INDEX IF NOT EXISTS idx_spp_periodId ON student_period_payments(periodId)',
    'CREATE INDEX IF NOT EXISTS idx_spp_odemeDurumu ON student_period_payments(odemeDurumu)'
  ];
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = '15s'");
    for (const sql of indexes) {
      await client.query(sql).catch(() => {});
    }
  } finally {
    client.release();
  }
}

async function createSchema() {
  const client = await pool.connect();
  const q = (sql, params) => client.query(sql, params);
  try {
    await client.query("SET statement_timeout = '30s'");
  // Students
  await q(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      ad TEXT NOT NULL,
      soyad TEXT NOT NULL,
      tcNo TEXT,
      dogumTarihi TEXT NOT NULL,
      durum TEXT DEFAULT 'Aktif',
      veliAdi TEXT NOT NULL,
      email TEXT,
      veliTelefon1 TEXT NOT NULL,
      veliTelefon2 TEXT,
      mahalle TEXT,
      okul TEXT,
      kayitKaynagi TEXT,
      kayitTarihi TEXT NOT NULL,
      ayrilmaTarihi TEXT,
      notlar TEXT,
      groupId INTEGER,
      subeId INTEGER
    )
  `);

  // Subeler
  await q(`
    CREATE TABLE IF NOT EXISTS subeler (
      id SERIAL PRIMARY KEY,
      subeAdi TEXT UNIQUE NOT NULL,
      adres TEXT,
      telefon TEXT,
      aktif INTEGER DEFAULT 1,
      olusturmaTarihi TEXT NOT NULL
    )
  `);

  await q(`
    INSERT INTO subeler (subeAdi, aktif, olusturmaTarihi)
    VALUES ('Meydan Şube', 1, NOW()::text),
           ('Liman Şube', 1, NOW()::text),
           ('Lara Şube', 1, NOW()::text)
    ON CONFLICT (subeAdi) DO NOTHING
  `);

  // Users (must exist before groups due to FK)
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      kullaniciAdi TEXT UNIQUE NOT NULL,
      sifre TEXT NOT NULL,
      rol TEXT NOT NULL,
      adSoyad TEXT NOT NULL,
      telefon TEXT,
      email TEXT,
      studentId INTEGER,
      subeId INTEGER,
      aktif INTEGER DEFAULT 1,
      olusturmaTarihi TEXT NOT NULL,
      FOREIGN KEY(studentId) REFERENCES students(id)
    )
  `);

  // Groups (with subeId and instructorId, FK to users)
  await q(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      groupName TEXT NOT NULL,
      subeId INTEGER,
      instructorId INTEGER,
      durum TEXT DEFAULT 'Aktif',
      olusturmaTarihi TEXT,
      kapanis TEXT,
      notlar TEXT,
      FOREIGN KEY (instructorId) REFERENCES users(id)
    )
  `).catch(() => {});

  // Add columns if groups existed from older schema
  await q(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS subeId INTEGER`).catch(() => {});
  await q(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS instructorId INTEGER`).catch(() => {});

  // Payments
  await q(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL,
      miktar REAL NOT NULL,
      odemeTipi TEXT NOT NULL,
      donem TEXT NOT NULL,
      donemBaslangic TEXT NOT NULL,
      donemBitis TEXT NOT NULL,
      odemeTarihi TEXT NOT NULL,
      notlar TEXT,
      FOREIGN KEY (studentId) REFERENCES students(id)
    )
  `);

  // Settings
  await q(`
    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      anahtar TEXT UNIQUE NOT NULL,
      deger TEXT NOT NULL
    )
  `);

  await q(`
    INSERT INTO settings (anahtar, deger) VALUES ('donemUcreti', '3400'), ('donemSuresi', '28')
    ON CONFLICT (anahtar) DO NOTHING
  `);

  // Payment periods
  await q(`
    CREATE TABLE IF NOT EXISTS payment_periods (
      id SERIAL PRIMARY KEY,
      donemAdi TEXT NOT NULL,
      baslangicTarihi TEXT NOT NULL,
      bitisTarihi TEXT NOT NULL,
      tutar REAL NOT NULL,
      subeId INTEGER,
      durum TEXT DEFAULT 'Bekliyor',
      olusturmaTarihi TEXT NOT NULL
    )
  `);

  await q(`
    ALTER TABLE payment_periods ADD COLUMN IF NOT EXISTS subeId INTEGER
  `).catch(() => {});

  // Student period payments
  await q(`
    CREATE TABLE IF NOT EXISTS student_period_payments (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL,
      periodId INTEGER NOT NULL,
      tutar REAL NOT NULL,
      odemeDurumu TEXT DEFAULT 'Borçlu',
      odemeTarihi TEXT,
      odemeYontemi TEXT,
      notlar TEXT,
      olusturmaTarihi TEXT NOT NULL,
      FOREIGN KEY (studentId) REFERENCES students(id),
      FOREIGN KEY (periodId) REFERENCES payment_periods(id)
    )
  `);

  // Parent notes
  await q(`
    CREATE TABLE IF NOT EXISTS parent_notes (
      id SERIAL PRIMARY KEY,
      parentUserId INTEGER,
      studentId INTEGER,
      note TEXT NOT NULL,
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      isPublic INTEGER DEFAULT 0,
      FOREIGN KEY (parentUserId) REFERENCES users(id),
      FOREIGN KEY (studentId) REFERENCES students(id)
    )
  `);

  // Attendance
  await q(`
    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id SERIAL PRIMARY KEY,
      groupId INTEGER NOT NULL,
      date TEXT NOT NULL,
      instructorId INTEGER,
      createdAt TEXT NOT NULL,
      UNIQUE(groupId, date),
      FOREIGN KEY (groupId) REFERENCES groups(id),
      FOREIGN KEY (instructorId) REFERENCES users(id)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS attendance_entries (
      id SERIAL PRIMARY KEY,
      sessionId INTEGER NOT NULL,
      studentId INTEGER NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      UNIQUE(sessionId, studentId),
      FOREIGN KEY (sessionId) REFERENCES attendance_sessions(id),
      FOREIGN KEY (studentId) REFERENCES students(id)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS attendance_qr_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      groupId INTEGER NOT NULL,
      date TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdBy INTEGER,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (groupId) REFERENCES groups(id)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      userId INTEGER NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  // Test sessions
  await q(`
    CREATE TABLE IF NOT EXISTS test_sessions (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL,
      olcumNo INTEGER,
      date TEXT NOT NULL,
      groupId INTEGER,
      createdBy INTEGER,
      createdRole TEXT,
      notes TEXT,
      aiComment TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (studentId) REFERENCES students(id),
      FOREIGN KEY (groupId) REFERENCES groups(id),
      FOREIGN KEY (createdBy) REFERENCES users(id)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS test_metrics (
      id SERIAL PRIMARY KEY,
      sessionId INTEGER NOT NULL,
      metricKey TEXT NOT NULL,
      label TEXT NOT NULL,
      value REAL,
      unit TEXT,
      teamAvg REAL,
      generalAvg REAL,
      FOREIGN KEY (sessionId) REFERENCES test_sessions(id)
    )
  `);

  // Accounting
  await q(`
    CREATE TABLE IF NOT EXISTS accounting_incomes (
      id SERIAL PRIMARY KEY,
      subeId INTEGER,
      kaynak TEXT NOT NULL,
      tutar REAL NOT NULL,
      odemeTarihi TEXT NOT NULL,
      odemeYontemi TEXT,
      aciklama TEXT,
      paymentId INTEGER,
      olusturmaTarihi TEXT NOT NULL,
      FOREIGN KEY (subeId) REFERENCES subeler(id)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS accounting_expenses (
      id SERIAL PRIMARY KEY,
      subeId INTEGER,
      kategori TEXT NOT NULL,
      tutar REAL NOT NULL,
      giderTarihi TEXT NOT NULL,
      aciklama TEXT,
      olusturmaTarihi TEXT NOT NULL,
      FOREIGN KEY (subeId) REFERENCES subeler(id)
    )
  `);

  // Student status history
  await q(`
    CREATE TABLE IF NOT EXISTS student_status_history (
      id SERIAL PRIMARY KEY,
      studentId INTEGER NOT NULL,
      eskiDurum TEXT NOT NULL,
      yeniDurum TEXT NOT NULL,
      degisimTarihi TEXT NOT NULL,
      sebep TEXT,
      aciklama TEXT,
      degistirenKullanici TEXT,
      groupId INTEGER,
      FOREIGN KEY (studentId) REFERENCES students(id)
    )
  `);

  await q(`
    ALTER TABLE student_status_history ADD COLUMN IF NOT EXISTS groupId INTEGER
  `).catch(() => {});

  await q(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subeId INTEGER
  `).catch(() => {});
  } finally {
    client.release();
  }
}

async function migratePasswordsToHash(client) {
  try {
    const res = await pool.query('SELECT id, sifre FROM users WHERE sifre IS NOT NULL AND sifre != \'\' AND sifre NOT LIKE \'$2%\'');
    if (res.rows.length === 0) return;
    for (const u of res.rows) {
      const hash = await bcrypt.hash(u.sifre, 10);
      await pool.query('UPDATE users SET sifre = $1 WHERE id = $2', [hash, u.id]);
    }
  } catch (e) {
    console.error('Şifre migration hatası:', e.message);
  }
}

async function ensureAdminUser() {
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = '10s'");
    const check = await client.query("SELECT id, sifre FROM users WHERE kullaniciadi = 'admin'");
    if (check.rows.length > 0) {
      const admin = check.rows[0];
      const flagCheck = await client.query("SELECT deger FROM settings WHERE anahtar = 'admin_initial_password_hash'");
      if (flagCheck.rows.length === 0) {
        await client.query(`
          INSERT INTO settings (anahtar, deger) VALUES ('admin_initial_password_hash', $1)
          ON CONFLICT (anahtar) DO UPDATE SET deger = $1
        `, [admin.sifre]);
      }
      return;
    }
    const randomPw = crypto.randomBytes(12).toString('base64url');
    const adminHash = await bcrypt.hash(randomPw, 10);
    await client.query(`
      INSERT INTO users (kullaniciadi, sifre, rol, adsoyad, telefon, aktif, olusturmatarihi)
      VALUES ('admin', $1, 'admin', 'Sistem Yöneticisi', '', 1, NOW()::text)
    `, [adminHash]);
    await client.query(`
      INSERT INTO settings (anahtar, deger) VALUES ('admin_initial_password_hash', $1)
      ON CONFLICT (anahtar) DO UPDATE SET deger = $1
    `, [adminHash]);
    const credPath = path.join(__dirname, 'admin-initial-credentials.txt');
    fs.writeFileSync(credPath, `Futbol Okulu - İlk Giriş Bilgileri\n${'='.repeat(40)}\nKullanıcı: admin\nŞifre: ${randomPw}\n\n⚠️ İlk girişte şifreyi değiştirin ve bu dosyayı silin!\n`);
    console.log('⚠️ Admin oluşturuldu. Şifre: admin-initial-credentials.txt');
  } finally {
    client.release();
  }
}

// ============ ÖĞRENCİ FONKSİYONLARI ============

async function getAllStudents(subeId = null) {
  await ensureReady();
  if (subeId) {
    const res = await pool.query('SELECT * FROM students WHERE subeId = $1 ORDER BY id DESC', [subeId]);
    return res.rows;
  }
  const res = await pool.query('SELECT * FROM students ORDER BY id DESC');
  return res.rows;
}

/** Öğrenci arama + sayfalama (q, limit, offset, durum) */
async function searchStudents(subeId = null, opts = {}) {
  await ensureReady();
  const { q = '', limit = 50, offset = 0, durum } = opts;
  const params = [];
  const where = [];
  let i = 1;
  if (subeId) { where.push(`s.subeId = $${i++}`); params.push(subeId); }
  if (durum === 'Aktif') { where.push(`s.durum = 'Aktif'`); }
  else if (durum === 'Pasif') { where.push(`s.durum != 'Aktif'`); }
  const searchTerm = (q || '').trim();
  if (searchTerm) {
    const like = '%' + String(searchTerm).replace(/[%_\\]/g, '\\$&') + '%';
    where.push(`(s.ad ILIKE $${i} OR s.soyad ILIKE $${i} OR s.veliAdi ILIKE $${i} OR s.veliTelefon1 ILIKE $${i} OR s.email ILIKE $${i} OR s.tcNo ILIKE $${i})`);
    params.push(like);
    i++;
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM students s ${whereClause}`, params);
  const total = countRes.rows[0]?.c || 0;
  const limitVal = Math.min(Math.max(1, parseInt(limit, 10) || 50), 500);
  const offsetVal = Math.max(0, parseInt(offset, 10) || 0);
  const limitParam = params.length + 1;
  params.push(limitVal, offsetVal);
  const res = await pool.query(`
    SELECT s.* FROM students s ${whereClause}
    ORDER BY s.id DESC LIMIT $${limitParam} OFFSET $${limitParam + 1}
  `, params);
  return { rows: res.rows, total };
}

async function getStudentById(id) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM students WHERE id = $1', [id]);
  return res.rows[0] || null;
}

/** ID listesine göre öğrencileri getir (bellek optimizasyonu) */
async function getStudentsByIds(ids) {
  await ensureReady();
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const validIds = ids.filter(id => Number.isInteger(id) && id > 0);
  if (validIds.length === 0) return [];
  const placeholders = validIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(`SELECT * FROM students WHERE id IN (${placeholders}) ORDER BY id`, validIds);
  return res.rows;
}

async function getParentStudentIds(parentUserId) {
  await ensureReady();
  const userRes = await pool.query('SELECT studentId, telefon, email FROM users WHERE id = $1 AND rol = $2', [parentUserId, 'veli']);
  const user = userRes.rows[0];
  if (!user) return [];
  if (user.studentId) return [user.studentId];
  const tel = (user.telefon || '').trim();
  const em = (user.email || '').trim();
  if (!tel && !em) return [];
  let res;
  if (tel && em) {
    res = await pool.query('SELECT id FROM students WHERE veliTelefon1 = $1 OR email = $2', [tel, em]);
  } else if (tel) {
    res = await pool.query('SELECT id FROM students WHERE veliTelefon1 = $1', [tel]);
  } else {
    res = await pool.query('SELECT id FROM students WHERE email = $1', [em]);
  }
  return res.rows.map(r => r.id);
}

async function getStudentsByParentUserId(parentUserId) {
  await ensureReady();
  const ids = await getParentStudentIds(parentUserId);
  if (ids.length === 0) return [];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const res = await pool.query(`SELECT * FROM students WHERE id IN (${placeholders}) ORDER BY id DESC`, ids);
  return res.rows;
}

async function addStudent(student) {
  await ensureReady();
  const client = await pool.connect();
  try {
    const res = await pool.query(`
      INSERT INTO students (ad, soyad, tcNo, dogumTarihi, veliAdi, email, veliTelefon1, veliTelefon2, mahalle, okul, kayitKaynagi, kayitTarihi, groupId, subeId)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id
    `, [
      student.ad, student.soyad, student.tcNo || null, student.dogumTarihi,
      student.veliAdi, student.email || null, student.veliTelefon1, student.veliTelefon2 || null,
      student.mahalle || null, student.okul || null, student.kayitKaynagi || null,
      student.kayitTarihi, student.groupId || null, student.subeId || null
    ]);
    const studentId = res.rows[0].id;
    await createProportionalDebtsForNewStudent(client, studentId, student.kayitTarihi);
    const parentCred = await createParentUser(client, studentId, student.veliAdi, student.tcNo, student.veliTelefon1, student.email);
    return { id: studentId, ...student, parentCredentials: parentCred };
  } catch (error) {
    console.error('ADD STUDENT HATASI:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function createParentUser(client, studentId, veliAdi, tcNo, telefon, email) {
  try {
    const kullaniciAdi = tcNo || ('veli' + studentId);
    const sifre = tcNo || crypto.randomBytes(4).toString('hex');
    const existing = await pool.query('SELECT id FROM users WHERE kullaniciadi = $1', [kullaniciAdi]);
    if (existing.rows.length > 0) return null;
    const studentRes = await pool.query('SELECT subeid FROM students WHERE id = $1', [studentId]);
    const subeId = studentRes.rows[0]?.subeid ?? studentRes.rows[0]?.subeId ?? null;
    const hashedSifre = await bcrypt.hash(sifre, 10);
    const res = await pool.query(`
      INSERT INTO users (kullaniciAdi, sifre, rol, adSoyad, telefon, email, studentId, subeId, aktif, olusturmaTarihi)
      VALUES ($1, $2, 'veli', $3, $4, $5, $6, $7, 1, $8)
      RETURNING id
    `, [kullaniciAdi, hashedSifre, veliAdi, telefon || null, email || null, studentId, subeId, new Date().toISOString()]);
    return { id: res.rows[0].id, kullaniciAdi, ...(tcNo ? {} : { sifre }) };
  } catch (error) {
    console.error('Veli kullanıcısı oluşturma hatası:', error.message);
    return null;
  }
}

async function createProportionalDebtsForNewStudent(client, studentId, kayitTarihi) {
  try {
    const studentRes = await pool.query('SELECT subeId FROM students WHERE id = $1', [studentId]);
    const student = studentRes.rows[0];
    let query = "SELECT * FROM payment_periods WHERE durum = 'Aktif'";
    let activePeriods;
    if (student && student.subeId) {
      query += " AND (subeId = $1 OR subeId IS NULL)";
      activePeriods = (await pool.query(query, [student.subeId])).rows;
    } else {
      activePeriods = (await pool.query(query)).rows;
    }
    for (const period of activePeriods) {
      const kayitDate = new Date(kayitTarihi);
      const bitisDate = new Date(period.bitisTarihi);
      const baslangicDate = new Date(period.baslangicTarihi);
      if (kayitDate > bitisDate) continue;
      if (kayitDate <= baslangicDate) {
        await pool.query(`
          INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
          VALUES ($1, $2, $3, 'Borçlu', $4)
        `, [studentId, period.id, period.tutar, new Date().toISOString()]);
        continue;
      }
      // Orantılı hesaplama: Dönem haftalara bölünür, kalan hafta sayısına göre tutar hesaplanır
      const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
      const toplamHafta = Math.max(1, Math.ceil((bitisDate - baslangicDate) / MS_PER_WEEK));
      const kalanHafta = Math.ceil((bitisDate - kayitDate) / MS_PER_WEEK);
      const kalanHaftaClamped = Math.min(toplamHafta, Math.max(1, kalanHafta));
      const orantiliTutar = (period.tutar * kalanHaftaClamped) / toplamHafta;
      await pool.query(`
        INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
        VALUES ($1, $2, $3, 'Borçlu', $4)
      `, [studentId, period.id, Math.round(orantiliTutar * 100) / 100, new Date().toISOString()]);
    }
  } catch (error) {
    console.error('Orantılı borç oluşturma hatası:', error);
  }
}

async function updateStudent(id, student) {
  await ensureReady();
  await pool.query(`
    UPDATE students SET ad = $1, soyad = $2, tcNo = $3, dogumTarihi = $4, durum = $5, veliAdi = $6, email = $7,
    veliTelefon1 = $8, veliTelefon2 = $9, mahalle = $10, okul = $11, kayitKaynagi = $12, ayrilmaTarihi = $13, notlar = $14, groupId = $15
    WHERE id = $16
  `, [
    student.ad, student.soyad, student.tcNo || null, student.dogumTarihi,
    student.durum || 'Aktif', student.veliAdi, student.email || null,
    student.veliTelefon1, student.veliTelefon2 || null, student.mahalle || null, student.okul || null,
    student.kayitKaynagi || null, student.ayrilmaTarihi || null, student.notlar || null,
    student.groupId || null, id
  ]);
  return { id, ...student };
}

async function deleteStudent(id) {
  await ensureReady();
  const client = await pool.connect();
  try {
    await pool.query("DELETE FROM users WHERE studentId = $1 AND rol = 'veli'", [id]);
    await pool.query('DELETE FROM attendance_entries WHERE studentId = $1', [id]);
    await pool.query('DELETE FROM parent_notes WHERE studentId = $1', [id]);
    await pool.query('DELETE FROM payments WHERE studentId = $1', [id]);
    await pool.query('DELETE FROM student_period_payments WHERE studentId = $1', [id]);
    await pool.query('DELETE FROM student_status_history WHERE studentId = $1', [id]);
    await pool.query('DELETE FROM students WHERE id = $1', [id]);
    return { success: true };
  } catch (error) {
    console.error('Öğrenci silme hatası:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// ============ KULLANICI FONKSİYONLARI ============

async function getAllUsers(subeId = null) {
  await ensureReady();
  if (subeId) {
    const res = await pool.query(
      `SELECT id, kullaniciAdi, rol, adSoyad, telefon, email, subeId, "studentId", aktif, olusturmaTarihi FROM users WHERE (subeId = $1 OR (rol = 'veli' AND "studentId" IN (
        SELECT s.id FROM students s
        LEFT JOIN groups g ON s."groupId" = g.id
        LEFT JOIN users u ON g."instructorId" = u.id
        WHERE s.subeId = $2 OR g.subeId = $3 OR u.subeId = $4
        UNION
        SELECT spp.studentId FROM student_period_payments spp
        JOIN payment_periods pp ON spp.periodId = pp.id
        WHERE pp.subeId = $5
      ))) ORDER BY id DESC`,
      [subeId, subeId, subeId, subeId, subeId]
    );
    return res.rows;
  }
  const res = await pool.query('SELECT id, kullaniciAdi, rol, adSoyad, telefon, email, subeId, "studentId", aktif, olusturmaTarihi FROM users ORDER BY id DESC');
  return res.rows;
}

/** Kullanıcı arama + sayfalama */
async function searchUsers(subeId = null, opts = {}) {
  await ensureReady();
  const { q = '', limit = 50, offset = 0, rol } = opts;
  const params = [];
  const where = [];
  let i = 1;
  if (subeId) {
    where.push(`(subeId = $${i++} OR (rol = 'veli' AND "studentId" IN (
      SELECT s.id FROM students s
      LEFT JOIN groups g ON s."groupId" = g.id
      LEFT JOIN users u ON g."instructorId" = u.id
      WHERE s.subeId = $${i++} OR g.subeId = $${i++} OR u.subeId = $${i++}
      UNION
      SELECT spp.studentId FROM student_period_payments spp
      JOIN payment_periods pp ON spp.periodId = pp.id
      WHERE pp.subeId = $${i++}
    )))`);
    params.push(subeId, subeId, subeId, subeId, subeId);
  }
  if (rol) { where.push(`rol = $${i++}`); params.push(rol); }
  const searchTerm = (q || '').trim();
  if (searchTerm) {
    const like = '%' + String(searchTerm).replace(/[%_\\]/g, '\\$&') + '%';
    where.push(`(kullaniciAdi ILIKE $${i} OR adSoyad ILIKE $${i} OR telefon ILIKE $${i} OR email ILIKE $${i})`);
    params.push(like);
    i++;
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM users ${whereClause}`, params);
  const total = countRes.rows[0]?.c || 0;
  const limitVal = Math.min(Math.max(1, parseInt(limit, 10) || 50), 500);
  const offsetVal = Math.max(0, parseInt(offset, 10) || 0);
  const limitParam = params.length + 1;
  params.push(limitVal, offsetVal);
  const res = await pool.query(`
    SELECT id, kullaniciAdi, rol, adSoyad, telefon, email, subeId, aktif, olusturmaTarihi
    FROM users ${whereClause} ORDER BY id DESC LIMIT $${limitParam} OFFSET $${limitParam + 1}
  `, params);
  return { rows: res.rows, total };
}

/** Teşhis: Veli-şube eşleşmesini kontrol et */
async function getVeliDiagnostic(subeId) {
  await ensureReady();
  const subeRes = await pool.query('SELECT id, subeAdi FROM subeler');
  const subeler = subeRes.rows;
  const lara = subeler.find(s => ((s.subeadi || s.subeAdi) || '').toLowerCase().includes('lara'));
  const targetId = subeId || (lara && lara.id);
  let studentsInSube = 0;
  let velilerWithLaraStudent = [];
  if (targetId) {
    const scRes = await pool.query('SELECT COUNT(*)::int as c FROM students WHERE subeid = $1', [targetId]);
    studentsInSube = scRes.rows[0]?.c || 0;
    const laraIdsRes = await pool.query('SELECT id FROM students WHERE subeid = $1', [targetId]);
    const laraStudentIds = laraIdsRes.rows.map(r => r.id);
    if (laraStudentIds.length) {
      const placeholders = laraStudentIds.map((_, i) => `$${i + 1}`).join(',');
      const vwRes = await pool.query(`SELECT id, adSoyad, "studentId", "subeId" FROM users WHERE rol = 'veli' AND "studentId" IN (${placeholders})`, laraStudentIds);
      velilerWithLaraStudent = vwRes.rows;
    }
  }
  const veliRes = await pool.query('SELECT id, kullaniciAdi, adSoyad, studentId, subeId FROM users WHERE rol = $1', ['veli']);
  const veliler = veliRes.rows;
  const detay = [];
  for (const v of veliler) {
    const sid = v.studentId ?? v.studentid;
    let s = null, g = null, u = null, sppCount = 0;
    if (sid) {
      const sRes = await pool.query('SELECT id, ad, soyad, subeId, groupId FROM students WHERE id = $1', [sid]);
      s = sRes.rows[0];
      const gid = s && (s.groupid ?? s.groupId);
      if (gid) {
        const gRes = await pool.query('SELECT id, subeId, instructorId FROM groups WHERE id = $1', [gid]);
        g = gRes.rows[0];
        const uid = g && (g.instructorid ?? g.instructorId);
        if (uid) {
          const uRes = await pool.query('SELECT id, subeId FROM users WHERE id = $1', [uid]);
          u = uRes.rows[0];
        }
      }
      const sppRes = await pool.query('SELECT COUNT(*)::int as c FROM student_period_payments spp JOIN payment_periods pp ON spp.periodId = pp.id WHERE spp.studentId = $1 AND pp.subeId = $2', [sid, targetId || 0]);
      sppCount = sppRes.rows[0]?.c || 0;
    }
    const vsid = v.subeId ?? v.subeid;
    const ssid = s && (s.subeId ?? s.subeid);
    const gsid = g && (g.subeId ?? g.subeid);
    const usid = u && (u.subeId ?? u.subeid);
    const matchSube = vsid == targetId;
    const matchStudent = ssid == targetId;
    const matchGroup = gsid == targetId;
    const matchInstructor = usid == targetId;
    const matchSpp = sppCount > 0;
    const wouldMatch = matchSube || matchStudent || matchGroup || matchInstructor || matchSpp;
    detay.push({ veli: v.adSoyad ?? v.adsoyad, userId: v.id, studentId: sid, userSubeId: vsid, studentSubeId: ssid, groupSubeId: gsid, instructorSubeId: usid, sppInSube: sppCount, wouldMatch });
  }
  let searchResult = [];
  if (targetId) {
    const sr = await searchUsers(targetId, { limit: 100 });
    searchResult = sr.rows || [];
  }
  const veliInResult = searchResult.filter(r => (r.rol || r.ROL) === 'veli');
  const wouldMatchCount = detay.filter(d => d.wouldMatch).length;
  const wouldMatchSample = detay.filter(d => d.wouldMatch).slice(0, 5);
  return { subeler, targetSubeId: targetId, studentsInSube, velilerWithLaraStudentCount: velilerWithLaraStudent.length, velilerWithLaraStudent: velilerWithLaraStudent.slice(0, 5), veliCount: veliler.length, wouldMatchCount, wouldMatchSample, detay, searchResultCount: searchResult.length, veliInResultCount: veliInResult.length, veliInResult: veliInResult.slice(0, 5) };
}

async function getUserById(id) {
  await ensureReady();
  const res = await pool.query('SELECT id, kullaniciadi, rol, adsoyad, telefon, email, studentid, subeid, aktif, olusturmatarihi FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function createUser(user) {
  await ensureReady();
  const hashedSifre = user.sifre ? await bcrypt.hash(user.sifre, 10) : '';
  const res = await pool.query(`
    INSERT INTO users (kullaniciAdi, sifre, rol, adSoyad, telefon, email, studentId, subeId, aktif, olusturmaTarihi)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [user.kullaniciAdi, hashedSifre, user.rol, user.adSoyad, user.telefon || null, user.email || null, user.studentId || null, user.subeId || null, user.aktif !== undefined ? user.aktif : 1, user.olusturmaTarihi || new Date().toISOString()]);
  return { id: res.rows[0].id, ...user };
}

async function updateUser(id, user) {
  await ensureReady();
  const existing = await pool.query('SELECT kullaniciadi FROM users WHERE id = $1', [id]);
  if (user.sifre) {
    const hashedSifre = await bcrypt.hash(user.sifre, 10);
    await pool.query(`
      UPDATE users SET kullaniciAdi = $1, sifre = $2, rol = $3, adSoyad = $4, telefon = $5, email = $6, aktif = $7, subeId = $8 WHERE id = $9
    `, [user.kullaniciAdi, hashedSifre, user.rol, user.adSoyad, user.telefon || null, user.email || null, user.aktif !== undefined ? user.aktif : 1, user.subeId || null, id]);
    if ((existing.rows[0]?.kullaniciAdi || existing.rows[0]?.kullaniciadi) === 'admin') {
      await pool.query("DELETE FROM settings WHERE anahtar = 'admin_initial_password_hash'");
    }
  } else {
    await pool.query(`
      UPDATE users SET kullaniciAdi = $1, rol = $2, adSoyad = $3, telefon = $4, email = $5, aktif = $6, subeId = $7 WHERE id = $8
    `, [user.kullaniciAdi, user.rol, user.adSoyad, user.telefon || null, user.email || null, user.aktif !== undefined ? user.aktif : 1, user.subeId || null, id]);
  }
  return { id, ...user };
}

async function deleteUser(id) {
  await ensureReady();
  const res = await pool.query('SELECT COUNT(*) as count FROM groups WHERE instructorId = $1', [id]);
  if (parseInt(res.rows[0].count, 10) > 0) {
    throw new Error('Bu antrenör bir veya daha fazla gruba bağlı! Önce grupları başka antrenöre atayın.');
  }
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  return { success: true };
}

async function getUserByUsername(kullaniciAdi) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM users WHERE kullaniciadi = $1', [kullaniciAdi]);
  return res.rows[0] || null;
}

async function updateUserPassword(userId, hashedPassword) {
  await ensureReady();
  await pool.query('UPDATE users SET sifre = $1 WHERE id = $2', [hashedPassword, userId]);
}

async function getStudentsByParent(parentName, parentPhone) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM students WHERE veliAdi = $1 OR veliTelefon1 = $2', [parentName, parentPhone]);
  return res.rows;
}

// ============ ÖDEME FONKSİYONLARI ============

async function getAllPayments() {
  await ensureReady();
  const res = await pool.query(`
    SELECT p.*, s.ad, s.soyad FROM payments p
    JOIN students s ON p.studentId = s.id
    ORDER BY p.odemeTarihi DESC
  `);
  return res.rows;
}

async function getPaymentsByStudent(studentId) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM payments WHERE studentId = $1 ORDER BY odemeTarihi DESC', [studentId]);
  return res.rows;
}

async function addPayment(payment) {
  await ensureReady();
  const res = await pool.query(`
    INSERT INTO payments (studentId, miktar, odemeTipi, donem, donemBaslangic, donemBitis, odemeTarihi, notlar)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [payment.studentId, payment.miktar, payment.odemeTipi, payment.donem, payment.donemBaslangic, payment.donemBitis, payment.odemeTarihi, payment.notlar || null]);
  return { id: res.rows[0].id, ...payment };
}

async function deleteLegacyPayment(id) {
  await ensureReady();
  await pool.query('DELETE FROM payments WHERE id = $1', [id]);
  return { success: true };
}

// ============ AYARLAR FONKSİYONLARI ============

async function getSetting(key) {
  await ensureReady();
  const res = await pool.query('SELECT deger FROM settings WHERE anahtar = $1', [key]);
  return res.rows[0] ? res.rows[0].deger : null;
}

async function updateSetting(key, value) {
  await ensureReady();
  await pool.query('UPDATE settings SET deger = $1 WHERE anahtar = $2', [value, key]);
  return { key, value };
}

async function deleteSetting(key) {
  await ensureReady();
  await pool.query('DELETE FROM settings WHERE anahtar = $1', [key]);
}

// ============ GRUP YÖNETİMİ / DURUM ============

async function changeStudentStatus(studentId, durum, ayrilmaTarihi = null, sebep = null, aciklama = null, degistirenKullanici = null) {
  await ensureReady();
  const currentRes = await pool.query('SELECT durum, groupId FROM students WHERE id = $1', [studentId]);
  const currentStudent = currentRes.rows[0];
  if (!currentStudent) return { success: false };
  const newGroupId = durum === 'Pasif' ? null : (currentStudent.groupid || null);
  await pool.query(`
    UPDATE students SET durum = $1, ayrilmaTarihi = $2, groupId = $3 WHERE id = $4
  `, [durum, ayrilmaTarihi, newGroupId, studentId]);
  await pool.query(`
    INSERT INTO student_status_history (studentId, eskiDurum, yeniDurum, degisimTarihi, sebep, aciklama, degistirenKullanici, groupId)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [studentId, currentStudent.durum, durum, new Date().toISOString(), sebep, aciklama, degistirenKullanici, currentStudent.groupid || null]);
  return { success: true };
}

async function getStudentStatusHistory(studentId) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM student_status_history WHERE studentId = $1 ORDER BY degisimTarihi DESC', [studentId]);
  return res.rows;
}

async function getActiveStudents(subeId = null) {
  await ensureReady();
  if (subeId) {
    const res = await pool.query("SELECT * FROM students WHERE durum = 'Aktif' AND subeId = $1 ORDER BY ad, soyad", [subeId]);
    return res.rows;
  }
  const res = await pool.query("SELECT * FROM students WHERE durum = 'Aktif' ORDER BY ad, soyad");
  return res.rows;
}

async function getInactiveStudents(subeId = null) {
  await ensureReady();
  if (subeId) {
    const res = await pool.query("SELECT * FROM students WHERE durum != 'Aktif' AND subeId = $1 ORDER BY ayrilmaTarihi DESC", [subeId]);
    return res.rows;
  }
  const res = await pool.query("SELECT * FROM students WHERE durum != 'Aktif' ORDER BY ayrilmaTarihi DESC");
  return res.rows;
}

async function getStudentStats(subeId = null) {
  await ensureReady();
  let total, active, inactive;
  if (subeId) {
    total = (await pool.query('SELECT COUNT(*) as count FROM students WHERE subeId = $1', [subeId])).rows[0];
    active = (await pool.query("SELECT COUNT(*) as count FROM students WHERE durum = 'Aktif' AND subeId = $1", [subeId])).rows[0];
    inactive = (await pool.query("SELECT COUNT(*) as count FROM students WHERE durum != 'Aktif' AND subeId = $1", [subeId])).rows[0];
  } else {
    total = (await pool.query('SELECT COUNT(*) as count FROM students')).rows[0];
    active = (await pool.query("SELECT COUNT(*) as count FROM students WHERE durum = 'Aktif'")).rows[0];
    inactive = (await pool.query("SELECT COUNT(*) as count FROM students WHERE durum != 'Aktif'")).rows[0];
  }
  const num = (r) => parseInt(String(r?.count ?? r?.c ?? Object.values(r || {})[0] ?? 0), 10);
  return { total: num(total), active: num(active), inactive: num(inactive) };
}

// ============ ÖDEME DÖNEMLERİ FONKSİYONLARI ============

async function getLastNPeriodIdsPerSube(count) {
  await ensureReady();
  const n = Math.max(1, count);
  const subeRes = await pool.query('SELECT id FROM subeler WHERE aktif = 1');
  const subeler = subeRes.rows;
  const allPeriodIds = new Set();
  const allPeriods = [];
  let minStart = null, maxEnd = null;
  const norm = (p) => ({
    id: p.id,
    donemAdi: p.donemAdi || p.donemadi,
    baslangicTarihi: p.baslangicTarihi || p.baslangictarihi,
    bitisTarihi: p.bitisTarihi || p.bitistarihi,
    tutar: p.tutar
  });
  const addPeriod = (p) => {
    const np = norm(p);
    if (allPeriodIds.has(np.id)) return;
    allPeriodIds.add(np.id);
    allPeriods.push(np);
    if (np.baslangicTarihi) {
      const d = new Date(np.baslangicTarihi);
      if (!minStart || d < minStart) minStart = d;
    }
    if (np.bitisTarihi) {
      const d = new Date(np.bitisTarihi);
      if (!maxEnd || d > maxEnd) maxEnd = d;
    }
  };
  for (const sube of subeler) {
    const periodsRes = await pool.query(
      'SELECT * FROM payment_periods WHERE subeid = $1 ORDER BY baslangictarihi DESC LIMIT $2',
      [sube.id, n]
    );
    const periods = periodsRes.rows;
    if (periods.length > 0) {
      periods.forEach(addPeriod);
    } else {
      const globalRes = await pool.query(
        'SELECT * FROM payment_periods WHERE subeid IS NULL ORDER BY baslangictarihi DESC LIMIT $1',
        [n]
      );
      globalRes.rows.forEach(addPeriod);
    }
  }
  if (allPeriodIds.size === 0) {
    const globalRes = await pool.query(
      'SELECT * FROM payment_periods WHERE subeid IS NULL ORDER BY baslangictarihi DESC LIMIT $1',
      [n]
    );
    globalRes.rows.forEach(addPeriod);
  }
  const sorted = allPeriods.sort((a, b) => new Date(b.baslangicTarihi) - new Date(a.baslangicTarihi));
  return {
    periodIds: Array.from(allPeriodIds),
    startDate: minStart ? minStart.toISOString().split('T')[0] : null,
    endDate: maxEnd ? maxEnd.toISOString().split('T')[0] : null,
    selectedPeriods: sorted
  };
}

async function getAllPeriods(subeId = null) {
  await ensureReady();
  if (subeId) {
    const res = await pool.query('SELECT * FROM payment_periods WHERE subeId = $1 OR subeId IS NULL ORDER BY baslangicTarihi DESC', [subeId]);
    return res.rows;
  }
  const res = await pool.query('SELECT * FROM payment_periods ORDER BY baslangicTarihi DESC');
  return res.rows;
}

async function getActivePeriods() {
  await ensureReady();
  const res = await pool.query("SELECT * FROM payment_periods WHERE durum = 'Aktif' ORDER BY baslangicTarihi DESC");
  return res.rows;
}

async function createPeriod(period) {
  await ensureReady();
  const res = await pool.query(`
    INSERT INTO payment_periods (donemAdi, baslangicTarihi, bitisTarihi, tutar, subeId, durum, olusturmaTarihi)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [period.donemAdi, period.baslangicTarihi, period.bitisTarihi, period.tutar, period.subeId || null, period.durum || 'Bekliyor', period.olusturmaTarihi || new Date().toISOString()]);
  return { id: res.rows[0].id, ...period };
}

async function updatePeriod(id, period) {
  await ensureReady();
  const currentRes = await pool.query('SELECT * FROM payment_periods WHERE id = $1', [id]);
  const currentPeriod = currentRes.rows[0];
  if (!currentPeriod) return { id, ...period };
  await pool.query(`
    UPDATE payment_periods SET donemAdi = $1, baslangicTarihi = $2, bitisTarihi = $3, tutar = $4 WHERE id = $5
  `, [period.donemAdi, period.baslangicTarihi, period.bitisTarihi, period.tutar, id]);
  if (currentPeriod.durum === 'Aktif' && currentPeriod.tutar !== period.tutar) {
    await pool.query(`
      UPDATE student_period_payments SET tutar = $1 WHERE periodId = $2 AND odemeDurumu = 'Borçlu'
    `, [period.tutar, id]);
  }
  return { id, ...period };
}

async function deletePeriod(id) {
  await ensureReady();
  await pool.query('DELETE FROM student_period_payments WHERE periodId = $1', [id]);
  await pool.query('DELETE FROM payment_periods WHERE id = $1', [id]);
  return { success: true };
}

async function activatePeriod(periodId) {
  await ensureReady();
  const periodRes = await pool.query('SELECT * FROM payment_periods WHERE id = $1', [periodId]);
  const period = periodRes.rows[0];
  if (!period) return { success: false, count: 0 };
  let query = "SELECT id FROM students WHERE durum = 'Aktif'";
  let activeStudents;
  if (period.subeid) {
    activeStudents = (await pool.query(query + ' AND subeId = $1', [period.subeid])).rows;
  } else {
    activeStudents = (await pool.query(query)).rows;
  }
  for (const student of activeStudents) {
    await pool.query(`
      INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
      VALUES ($1, $2, $3, 'Borçlu', $4)
    `, [student.id, periodId, period.tutar, new Date().toISOString()]);
  }
  await pool.query("UPDATE payment_periods SET durum = 'Aktif' WHERE id = $1", [periodId]);
  return { success: true, count: activeStudents.length };
}

async function getPeriodPaymentStats(periodIds, subeId = null) {
  await ensureReady();
  if (!periodIds || periodIds.length === 0) {
    return { totalOdenen: 0, totalBorclu: 0, odenenSayisi: 0, borcluSayisi: 0 };
  }
  const placeholders = periodIds.map((_, i) => `$${i + 1}`).join(',');
  let query = `
    SELECT odemeDurumu, COUNT(*)::int as sayi, COALESCE(SUM(tutar), 0) as toplam
    FROM student_period_payments spp
    JOIN students s ON spp.studentId = s.id
    WHERE spp.periodId IN (${placeholders})
      AND (spp.odemeDurumu != 'Borçlu' OR s.durum = 'Aktif')
  `;
  const params = [...periodIds];
  if (subeId) {
    query += ` AND s.subeId = $${params.length + 1}`;
    params.push(subeId);
  }
  query += ' GROUP BY odemeDurumu';
  const res = await pool.query(query, params);
  let totalOdenen = 0, totalBorclu = 0, odenenSayisi = 0, borcluSayisi = 0;
  res.rows.forEach(r => {
    const durum = (r.odemedurumu || r.odemeDurumu || '').toString();
    const sayi = parseInt(r.sayi, 10) || 0;
    const toplam = parseFloat(r.toplam) || 0;
    if (durum === 'Ödendi') {
      odenenSayisi += sayi;
      totalOdenen += toplam;
    } else if (durum === 'Borçlu') {
      borcluSayisi += sayi;
      totalBorclu += toplam;
    }
  });
  return { totalOdenen, totalBorclu, odenenSayisi, borcluSayisi };
}

async function getStudentPeriodPayments(studentId) {
  await ensureReady();
  const res = await pool.query(`
    SELECT spp.*, pp.donemAdi, pp.baslangicTarihi, pp.bitisTarihi
    FROM student_period_payments spp
    JOIN payment_periods pp ON spp.periodId = pp.id
    WHERE spp.studentId = $1
    ORDER BY pp.baslangicTarihi DESC
  `, [studentId]);
  return res.rows;
}

async function getAllStudentPeriodPayments(subeId = null, periodIds = null) {
  await ensureReady();
  const params = [];
  let whereClause = '';
  if (periodIds && periodIds.length > 0) {
    whereClause = 'WHERE pp.id = ANY($1)';
    params.push(periodIds);
  } else if (subeId) {
    whereClause = 'WHERE s.subeid = $1 AND pp.subeid = $1';
    params.push(subeId);
  }
  const res = await pool.query(`
    SELECT spp.*, s.ad, s.soyad, s.subeid, s.kayittarihi, s.ayrilmatarihi,
      (SELECT MAX(h.degisimtarihi) FROM student_status_history h WHERE h.studentid = s.id AND h.yenidurum = 'Aktif') AS sonaktiftarihi,
      pp.donemadi, pp.baslangictarihi, pp.bitistarihi, pp.subeid AS periodsubeid
    FROM student_period_payments spp
    JOIN students s ON spp.studentid = s.id
    JOIN payment_periods pp ON spp.periodid = pp.id
    ${whereClause}
    ORDER BY pp.baslangictarihi DESC, s.ad
  `, params);
  return res.rows;
}

/** Ödeme arama + sayfalama (öğrenci adı, dönem, odemeDurumu) */
async function searchStudentPeriodPayments(subeId = null, opts = {}) {
  await ensureReady();
  const { q = '', limit = 50, offset = 0, periodId, odemeDurumu } = opts;
  const params = [];
  const where = [];
  let i = 1;
  if (subeId) { where.push('s.subeId = $' + i + ' AND pp.subeId = $' + i); params.push(subeId); i++; }
  if (periodId) { where.push(`pp.id = $${i++}`); params.push(periodId); }
  if (odemeDurumu) { where.push(`spp.odemeDurumu = $${i++}`); params.push(odemeDurumu); }
  if (odemeDurumu === 'Borçlu') { where.push("s.durum = 'Aktif'"); }
  const searchTerm = (q || '').trim();
  if (searchTerm) {
    const like = '%' + String(searchTerm).replace(/[%_\\]/g, '\\$&') + '%';
    where.push(`(s.ad ILIKE $${i} OR s.soyad ILIKE $${i} OR s.veliAdi ILIKE $${i})`);
    params.push(like);
    i++;
  }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const countRes = await pool.query(`
    SELECT COUNT(*)::int AS c FROM student_period_payments spp
    JOIN students s ON spp.studentId = s.id
    JOIN payment_periods pp ON spp.periodId = pp.id
    ${whereClause}
  `, params);
  const total = countRes.rows[0]?.c || 0;
  const limitVal = Math.min(Math.max(1, parseInt(limit, 10) || 50), 500);
  const offsetVal = Math.max(0, parseInt(offset, 10) || 0);
  const limitParam = params.length + 1;
  params.push(limitVal, offsetVal);
  const res = await pool.query(`
    SELECT spp.*, s.ad, s.soyad, s.subeId, s.kayitTarihi, s.ayrilmaTarihi,
      (SELECT MAX(h.degisimTarihi) FROM student_status_history h WHERE h.studentId = s.id AND h.yeniDurum = 'Aktif') AS sonAktifTarihi,
      pp.donemAdi, pp.baslangicTarihi, pp.bitisTarihi, pp.subeId AS periodSubeId
    FROM student_period_payments spp
    JOIN students s ON spp.studentId = s.id
    JOIN payment_periods pp ON spp.periodId = pp.id
    ${whereClause}
    ORDER BY pp.baslangicTarihi DESC, s.ad LIMIT $${limitParam} OFFSET $${limitParam + 1}
  `, params);
  return { rows: res.rows, total };
}

async function getDebtorsByPeriodId(periodId) {
  await ensureReady();
  const res = await pool.query(`
    SELECT spp.id as paymentId, spp.studentId, spp.tutar, spp.odemeDurumu,
      s.ad, s.soyad, s.veliAdi, s.veliTelefon1, s.veliTelefon2, s.email,
      pp.donemAdi, pp.baslangicTarihi, pp.bitisTarihi
    FROM student_period_payments spp
    JOIN students s ON spp.studentId = s.id
    JOIN payment_periods pp ON spp.periodId = pp.id
    WHERE spp.periodId = $1 AND spp.odemeDurumu = 'Borçlu' AND s.durum = 'Aktif'
    ORDER BY s.ad, s.soyad
  `, [periodId]);
  return res.rows.map((r) => ({
    paymentId: r.paymentid ?? r.paymentId,
    studentId: r.studentid ?? r.studentId,
    tutar: r.tutar,
    odemeDurumu: r.odemedurumu ?? r.odemeDurumu,
    ad: r.ad,
    soyad: r.soyad,
    veliAdi: r.veliadi ?? r.veliAdi,
    veliTelefon1: r.velitelefon1 ?? r.veliTelefon1,
    veliTelefon2: r.velitelefon2 ?? r.veliTelefon2,
    email: r.email,
    donemAdi: r.donemadi ?? r.donemAdi,
    baslangicTarihi: r.baslangictarihi ?? r.baslangicTarihi,
    bitisTarihi: r.bitistarihi ?? r.bitisTarihi
  }));
}

async function makePayment(paymentId, paymentData) {
  await ensureReady();
  await pool.query(`
    UPDATE student_period_payments SET odemeDurumu = 'Ödendi', odemeTarihi = $1, odemeYontemi = $2, notlar = $3 WHERE id = $4
  `, [paymentData.odemeTarihi, paymentData.odemeYontemi, paymentData.notlar, paymentId]);
  return { success: true };
}

async function getPaymentReceipt(paymentId) {
  await ensureReady();
  const res = await pool.query(`
    SELECT spp.*, s.ad, s.soyad, s.tcno AS "tcNo", s.subeid AS "subeId", s.email, s.veliadi AS "veliAdi",
      s.velitelefon1 AS "veliTelefon1", s.velitelefon2 AS "veliTelefon2",
      pp.donemadi AS "donemAdi", pp.baslangictarihi AS "baslangicTarihi", pp.bitistarihi AS "bitisTarihi"
    FROM student_period_payments spp
    JOIN students s ON spp.studentid = s.id
    JOIN payment_periods pp ON spp.periodid = pp.id
    WHERE spp.id = $1
  `, [paymentId]);
  return res.rows[0] || null;
}

// ============ ÖN MUHASEBE FONKSİYONLARI ============

async function addIncome(income) {
  await ensureReady();
  const res = await pool.query(`
    INSERT INTO accounting_incomes (subeId, kaynak, tutar, odemeTarihi, odemeYontemi, aciklama, paymentId, olusturmaTarihi)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [income.subeId || null, income.kaynak, income.tutar, income.odemeTarihi, income.odemeYontemi || null, income.aciklama || null, income.paymentId || null, income.olusturmaTarihi || new Date().toISOString()]);
  return { id: res.rows[0].id, ...income };
}

async function deleteIncomeByPaymentId(paymentId) {
  await ensureReady();
  await pool.query('DELETE FROM accounting_incomes WHERE paymentId = $1', [paymentId]);
  return { success: true };
}

async function getIncomes(subeId = null, startDate = null, endDate = null) {
  await ensureReady();
  const clauses = [];
  const params = [];
  let i = 1;
  if (subeId) { clauses.push(`subeId = $${i++}`); params.push(subeId); }
  if (startDate) { clauses.push(`odemeTarihi >= $${i++}`); params.push(startDate); }
  if (endDate) { clauses.push(`odemeTarihi <= $${i++}`); params.push(endDate); }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const res = await pool.query('SELECT * FROM accounting_incomes' + where + ' ORDER BY odemeTarihi DESC, id DESC', params);
  return res.rows;
}

async function addExpense(expense) {
  await ensureReady();
  const res = await pool.query(`
    INSERT INTO accounting_expenses (subeId, kategori, tutar, giderTarihi, aciklama, olusturmaTarihi)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [expense.subeId || null, expense.kategori, expense.tutar, expense.giderTarihi, expense.aciklama || null, expense.olusturmaTarihi || new Date().toISOString()]);
  return { id: res.rows[0].id, ...expense };
}

async function updateExpense(id, expense) {
  await ensureReady();
  await pool.query(`
    UPDATE accounting_expenses SET kategori = $1, tutar = $2, giderTarihi = $3, aciklama = $4, subeId = $5 WHERE id = $6
  `, [expense.kategori, expense.tutar, expense.giderTarihi, expense.aciklama || null, expense.subeId || null, id]);
  return { id, ...expense };
}

async function deleteExpense(id) {
  await ensureReady();
  await pool.query('DELETE FROM accounting_expenses WHERE id = $1', [id]);
  return { success: true };
}

async function getExpenses(subeId = null, startDate = null, endDate = null) {
  await ensureReady();
  const clauses = [];
  const params = [];
  let i = 1;
  if (subeId) { clauses.push(`subeId = $${i++}`); params.push(subeId); }
  if (startDate) { clauses.push(`giderTarihi >= $${i++}`); params.push(startDate); }
  if (endDate) { clauses.push(`giderTarihi <= $${i++}`); params.push(endDate); }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const res = await pool.query('SELECT * FROM accounting_expenses' + where + ' ORDER BY giderTarihi DESC, id DESC', params);
  return res.rows;
}

async function updatePayment(paymentId, paymentData) {
  await ensureReady();
  await pool.query(`
    UPDATE student_period_payments SET odemeTarihi = $1, odemeYontemi = $2, notlar = $3 WHERE id = $4
  `, [paymentData.odemeTarihi, paymentData.odemeYontemi, paymentData.notlar, paymentId]);
  return { success: true };
}

async function deletePeriodPayment(paymentId) {
  await ensureReady();
  await pool.query(`
    UPDATE student_period_payments SET odemeDurumu = 'Borçlu', odemeTarihi = NULL, odemeYontemi = NULL, notlar = NULL WHERE id = $1
  `, [paymentId]);
  return { success: true };
}

// ============ GRUP YÖNETİMİ FONKSİYONLARI ============

async function getAllGroups(subeId = null) {
  await ensureReady();
  if (subeId) {
    const res = await pool.query('SELECT * FROM groups WHERE subeId = $1 OR subeId IS NULL ORDER BY durum DESC, groupName', [subeId]);
    return res.rows;
  }
  const res = await pool.query('SELECT * FROM groups ORDER BY durum DESC, groupName');
  return res.rows;
}

async function getActiveGroups(subeId = null) {
  await ensureReady();
  if (subeId) {
    const res = await pool.query("SELECT * FROM groups WHERE durum = 'Aktif' AND (subeId = $1 OR subeId IS NULL) ORDER BY groupName", [subeId]);
    return res.rows;
  }
  const res = await pool.query("SELECT * FROM groups WHERE durum = 'Aktif' ORDER BY groupName");
  return res.rows;
}

async function createGroup(group) {
  await ensureReady();
  const res = await pool.query(`
    INSERT INTO groups (groupName, subeId, instructorId, durum, olusturmaTarihi, notlar)
    VALUES ($1, $2, $3, 'Aktif', $4, $5)
    RETURNING id
  `, [group.groupName, group.subeId || null, group.instructorId || null, group.olusturmaTarihi || new Date().toISOString(), group.notlar || null]);
  return { id: res.rows[0].id, ...group };
}

async function updateGroup(id, group) {
  await ensureReady();
  await pool.query(`
    UPDATE groups SET groupName = $1, instructorId = $2, notlar = $3 WHERE id = $4
  `, [group.groupName, group.instructorId || null, group.notlar || null, id]);
  return { id, ...group };
}

async function closeGroup(id, kapatmaTarihi) {
  await ensureReady();
  await pool.query('UPDATE groups SET durum = $1, kapanis = $2 WHERE id = $3', ['Kapalı', kapatmaTarihi, id]);
  return { success: true };
}

async function getGroupById(id) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM groups WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function getGroupStudentCount(groupId) {
  await ensureReady();
  const res = await pool.query("SELECT COUNT(*) as count FROM students WHERE groupId = $1 AND durum = 'Aktif'", [groupId]);
  return parseInt(res.rows[0].count, 10);
}

async function transferStudentsToGroup(studentIds, newGroupId) {
  await ensureReady();
  for (const studentId of studentIds) {
    await pool.query('UPDATE students SET groupId = $1 WHERE id = $2', [newGroupId, studentId]);
  }
  return { success: true };
}

async function deleteGroup(id) {
  await ensureReady();
  const count = await getGroupStudentCount(id);
  if (count > 0) {
    throw new Error('Bu grupta öğrenci var! Önce öğrencileri başka gruba aktarın.');
  }
  const client = await pool.connect();
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM attendance_entries WHERE sessionId IN (SELECT id FROM attendance_sessions WHERE groupId = $1)', [id]);
    await pool.query('DELETE FROM attendance_sessions WHERE groupId = $1', [id]);
    await pool.query('UPDATE test_sessions SET groupId = NULL WHERE groupId = $1', [id]);
    await pool.query('DELETE FROM groups WHERE id = $1', [id]);
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { success: true };
}

// ============ VELİ NOTLARI FONKSİYONLARI ============

async function getParentNotes(parentUserId) {
  await ensureReady();
  const res = await pool.query(`
    SELECT pn.*, s.ad, s.soyad FROM parent_notes pn
    LEFT JOIN students s ON pn.studentId = s.id
    WHERE (pn.parentUserId = $1 OR pn.isPublic = 1)
    ORDER BY pn.createdAt DESC
  `, [parentUserId]);
  return res.rows;
}

async function addParentNote(note) {
  await ensureReady();
  const res = await pool.query(`
    INSERT INTO parent_notes (parentUserId, studentId, note, createdBy, createdAt, isPublic)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [note.parentUserId || null, note.studentId || null, note.note, note.createdBy, new Date().toISOString(), note.isPublic ? 1 : 0]);
  return { id: res.rows[0].id, ...note };
}

async function getParentNoteById(id) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM parent_notes WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function deleteParentNote(id) {
  await ensureReady();
  await pool.query('DELETE FROM parent_notes WHERE id = $1', [id]);
  return { success: true };
}

// ============ YOKLAMA FONKSİYONLARI ============

async function getAttendanceSession(groupId, date) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM attendance_sessions WHERE groupId = $1 AND date = $2', [groupId, date]);
  return res.rows[0] || null;
}

async function getAttendanceEntries(groupId, date) {
  await ensureReady();
  const session = await getAttendanceSession(groupId, date);
  if (!session) return [];
  const res = await pool.query(`
    SELECT ae.*, s.ad, s.soyad FROM attendance_entries ae
    LEFT JOIN students s ON ae.studentId = s.id
    WHERE ae.sessionId = $1
    ORDER BY s.ad, s.soyad
  `, [session.id]);
  return res.rows;
}

async function saveAttendance({ groupId, date, instructorId, entries }) {
  await ensureReady();
  const client = await pool.connect();
  try {
    await pool.query('BEGIN');
    let session = await getAttendanceSession(groupId, date);
    if (!session) {
      const res = await pool.query(`
        INSERT INTO attendance_sessions (groupId, date, instructorId, createdAt)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [groupId, date, instructorId || null, new Date().toISOString()]);
      session = { id: res.rows[0].id };
    } else {
      await pool.query('UPDATE attendance_sessions SET instructorId = $1 WHERE id = $2', [instructorId || null, session.id]);
      await pool.query('DELETE FROM attendance_entries WHERE sessionId = $1', [session.id]);
    }
    for (const entry of entries) {
      await pool.query(`
        INSERT INTO attendance_entries (sessionId, studentId, status, note)
        VALUES ($1, $2, $3, $4)
      `, [session.id, entry.studentId, entry.status, entry.note || null]);
    }
    await pool.query('COMMIT');
    return { success: true, sessionId: session.id };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ============ QR YOKLAMA TOKEN FONKSİYONLARI ============

async function createAttendanceQrToken({ groupId, date, token, expiresAt, createdBy }) {
  await ensureReady();
  await pool.query(`
    INSERT INTO attendance_qr_tokens (token, groupId, date, expiresAt, createdBy, createdAt)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [token, groupId, date, expiresAt, createdBy || null, new Date().toISOString()]);
  return { token, expiresAt };
}

async function getAttendanceQrToken(token) {
  await ensureReady();
  const res = await pool.query(`
    SELECT t.*, g.groupName, sb.subeAdi
    FROM attendance_qr_tokens t
    LEFT JOIN groups g ON g.id = t.groupId
    LEFT JOIN subeler sb ON sb.id = g.subeId
    WHERE t.token = $1
  `, [token]);
  return res.rows[0] || null;
}

async function cleanupExpiredQrTokens() {
  await ensureReady();
  await pool.query('DELETE FROM attendance_qr_tokens WHERE expiresAt < $1', [new Date().toISOString()]);
}

async function getActiveStudentsByGroup(groupId) {
  await ensureReady();
  const res = await pool.query(`
    SELECT id, ad, soyad FROM students
    WHERE groupId = $1 AND durum = 'Aktif'
    ORDER BY ad, soyad
  `, [groupId]);
  return res.rows;
}

async function markStudentPresent({ groupId, date, studentId, instructorId }) {
  await ensureReady();
  await pool.query('BEGIN');
  try {
    let session = await getAttendanceSession(groupId, date);
    if (!session) {
      const r = await pool.query(`
        INSERT INTO attendance_sessions (groupId, date, instructorId, createdAt)
        VALUES ($1, $2, $3, $4) RETURNING id
      `, [groupId, date, instructorId || null, new Date().toISOString()]);
      session = { id: r.rows[0].id };
    }
    const exist = await pool.query(
      'SELECT id, status FROM attendance_entries WHERE sessionId = $1 AND studentId = $2',
      [session.id, studentId]
    );
    if (exist.rows.length > 0) {
      if (exist.rows[0].status !== 'Var') {
        await pool.query('UPDATE attendance_entries SET status = $1 WHERE id = $2', ['Var', exist.rows[0].id]);
      }
    } else {
      await pool.query(`
        INSERT INTO attendance_entries (sessionId, studentId, status, note)
        VALUES ($1, $2, 'Var', NULL)
      `, [session.id, studentId]);
    }
    await pool.query('COMMIT');
    return { success: true, sessionId: session.id };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

// ============ PUSH ABONELİK FONKSİYONLARI ============

async function addPushSubscription({ userId, endpoint, p256dh, auth }) {
  await ensureReady();
  const res = await pool.query(`
    INSERT INTO push_subscriptions (userId, endpoint, p256dh, auth, createdAt)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (endpoint) DO UPDATE SET userId = EXCLUDED.userId, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    RETURNING id
  `, [userId, endpoint, p256dh, auth, new Date().toISOString()]);
  return { id: res.rows[0].id };
}

async function removePushSubscription(endpoint) {
  await ensureReady();
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  return { success: true };
}

async function getPushSubscriptionsByUserId(userId) {
  await ensureReady();
  const res = await pool.query(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE userId = $1',
    [userId]
  );
  return res.rows;
}

async function getParentUserIdsByStudentId(studentId) {
  await ensureReady();
  const sRes = await pool.query('SELECT veliTelefon1, email FROM students WHERE id = $1', [studentId]);
  const ids = new Set();
  const direct = await pool.query("SELECT id FROM users WHERE rol = 'veli' AND studentId = $1", [studentId]);
  for (const r of direct.rows) ids.add(r.id);
  const s = sRes.rows[0];
  if (s) {
    if (s.velitelefon1) {
      const byTel = await pool.query("SELECT id FROM users WHERE rol = 'veli' AND telefon = $1", [s.velitelefon1]);
      for (const r of byTel.rows) ids.add(r.id);
    }
    if (s.email) {
      const byMail = await pool.query("SELECT id FROM users WHERE rol = 'veli' AND email = $1", [s.email]);
      for (const r of byMail.rows) ids.add(r.id);
    }
  }
  return Array.from(ids);
}

/** Öğrencinin yoklama kayıtlarını getir (veli için - son N gün) */
async function getStudentAttendance(studentId, days = 60) {
  await ensureReady();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startStr = startDate.toISOString().split('T')[0];
  const rows = (await pool.query(`
    SELECT ae.status, s.date, g.groupName
    FROM attendance_entries ae
    JOIN attendance_sessions s ON ae.sessionId = s.id
    JOIN groups g ON s.groupId = g.id
    WHERE ae.studentId = $1 AND s.date >= $2
    ORDER BY s.date DESC
    LIMIT 100
  `, [studentId, startStr])).rows;
  const present = rows.filter(r => (r.status || '').trim() === 'Var').length;
  const absent = rows.filter(r => (r.status || '').trim() === 'Yok').length;
  return { rows, present, absent, total: rows.length };
}

async function getAttendanceReport(subeId = null, startDate, endDate, groupId = null) {
  await ensureReady();
  const params = [startDate, endDate];
  let groupWhere = 'WHERE s.date BETWEEN $1 AND $2';
  let i = 3;
  if (subeId) { groupWhere += ` AND g.subeId = $${i++}`; params.push(subeId); }
  if (groupId) { groupWhere += ` AND g.id = $${i++}`; params.push(groupId); }
  const groupRows = (await pool.query(`
    SELECT g.id as groupId, g.groupName, sb.subeAdi,
      COUNT(DISTINCT s.id) as sessionCount,
      SUM(CASE WHEN ae.status = 'Var' THEN 1 ELSE 0 END) as presentCount,
      SUM(CASE WHEN ae.status = 'Yok' THEN 1 ELSE 0 END) as absentCount
    FROM attendance_sessions s
    JOIN groups g ON s.groupId = g.id
    LEFT JOIN subeler sb ON g.subeId = sb.id
    JOIN attendance_entries ae ON ae.sessionId = s.id
    ${groupWhere}
    GROUP BY g.id, g.groupName, sb.subeAdi
    ORDER BY g.groupName
  `, params)).rows;

  const studentParams = [startDate, endDate];
  let studentWhere = 'WHERE s.date BETWEEN $1 AND $2';
  let j = 3;
  if (subeId) { studentWhere += ` AND g.subeId = $${j++}`; studentParams.push(subeId); }
  if (groupId) { studentWhere += ` AND g.id = $${j++}`; studentParams.push(groupId); }
  const studentRows = (await pool.query(`
    SELECT st.id as studentId, st.ad, st.soyad, g.groupName, sb.subeAdi,
      SUM(CASE WHEN ae.status = 'Var' THEN 1 ELSE 0 END) as presentCount,
      SUM(CASE WHEN ae.status = 'Yok' THEN 1 ELSE 0 END) as absentCount
    FROM attendance_sessions s
    JOIN attendance_entries ae ON ae.sessionId = s.id
    JOIN students st ON ae.studentId = st.id
    JOIN groups g ON s.groupId = g.id
    LEFT JOIN subeler sb ON g.subeId = sb.id
    ${studentWhere}
    GROUP BY st.id, st.ad, st.soyad, g.groupName, sb.subeAdi
    ORDER BY absentCount DESC, st.ad, st.soyad
  `, studentParams)).rows;

  const num = (v) => parseInt(v, 10) || 0;
  const normGroup = (row) => ({
    ...row,
    groupId: row.groupId ?? row.groupid,
    groupName: row.groupName ?? row.groupname,
    subeAdi: row.subeAdi ?? row.subeadi,
    sessionCount: num(row.sessionCount ?? row.sessioncount),
    presentCount: num(row.presentCount ?? row.presentcount),
    absentCount: num(row.absentCount ?? row.absentcount)
  });
  const normStudent = (row) => ({
    ...row,
    studentId: row.studentId ?? row.studentid,
    ad: row.ad,
    soyad: row.soyad,
    groupName: row.groupName ?? row.groupname,
    subeAdi: row.subeAdi ?? row.subeadi,
    presentCount: num(row.presentCount ?? row.presentcount),
    absentCount: num(row.absentCount ?? row.absentcount)
  });

  const groupsNorm = groupRows.map(normGroup);
  const studentsNorm = studentRows.map(normStudent);

  const totals = studentsNorm.reduce((acc, row) => {
    acc.present += row.presentCount;
    acc.absent += row.absentCount;
    return acc;
  }, { present: 0, absent: 0 });

  return { totals, groups: groupsNorm, students: studentsNorm };
}

async function getAttendanceMonthlyTrend(subeId = null, startDate, endDate, groupId = null) {
  await ensureReady();
  const params = [startDate, endDate];
  let whereClause = 'WHERE s.date BETWEEN $1 AND $2';
  let i = 3;
  if (subeId) { whereClause += ` AND g.subeId = $${i++}`; params.push(subeId); }
  if (groupId) { whereClause += ` AND g.id = $${i++}`; params.push(groupId); }
  const res = await pool.query(`
    SELECT substring(s.date::text, 1, 7) as month,
      SUM(CASE WHEN ae.status = 'Var' THEN 1 ELSE 0 END)::int as "presentCount",
      SUM(CASE WHEN ae.status = 'Yok' THEN 1 ELSE 0 END)::int as "absentCount"
    FROM attendance_sessions s
    JOIN attendance_entries ae ON ae.sessionId = s.id
    JOIN groups g ON s.groupId = g.id
    ${whereClause}
    GROUP BY substring(s.date::text, 1, 7)
    ORDER BY month
  `, params);
  return res.rows.map((r) => ({
    month: r.month,
    presentCount: parseInt(r.presentCount, 10) || 0,
    absentCount: parseInt(r.absentCount, 10) || 0
  }));
}

// ============ TEST FONKSİYONLARI ============

async function createTestSession(session) {
  await ensureReady();
  const client = await pool.connect();
  try {
    await pool.query('BEGIN');
    const res = await pool.query(`
      INSERT INTO test_sessions (studentId, olcumNo, date, groupId, createdBy, createdRole, notes, aiComment, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      session.studentId, session.olcumNo || null, session.date, session.groupId || null,
      session.createdBy || null, session.createdRole || null, session.notes || null,
      session.aiComment || null, new Date().toISOString()
    ]);
    const sessionId = res.rows[0].id;
    for (const m of (session.metrics || [])) {
      await pool.query(`
        INSERT INTO test_metrics (sessionId, metricKey, label, value, unit, teamAvg, generalAvg)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [sessionId, m.metricKey, m.label, m.value !== '' && m.value !== null ? m.value : null, m.unit || null, m.teamAvg !== '' && m.teamAvg !== null ? m.teamAvg : null, m.generalAvg !== '' && m.generalAvg !== null ? m.generalAvg : null]);
    }
    await pool.query('COMMIT');
    return { success: true, id: sessionId };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getStudentTests(studentId) {
  await ensureReady();
  const sessionsRes = await pool.query('SELECT * FROM test_sessions WHERE studentId = $1 ORDER BY date DESC, id DESC', [studentId]);
  const sessions = sessionsRes.rows;
  if (sessions.length === 0) return [];
  const ids = sessions.map(s => s.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const metricsRes = await pool.query(`SELECT * FROM test_metrics WHERE sessionId IN (${placeholders}) ORDER BY id`, ids);
  const metrics = metricsRes.rows;
  const metricsBySession = {};
  metrics.forEach(m => {
    if (!metricsBySession[m.sessionid]) metricsBySession[m.sessionid] = [];
    metricsBySession[m.sessionid].push(m);
  });
  return sessions.map(s => ({ ...s, metrics: metricsBySession[s.id] || [] }));
}

async function getTestAverages(groupId = null, date) {
  await ensureReady();
  const generalRes = await pool.query(`
    SELECT metricKey, AVG(value) as avgValue FROM test_metrics tm
    JOIN test_sessions ts ON tm.sessionId = ts.id
    WHERE ts.date = $1 AND tm.value IS NOT NULL
    GROUP BY metricKey
  `, [date]);
  const generalMap = {};
  generalRes.rows.forEach(r => { generalMap[r.metrickey] = parseFloat(r.avgvalue); });
  if (!groupId) return { team: {}, general: generalMap };
  const teamRes = await pool.query(`
    SELECT metricKey, AVG(value) as avgValue FROM test_metrics tm
    JOIN test_sessions ts ON tm.sessionId = ts.id
    WHERE ts.date = $1 AND ts.groupId = $2 AND tm.value IS NOT NULL
    GROUP BY metricKey
  `, [date, groupId]);
  const teamMap = {};
  teamRes.rows.forEach(r => { teamMap[r.metrickey] = parseFloat(r.avgvalue); });
  return { team: teamMap, general: generalMap };
}

// ============ ŞUBE YÖNETİMİ FONKSİYONLARI ============

async function getAllSubeler() {
  await ensureReady();
  const res = await pool.query('SELECT * FROM subeler ORDER BY id');
  return res.rows;
}

async function getActiveSubeler() {
  await ensureReady();
  const res = await pool.query('SELECT * FROM subeler WHERE aktif = 1 ORDER BY subeAdi');
  return res.rows;
}

async function getSubeById(id) {
  await ensureReady();
  const res = await pool.query('SELECT * FROM subeler WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function createSube(sube) {
  await ensureReady();
  const res = await pool.query(`
    INSERT INTO subeler (subeAdi, adres, telefon, aktif, olusturmaTarihi)
    VALUES ($1, $2, $3, 1, $4)
    RETURNING id
  `, [sube.subeAdi, sube.adres || null, sube.telefon || null, new Date().toISOString()]);
  return { id: res.rows[0].id, ...sube };
}

async function updateSube(id, sube) {
  await ensureReady();
  await pool.query(`
    UPDATE subeler SET subeAdi = $1, adres = $2, telefon = $3 WHERE id = $4
  `, [sube.subeAdi, sube.adres || null, sube.telefon || null, id]);
  return { id, ...sube };
}

async function toggleSubeStatus(id) {
  await ensureReady();
  await pool.query('UPDATE subeler SET aktif = CASE WHEN aktif = 1 THEN 0 ELSE 1 END WHERE id = $1', [id]);
  return { success: true };
}

async function deleteSube(id) {
  await ensureReady();
  const subeRes = await pool.query('SELECT aktif FROM subeler WHERE id = $1', [id]);
  const sube = subeRes.rows[0];
  if (sube && sube.aktif === 1) {
    throw new Error('Aktif şube silinemez! Önce pasif yapın.');
  }
  const userCount = (await pool.query('SELECT COUNT(*) as count FROM users WHERE subeId = $1', [id])).rows[0];
  const studentCount = (await pool.query('SELECT COUNT(*) as count FROM students WHERE subeId = $1', [id])).rows[0];
  const groupCount = (await pool.query('SELECT COUNT(*) as count FROM groups WHERE subeId = $1', [id])).rows[0];
  if (parseInt(userCount.count, 10) > 0 || parseInt(studentCount.count, 10) > 0 || parseInt(groupCount.count, 10) > 0) {
    throw new Error('Bu şubeye bağlı kullanıcı, öğrenci veya grup var! Önce bunları temizleyin.');
  }
  await pool.query('DELETE FROM subeler WHERE id = $1', [id]);
  return { success: true };
}

async function getSubeStats(subeId) {
  await ensureReady();
  const studentCount = (await pool.query('SELECT COUNT(*) as count FROM students WHERE subeId = $1', [subeId])).rows[0];
  const activeStudents = (await pool.query("SELECT COUNT(*) as count FROM students WHERE subeId = $1 AND durum = 'Aktif'", [subeId])).rows[0];
  const groupCount = (await pool.query('SELECT COUNT(*) as count FROM groups WHERE subeId = $1', [subeId])).rows[0];
  const instructorCount = (await pool.query("SELECT COUNT(*) as count FROM users WHERE subeId = $1 AND rol = 'antrenor'", [subeId])).rows[0];
  return {
    totalStudents: parseInt(studentCount.count, 10),
    activeStudents: parseInt(activeStudents.count, 10),
    groups: parseInt(groupCount.count, 10),
    instructors: parseInt(instructorCount.count, 10)
  };
}

async function getReportSummary(subeId, startDate, endDate) {
  await ensureReady();
  let studentQuery = 'SELECT id, dogumTarihi, okul, mahalle, groupId, kayitTarihi, kayitKaynagi FROM students';
  const params = [];
  if (subeId) {
    studentQuery += ' WHERE subeId = $1';
    params.push(subeId);
  }
  const studentsRes = await pool.query(studentQuery, params);
  const students = studentsRes.rows;

  const ageStats = {};
  const schoolStats = {};
  const mahalleStats = {};
  const sourceStats = {};
  const start = new Date(startDate);
  const end = new Date(endDate);

  function parseBirthDate(val) {
    if (!val) return null;
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str) || str.includes('-') || str.includes('/')) {
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    }
    const num = parseFloat(str);
    if (!isNaN(num) && num >= 1 && num < 100000 && !str.includes('-') && !str.includes('/')) {
      return new Date(Math.round((num - 25569) * 86400 * 1000));
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  students.forEach(s => {
    if (s.dogumtarihi) {
      const birth = parseBirthDate(s.dogumtarihi);
      if (birth) {
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        const m = now.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
        if (age < 0 || age > 120) age = '-';
        ageStats[age] = (ageStats[age] || 0) + 1;
      } else {
        ageStats['-'] = (ageStats['-'] || 0) + 1;
      }
    } else {
      ageStats['-'] = (ageStats['-'] || 0) + 1;
    }
    const schoolKey = s.okul || '-';
    schoolStats[schoolKey] = (schoolStats[schoolKey] || 0) + 1;
    const mahalleKey = s.mahalle || '-';
    mahalleStats[mahalleKey] = (mahalleStats[mahalleKey] || 0) + 1;
    if (s.kayittarihi) {
      const kayitDate = new Date(s.kayittarihi);
      if (kayitDate >= start && kayitDate <= end) {
        const sourceKey = s.kayitkaynagi || '-';
        sourceStats[sourceKey] = (sourceStats[sourceKey] || 0) + 1;
      }
    }
  });

  let groupQuery = `
    SELECT g.id, g.groupName, g.instructorId, u.adSoyad as instructorName, u.subeId as instructorSubeId, sb.subeAdi as instructorSubeAdi
    FROM groups g
    LEFT JOIN users u ON g.instructorId = u.id
    LEFT JOIN subeler sb ON u.subeId = sb.id
  `;
  const groupParams = [];
  if (subeId) {
    groupQuery += ' WHERE (g.subeId = $1 OR g.subeId IS NULL)';
    groupParams.push(subeId);
  }
  const groupsRes = await pool.query(groupQuery, groupParams);
  const groups = groupsRes.rows;

  const groupIds = groups.map(g => g.id);
  const groupStats = [];
  const instructorStatsMap = {};

  let studentCounts = {};
  let registrationCounts = {};
  let inactiveCounts = {};

  if (groupIds.length > 0) {
    const placeholders = groupIds.map((_, i) => `$${i + 1}`).join(',');
    const studentCountRows = (await pool.query(
      `SELECT groupId, COUNT(*) as count FROM students WHERE groupId IN (${placeholders}) AND durum = 'Aktif' GROUP BY groupId`,
      groupIds
    )).rows;
    studentCounts = Object.fromEntries(studentCountRows.map(r => [r.groupid, r.count]));

    const registrationRows = (await pool.query(
      `SELECT groupId, COUNT(*) as count FROM students WHERE groupId IN (${placeholders}) AND kayitTarihi BETWEEN $${groupIds.length + 1} AND $${groupIds.length + 2} GROUP BY groupId`,
      [...groupIds, startDate, endDate]
    )).rows;
    registrationCounts = Object.fromEntries(registrationRows.map(r => [r.groupid, r.count]));

    const inactiveRows = (await pool.query(
      `SELECT groupId, COUNT(*) as count FROM student_status_history WHERE yeniDurum = 'Pasif' AND groupId IN (${placeholders}) AND degisimTarihi BETWEEN $${groupIds.length + 1} AND $${groupIds.length + 2} GROUP BY groupId`,
      [...groupIds, startDate, endDate]
    )).rows;
    inactiveCounts = Object.fromEntries(inactiveRows.map(r => [r.groupid, r.count]));
  }

  groups.forEach(group => {
    const stats = {
      groupId: group.id,
      groupName: group.groupname,
      instructorId: group.instructorid,
      instructorName: group.instructorname || 'Atanmamış',
      instructorSubeAdi: group.instructorsubeadi || null,
      studentCount: studentCounts[group.id] || 0,
      registrations: registrationCounts[group.id] || 0,
      inactives: inactiveCounts[group.id] || 0
    };
    groupStats.push(stats);
    const key = stats.instructorId || 'none';
    if (!instructorStatsMap[key]) {
      instructorStatsMap[key] = {
        instructorName: stats.instructorName,
        instructorSubeAdi: stats.instructorSubeAdi,
        groupCount: 0,
        studentCount: 0,
        registrations: 0,
        inactives: 0
      };
    }
    const acc = instructorStatsMap[key];
    acc.groupCount += 1;
    acc.studentCount += stats.studentCount;
    acc.registrations += stats.registrations;
    acc.inactives += stats.inactives;
  });

  const instructorStats = Object.values(instructorStatsMap).sort((a, b) => b.groupCount - a.groupCount);

  return { ageStats, schoolStats, mahalleStats, sourceStats, groupStats, instructorStats };
}

async function getStudentPeriodStats(subeId, startDate, endDate) {
  await ensureReady();
  let totalQuery = 'SELECT COUNT(*) as count FROM students';
  let regQuery = 'SELECT COUNT(*) as count FROM students WHERE kayitTarihi BETWEEN $1 AND $2';
  let inactiveQuery = "SELECT COUNT(*) as count FROM student_status_history WHERE yeniDurum = 'Pasif' AND degisimTarihi BETWEEN $1 AND $2";
  const totalParams = [];
  const periodParams = [startDate, endDate];
  if (subeId) {
    totalQuery += ' WHERE subeId = $1';
    totalParams.push(subeId);
    regQuery += ' AND subeId = $3';
    inactiveQuery += ' AND studentId IN (SELECT id FROM students WHERE subeId = $3)';
    periodParams.push(subeId);
  }
  const total = (await pool.query(totalQuery, totalParams)).rows[0];
  const registrations = (await pool.query(regQuery, periodParams)).rows[0];
  const inactives = (await pool.query(inactiveQuery, periodParams)).rows[0];
  return {
    totalStudents: total ? parseInt(total.count, 10) : 0,
    registrations: registrations ? parseInt(registrations.count, 10) : 0,
    inactives: inactives ? parseInt(inactives.count, 10) : 0
  };
}

async function getInstructorReport(instructorId, startDate, endDate) {
  await ensureReady();
  const groupsRes = await pool.query('SELECT id, durum FROM groups WHERE instructorId = $1', [instructorId]);
  const groups = groupsRes.rows;
  const groupIds = groups.map(g => g.id);
  const activeGroupIds = groups.filter(g => g.durum === 'Aktif').map(g => g.id);
  const activeGroupCount = activeGroupIds.length;

  let activeStudentCount = 0;
  if (activeGroupIds.length > 0) {
    const placeholders = activeGroupIds.map((_, i) => `$${i + 1}`).join(',');
    const row = (await pool.query(`SELECT COUNT(*) as count FROM students WHERE durum = 'Aktif' AND groupId IN (${placeholders})`, activeGroupIds)).rows[0];
    activeStudentCount = row ? parseInt(row.count, 10) : 0;
  }

  let registrations = 0;
  let inactives = 0;
  if (groupIds.length > 0) {
    const placeholders = groupIds.map((_, i) => `$${i + 1}`).join(',');
    const regRow = (await pool.query(`SELECT COUNT(*) as count FROM students WHERE groupId IN (${placeholders}) AND kayitTarihi BETWEEN $${groupIds.length + 1} AND $${groupIds.length + 2}`, [...groupIds, startDate, endDate])).rows[0];
    registrations = regRow ? parseInt(regRow.count, 10) : 0;
    const inactiveRow = (await pool.query(`SELECT COUNT(*) as count FROM student_status_history WHERE yeniDurum = 'Pasif' AND groupId IN (${placeholders}) AND degisimTarihi BETWEEN $${groupIds.length + 1} AND $${groupIds.length + 2}`, [...groupIds, startDate, endDate])).rows[0];
    inactives = inactiveRow ? parseInt(inactiveRow.count, 10) : 0;
  }

  return { activeGroupCount, activeStudentCount, registrations, inactives };
}

async function createProportionalDebtsForReturningStudent(studentId, dönüsTarihi) {
  await ensureReady();
  const client = await pool.connect();
  try {
    const studentRes = await pool.query('SELECT subeId FROM students WHERE id = $1', [studentId]);
    const student = studentRes.rows[0];
    let query = "SELECT * FROM payment_periods WHERE durum = 'Aktif'";
    let activePeriods;
    if (student && student.subeid) {
      query += " AND (subeId = $1 OR subeId IS NULL)";
      activePeriods = (await pool.query(query, [student.subeid])).rows;
    } else {
      activePeriods = (await pool.query(query)).rows;
    }
    for (const period of activePeriods) {
      const existingRes = await pool.query('SELECT id FROM student_period_payments WHERE studentId = $1 AND periodId = $2', [studentId, period.id]);
      if (existingRes.rows.length > 0) continue;
      const donusDate = new Date(dönüsTarihi);
      const bitisDate = new Date(period.bitisTarihi);
      const baslangicDate = new Date(period.baslangicTarihi);
      if (donusDate > bitisDate) continue;
      let orantiliTutar = period.tutar;
      if (donusDate > baslangicDate) {
        const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
        const toplamHafta = Math.max(1, Math.ceil((bitisDate - baslangicDate) / MS_PER_WEEK));
        const kalanHafta = Math.ceil((bitisDate - donusDate) / MS_PER_WEEK);
        const kalanHaftaClamped = Math.min(toplamHafta, Math.max(1, kalanHafta));
        orantiliTutar = (period.tutar * kalanHaftaClamped) / toplamHafta;
      }
      await pool.query(`
        INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
        VALUES ($1, $2, $3, 'Borçlu', $4)
      `, [studentId, period.id, Math.round(orantiliTutar * 100) / 100, new Date().toISOString()]);
    }
  } catch (error) {
    console.error('Geri dönen öğrenci için borç oluşturma hatası:', error);
  } finally {
    client.release();
  }
}

module.exports = {
  init: ensureReady,
  pool,
  getAllSubeler,
  getActiveSubeler,
  getSubeById,
  createSube,
  updateSube,
  toggleSubeStatus,
  deleteSube,
  getSubeStats,
  getReportSummary,
  getStudentPeriodStats,
  getInstructorReport,
  getAllGroups,
  getActiveGroups,
  getGroupById,
  createGroup,
  updateGroup,
  closeGroup,
  getGroupStudentCount,
  transferStudentsToGroup,
  deleteGroup,
  getAllStudents,
  searchStudents,
  getStudentById,
  getStudentsByIds,
  getParentStudentIds,
  getStudentsByParentUserId,
  addStudent,
  updateStudent,
  deleteStudent,
  changeStudentStatus,
  getStudentStatusHistory,
  getActiveStudents,
  getInactiveStudents,
  getAllUsers,
  searchUsers,
  getVeliDiagnostic,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getUserByUsername,
  updateUserPassword,
  getStudentsByParent,
  getAllPayments,
  getPaymentsByStudent,
  addPayment,
  deleteLegacyPayment,
  getSetting,
  updateSetting,
  deleteSetting,
  getStudentStats,
  getLastNPeriodIdsPerSube,
  getAllPeriods,
  getActivePeriods,
  createPeriod,
  updatePeriod,
  deletePeriod,
  activatePeriod,
  getPeriodPaymentStats,
  getStudentPeriodPayments,
  getAllStudentPeriodPayments,
  searchStudentPeriodPayments,
  getDebtorsByPeriodId,
  makePayment,
  getPaymentReceipt,
  updatePayment,
  deletePeriodPayment,
  addIncome,
  deleteIncomeByPaymentId,
  getIncomes,
  addExpense,
  updateExpense,
  deleteExpense,
  getExpenses,
  getParentNotes,
  getParentNoteById,
  addParentNote,
  deleteParentNote,
  getAttendanceSession,
  getAttendanceEntries,
  saveAttendance,
  getStudentAttendance,
  getAttendanceReport,
  getAttendanceMonthlyTrend,
  createAttendanceQrToken,
  getAttendanceQrToken,
  cleanupExpiredQrTokens,
  getActiveStudentsByGroup,
  markStudentPresent,
  addPushSubscription,
  removePushSubscription,
  getPushSubscriptionsByUserId,
  getParentUserIdsByStudentId,
  createTestSession,
  getStudentTests,
  getTestAverages,
  createProportionalDebtsForReturningStudent
};

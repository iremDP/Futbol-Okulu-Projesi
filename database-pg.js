const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { normalizeRows, normalizeRow } = require('./pg-normalize');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool hatası:', err.message);
});

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

async function init() {
  const client = await pool.connect();
  try {
    await createSchema(client);
    await migratePasswordsToHash(client);
    await ensureAdminUser(client);
  } finally {
    client.release();
  }
}

async function createSchema(client) {
  // Students
  await client.query(`
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS subeler (
      id SERIAL PRIMARY KEY,
      subeAdi TEXT UNIQUE NOT NULL,
      adres TEXT,
      telefon TEXT,
      aktif INTEGER DEFAULT 1,
      olusturmaTarihi TEXT NOT NULL
    )
  `);

  await client.query(`
    INSERT INTO subeler (subeAdi, aktif, olusturmaTarihi)
    VALUES ('Meydan Şube', 1, NOW()::text),
           ('Liman Şube', 1, NOW()::text),
           ('Lara Şube', 1, NOW()::text)
    ON CONFLICT (subeAdi) DO NOTHING
  `);

  // Users (must exist before groups due to FK)
  await client.query(`
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
  await client.query(`
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
  await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS subeId INTEGER`).catch(() => {});
  await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS instructorId INTEGER`).catch(() => {});

  // Payments
  await client.query(`
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      anahtar TEXT UNIQUE NOT NULL,
      deger TEXT NOT NULL
    )
  `);

  await client.query(`
    INSERT INTO settings (anahtar, deger) VALUES ('donemUcreti', '3400'), ('donemSuresi', '28')
    ON CONFLICT (anahtar) DO NOTHING
  `);

  // Payment periods
  await client.query(`
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

  await client.query(`
    ALTER TABLE payment_periods ADD COLUMN IF NOT EXISTS subeId INTEGER
  `).catch(() => {});

  // Student period payments
  await client.query(`
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
  await client.query(`
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
  await client.query(`
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

  await client.query(`
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

  // Test sessions
  await client.query(`
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

  await client.query(`
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
  await client.query(`
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

  await client.query(`
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
  await client.query(`
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

  await client.query(`
    ALTER TABLE student_status_history ADD COLUMN IF NOT EXISTS groupId INTEGER
  `).catch(() => {});

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subeId INTEGER
  `).catch(() => {});
}

async function migratePasswordsToHash(client) {
  try {
    const res = await client.query('SELECT id, sifre FROM users');
    for (const u of res.rows) {
      if (u.sifre && !u.sifre.startsWith('$2')) {
        const hash = bcrypt.hashSync(u.sifre, 10);
        await client.query('UPDATE users SET sifre = $1 WHERE id = $2', [hash, u.id]);
      }
    }
  } catch (e) {
    console.error('Şifre migration hatası:', e.message);
  }
}

async function ensureAdminUser(client) {
  const adminHash = bcrypt.hashSync('admin123', 10);
  await client.query(`
    INSERT INTO users (kullaniciAdi, sifre, rol, adSoyad, telefon, aktif, olusturmaTarihi)
    VALUES ('admin', $1, 'admin', 'Sistem Yöneticisi', '', 1, NOW()::text)
    ON CONFLICT (kullaniciAdi) DO NOTHING
  `, [adminHash]);
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
    const res = await client.query(`
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
    const existing = await client.query('SELECT id FROM users WHERE kullaniciAdi = $1', [kullaniciAdi]);
    if (existing.rows.length > 0) return null;
    const studentRes = await client.query('SELECT subeId FROM students WHERE id = $1', [studentId]);
    const subeId = studentRes.rows[0]?.subeId || null;
    const hashedSifre = bcrypt.hashSync(sifre, 10);
    const res = await client.query(`
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
    const studentRes = await client.query('SELECT subeId FROM students WHERE id = $1', [studentId]);
    const student = studentRes.rows[0];
    let query = "SELECT * FROM payment_periods WHERE durum = 'Aktif'";
    let activePeriods;
    if (student && student.subeId) {
      query += " AND (subeId = $1 OR subeId IS NULL)";
      activePeriods = (await client.query(query, [student.subeId])).rows;
    } else {
      activePeriods = (await client.query(query)).rows;
    }
    for (const period of activePeriods) {
      const kayitDate = new Date(kayitTarihi);
      const bitisDate = new Date(period.bitisTarihi);
      const baslangicDate = new Date(period.baslangicTarihi);
      if (kayitDate > bitisDate) continue;
      if (kayitDate <= baslangicDate) {
        await client.query(`
          INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
          VALUES ($1, $2, $3, 'Borçlu', $4)
        `, [studentId, period.id, period.tutar, new Date().toISOString()]);
        continue;
      }
      const toplamGun = Math.ceil((bitisDate - baslangicDate) / (1000 * 60 * 60 * 24));
      const kalanGun = Math.ceil((bitisDate - kayitDate) / (1000 * 60 * 60 * 24)) + 1;
      const orantiliTutar = (period.tutar * kalanGun) / toplamGun;
      await client.query(`
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
    await client.query("DELETE FROM users WHERE studentId = $1 AND rol = 'veli'", [id]);
    await client.query('DELETE FROM attendance_entries WHERE studentId = $1', [id]);
    await client.query('DELETE FROM parent_notes WHERE studentId = $1', [id]);
    await client.query('DELETE FROM payments WHERE studentId = $1', [id]);
    await client.query('DELETE FROM student_period_payments WHERE studentId = $1', [id]);
    await client.query('DELETE FROM student_status_history WHERE studentId = $1', [id]);
    await client.query('DELETE FROM students WHERE id = $1', [id]);
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
    const res = await pool.query('SELECT id, kullaniciAdi, rol, adSoyad, telefon, email, subeId, aktif, olusturmaTarihi FROM users WHERE subeId = $1 ORDER BY id DESC', [subeId]);
    return res.rows;
  }
  const res = await pool.query('SELECT id, kullaniciAdi, rol, adSoyad, telefon, email, subeId, aktif, olusturmaTarihi FROM users ORDER BY id DESC');
  return res.rows;
}

async function getUserById(id) {
  await ensureReady();
  const res = await pool.query('SELECT id, kullaniciAdi, rol, adSoyad, telefon, email, studentId, subeId, aktif, olusturmaTarihi FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function createUser(user) {
  await ensureReady();
  const hashedSifre = user.sifre ? bcrypt.hashSync(user.sifre, 10) : '';
  const res = await pool.query(`
    INSERT INTO users (kullaniciAdi, sifre, rol, adSoyad, telefon, email, studentId, subeId, aktif, olusturmaTarihi)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [user.kullaniciAdi, hashedSifre, user.rol, user.adSoyad, user.telefon || null, user.email || null, user.studentId || null, user.subeId || null, user.aktif !== undefined ? user.aktif : 1, user.olusturmaTarihi || new Date().toISOString()]);
  return { id: res.rows[0].id, ...user };
}

async function updateUser(id, user) {
  await ensureReady();
  if (user.sifre) {
    const hashedSifre = bcrypt.hashSync(user.sifre, 10);
    await pool.query(`
      UPDATE users SET kullaniciAdi = $1, sifre = $2, rol = $3, adSoyad = $4, telefon = $5, email = $6, aktif = $7, subeId = $8 WHERE id = $9
    `, [user.kullaniciAdi, hashedSifre, user.rol, user.adSoyad, user.telefon || null, user.email || null, user.aktif !== undefined ? user.aktif : 1, user.subeId || null, id]);
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
  const res = await pool.query('SELECT * FROM users WHERE kullaniciAdi = $1', [kullaniciAdi]);
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
  return {
    total: parseInt(total.count, 10),
    active: parseInt(active.count, 10),
    inactive: parseInt(inactive.count, 10)
  };
}

// ============ ÖDEME DÖNEMLERİ FONKSİYONLARI ============

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
    } else {
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

async function getAllStudentPeriodPayments(subeId = null) {
  await ensureReady();
  if (subeId) {
    const res = await pool.query(`
      SELECT spp.*, s.ad, s.soyad, s.subeId, s.kayitTarihi, s.ayrilmaTarihi,
        (SELECT MAX(h.degisimTarihi) FROM student_status_history h WHERE h.studentId = s.id AND h.yeniDurum = 'Aktif') AS sonAktifTarihi,
        pp.donemAdi, pp.baslangicTarihi, pp.bitisTarihi, pp.subeId AS periodSubeId
      FROM student_period_payments spp
      JOIN students s ON spp.studentId = s.id
      JOIN payment_periods pp ON spp.periodId = pp.id
      WHERE s.subeId = $1 AND pp.subeId = $1
      ORDER BY pp.baslangicTarihi DESC, s.ad
    `, [subeId]);
    return res.rows;
  }
  const res = await pool.query(`
    SELECT spp.*, s.ad, s.soyad, s.subeId, s.kayitTarihi, s.ayrilmaTarihi,
      (SELECT MAX(h.degisimTarihi) FROM student_status_history h WHERE h.studentId = s.id AND h.yeniDurum = 'Aktif') AS sonAktifTarihi,
      pp.donemAdi, pp.baslangicTarihi, pp.bitisTarihi, pp.subeId AS periodSubeId
    FROM student_period_payments spp
    JOIN students s ON spp.studentId = s.id
    JOIN payment_periods pp ON spp.periodId = pp.id
    ORDER BY pp.baslangicTarihi DESC, s.ad
  `);
  return res.rows;
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
    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_entries WHERE sessionId IN (SELECT id FROM attendance_sessions WHERE groupId = $1)', [id]);
    await client.query('DELETE FROM attendance_sessions WHERE groupId = $1', [id]);
    await client.query('UPDATE test_sessions SET groupId = NULL WHERE groupId = $1', [id]);
    await client.query('DELETE FROM groups WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
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
    await client.query('BEGIN');
    let session = await getAttendanceSession(groupId, date);
    if (!session) {
      const res = await client.query(`
        INSERT INTO attendance_sessions (groupId, date, instructorId, createdAt)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [groupId, date, instructorId || null, new Date().toISOString()]);
      session = { id: res.rows[0].id };
    } else {
      await client.query('UPDATE attendance_sessions SET instructorId = $1 WHERE id = $2', [instructorId || null, session.id]);
      await client.query('DELETE FROM attendance_entries WHERE sessionId = $1', [session.id]);
    }
    for (const entry of entries) {
      await client.query(`
        INSERT INTO attendance_entries (sessionId, studentId, status, note)
        VALUES ($1, $2, $3, $4)
      `, [session.id, entry.studentId, entry.status, entry.note || null]);
    }
    await client.query('COMMIT');
    return { success: true, sessionId: session.id };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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

  const totals = studentRows.reduce((acc, row) => {
    acc.present += parseInt(row.presentCount || row.presentcount || 0, 10);
    acc.absent += parseInt(row.absentCount || row.absentcount || 0, 10);
    return acc;
  }, { present: 0, absent: 0 });

  return { totals, groups: groupRows, students: studentRows };
}

async function getAttendanceMonthlyTrend(subeId = null, startDate, endDate, groupId = null) {
  await ensureReady();
  const params = [startDate, endDate];
  let whereClause = 'WHERE s.date BETWEEN $1 AND $2';
  let i = 3;
  if (subeId) { whereClause += ` AND g.subeId = $${i++}`; params.push(subeId); }
  if (groupId) { whereClause += ` AND g.id = $${i++}`; params.push(groupId); }
  const res = await pool.query(`
    SELECT substring(s.date, 1, 7) as month,
      SUM(CASE WHEN ae.status = 'Var' THEN 1 ELSE 0 END) as presentCount,
      SUM(CASE WHEN ae.status = 'Yok' THEN 1 ELSE 0 END) as absentCount
    FROM attendance_sessions s
    JOIN attendance_entries ae ON ae.sessionId = s.id
    JOIN groups g ON s.groupId = g.id
    ${whereClause}
    GROUP BY substring(s.date, 1, 7)
    ORDER BY month
  `, params);
  return res.rows;
}

// ============ TEST FONKSİYONLARI ============

async function createTestSession(session) {
  await ensureReady();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(`
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
      await client.query(`
        INSERT INTO test_metrics (sessionId, metricKey, label, value, unit, teamAvg, generalAvg)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [sessionId, m.metricKey, m.label, m.value !== '' && m.value !== null ? m.value : null, m.unit || null, m.teamAvg !== '' && m.teamAvg !== null ? m.teamAvg : null, m.generalAvg !== '' && m.generalAvg !== null ? m.generalAvg : null]);
    }
    await client.query('COMMIT');
    return { success: true, id: sessionId };
  } catch (e) {
    await client.query('ROLLBACK');
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

  students.forEach(s => {
    if (s.dogumtarihi) {
      const birth = new Date(s.dogumtarihi);
      const now = new Date();
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
      ageStats[age] = (ageStats[age] || 0) + 1;
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
    const studentRes = await client.query('SELECT subeId FROM students WHERE id = $1', [studentId]);
    const student = studentRes.rows[0];
    let query = "SELECT * FROM payment_periods WHERE durum = 'Aktif'";
    let activePeriods;
    if (student && student.subeid) {
      query += " AND (subeId = $1 OR subeId IS NULL)";
      activePeriods = (await client.query(query, [student.subeid])).rows;
    } else {
      activePeriods = (await client.query(query)).rows;
    }
    for (const period of activePeriods) {
      const existingRes = await client.query('SELECT id FROM student_period_payments WHERE studentId = $1 AND periodId = $2', [studentId, period.id]);
      if (existingRes.rows.length > 0) continue;
      const donusDate = new Date(dönüsTarihi);
      const bitisDate = new Date(period.bitisTarihi);
      const baslangicDate = new Date(period.baslangicTarihi);
      if (donusDate > bitisDate) continue;
      let orantiliTutar = period.tutar;
      if (donusDate > baslangicDate) {
        const toplamGun = Math.ceil((bitisDate - baslangicDate) / (1000 * 60 * 60 * 24));
        const kalanGun = Math.ceil((bitisDate - donusDate) / (1000 * 60 * 60 * 24)) + 1;
        orantiliTutar = (period.tutar * kalanGun) / toplamGun;
      }
      await client.query(`
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
  getStudentStats,
  getAllPeriods,
  getActivePeriods,
  createPeriod,
  updatePeriod,
  deletePeriod,
  activatePeriod,
  getPeriodPaymentStats,
  getStudentPeriodPayments,
  getAllStudentPeriodPayments,
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
  getAttendanceReport,
  getAttendanceMonthlyTrend,
  createTestSession,
  getStudentTests,
  getTestAverages,
  createProportionalDebtsForReturningStudent
};

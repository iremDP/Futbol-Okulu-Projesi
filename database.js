const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const db = new Database('futbol-okulu.db');

// Mevcut düz metin şifreleri hash'e çevir (tek seferlik migration)
function migratePasswordsToHash() {
  try {
    const users = db.prepare('SELECT id, sifre FROM users').all();
    for (const u of users) {
      if (u.sifre && !u.sifre.startsWith('$2')) {
        const hash = bcrypt.hashSync(u.sifre, 10);
        db.prepare('UPDATE users SET sifre = ? WHERE id = ?').run(hash, u.id);
      }
    }
  } catch (e) {
    console.error('Şifre migration hatası:', e.message);
  }
}

// Öğrenciler tablosu
// Öğrenciler tablosu (Güncellenmiş)
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    groupId INTEGER
  )
`);

// Şubeler tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS subeler (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subeAdi TEXT UNIQUE NOT NULL,
    adres TEXT,
    telefon TEXT,
    aktif INTEGER DEFAULT 1,
    olusturmaTarihi TEXT NOT NULL
  )
`);

// Varsayılan şubeleri ekle
db.exec(`
  INSERT OR IGNORE INTO subeler (id, subeAdi, aktif, olusturmaTarihi) VALUES 
  (1, 'Meydan Şube', 1, datetime('now')),
  (2, 'Liman Şube', 1, datetime('now')),
  (3, 'Lara Şube', 1, datetime('now'))
`);
// Gruplar tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupName TEXT NOT NULL,
    instructorId INTEGER,
    durum TEXT DEFAULT 'Aktif',
    olusturmaTarihi TEXT,
    kapanis TEXT,
    notlar TEXT,
    FOREIGN KEY (instructorId) REFERENCES users(id)
  )
`);

// Kullanıcılar tablosu (Veli girişleri için)
// Kullanıcılar tablosu (Gelişmiş rol sistemi)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kullaniciAdi TEXT UNIQUE NOT NULL,
    sifre TEXT NOT NULL,
    rol TEXT NOT NULL,
    adSoyad TEXT NOT NULL,
    telefon TEXT,
    email TEXT,
    studentId INTEGER,
    aktif INTEGER DEFAULT 1,
    olusturmaTarihi TEXT NOT NULL,
    FOREIGN KEY(studentId) REFERENCES students(id)
  )
`);

// Varsayılan admin kullanıcısı ekle (şifre hash'li - ilk girişte değiştirin!)
const adminHash = bcrypt.hashSync('admin123', 10);
db.prepare(`
  INSERT OR IGNORE INTO users (kullaniciAdi, sifre, rol, adSoyad, telefon, aktif, olusturmaTarihi)
  VALUES ('admin', ?, 'admin', 'Sistem Yöneticisi', '', 1, datetime('now'))
`).run(adminHash);
// Ödemeler tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId INTEGER NOT NULL,
    miktar REAL NOT NULL,
    odemeTipi TEXT NOT NULL,
    donem TEXT NOT NULL,
    donemBaslangic TEXT NOT NULL,
    donemBitis TEXT NOT NULL,
    odemeTarihi TEXT NOT NULL,
    notlar TEXT,
    FOREIGN KEY(studentId) REFERENCES students(id)
  )
`);

// Sistem ayarları tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anahtar TEXT UNIQUE NOT NULL,
    deger TEXT NOT NULL
  )
`);
// Ödeme dönemleri tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS payment_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donemAdi TEXT NOT NULL,
    baslangicTarihi TEXT NOT NULL,
    bitisTarihi TEXT NOT NULL,
    tutar REAL NOT NULL,
    durum TEXT DEFAULT 'Bekliyor',
    olusturmaTarihi TEXT NOT NULL
  )
`);

// Öğrenci dönem ödemeleri tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS student_period_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId INTEGER NOT NULL,
    periodId INTEGER NOT NULL,
    tutar REAL NOT NULL,
    odemeDurumu TEXT DEFAULT 'Borçlu',
    odemeTarihi TEXT,
    odemeYontemi TEXT,
    notlar TEXT,
    olusturmaTarihi TEXT NOT NULL,
    FOREIGN KEY(studentId) REFERENCES students(id),
    FOREIGN KEY(periodId) REFERENCES payment_periods(id)
  )
`);
// Veli notları tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS parent_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parentUserId INTEGER,
    studentId INTEGER,
    note TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    isPublic INTEGER DEFAULT 0,
    FOREIGN KEY(parentUserId) REFERENCES users(id),
    FOREIGN KEY(studentId) REFERENCES students(id)
  )
`);

// Yoklama tabloları
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    date TEXT NOT NULL,
    instructorId INTEGER,
    createdAt TEXT NOT NULL,
    UNIQUE(groupId, date),
    FOREIGN KEY(groupId) REFERENCES groups(id),
    FOREIGN KEY(instructorId) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS attendance_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId INTEGER NOT NULL,
    studentId INTEGER NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    UNIQUE(sessionId, studentId),
    FOREIGN KEY(sessionId) REFERENCES attendance_sessions(id),
    FOREIGN KEY(studentId) REFERENCES students(id)
  )
`);

// Performans testleri
db.exec(`
  CREATE TABLE IF NOT EXISTS test_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId INTEGER NOT NULL,
    olcumNo INTEGER,
    date TEXT NOT NULL,
    groupId INTEGER,
    createdBy INTEGER,
    createdRole TEXT,
    notes TEXT,
    aiComment TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(studentId) REFERENCES students(id),
    FOREIGN KEY(groupId) REFERENCES groups(id),
    FOREIGN KEY(createdBy) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS test_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId INTEGER NOT NULL,
    metricKey TEXT NOT NULL,
    label TEXT NOT NULL,
    value REAL,
    unit TEXT,
    teamAvg REAL,
    generalAvg REAL,
    FOREIGN KEY(sessionId) REFERENCES test_sessions(id)
  )
`);

// Ön Muhasebe - Gelirler
db.exec(`
  CREATE TABLE IF NOT EXISTS accounting_incomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subeId INTEGER,
    kaynak TEXT NOT NULL,
    tutar REAL NOT NULL,
    odemeTarihi TEXT NOT NULL,
    odemeYontemi TEXT,
    aciklama TEXT,
    paymentId INTEGER,
    olusturmaTarihi TEXT NOT NULL,
    FOREIGN KEY(subeId) REFERENCES subeler(id)
  )
`);

// Ön Muhasebe - Giderler
db.exec(`
  CREATE TABLE IF NOT EXISTS accounting_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subeId INTEGER,
    kategori TEXT NOT NULL,
    tutar REAL NOT NULL,
    giderTarihi TEXT NOT NULL,
    aciklama TEXT,
    olusturmaTarihi TEXT NOT NULL,
    FOREIGN KEY(subeId) REFERENCES subeler(id)
  )
`);

// Öğrenci durum geçmişi tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS student_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId INTEGER NOT NULL,
    eskiDurum TEXT NOT NULL,
    yeniDurum TEXT NOT NULL,
    degisimTarihi TEXT NOT NULL,
    sebep TEXT,
    aciklama TEXT,
    degistirenKullanici TEXT,
    FOREIGN KEY(studentId) REFERENCES students(id)
  )
`);

try {
  db.exec('ALTER TABLE student_status_history ADD COLUMN groupId INTEGER');
} catch (e) {}
// Gruplar tablosu
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupName TEXT UNIQUE NOT NULL,
    durum TEXT DEFAULT 'Aktif',
    olusturmaTarihi TEXT NOT NULL,
    kapatmaTarihi TEXT,
    notlar TEXT
  )
`);

// Mevcut students tablosuna groupId ekle (eğer yoksa)
try {
} catch (e) {
  // Sütun zaten varsa sessizce devam et
}

// Mevcut tablolara subeId kolonu ekle (eğer yoksa)
try {
  db.exec('ALTER TABLE users ADD COLUMN subeId INTEGER');
} catch (e) {}

try {
  db.exec('ALTER TABLE groups ADD COLUMN subeId INTEGER');
} catch (e) {}

try {
  db.exec('ALTER TABLE students ADD COLUMN subeId INTEGER');
} catch (e) {}

try {
  db.exec('ALTER TABLE students ADD COLUMN kayitKaynagi TEXT');
} catch (e) {}

try {
  db.exec('ALTER TABLE payment_periods ADD COLUMN subeId INTEGER');
} catch (e) {}

// Varsayılan ayarları ekle
db.exec(`
  INSERT OR IGNORE INTO settings (anahtar, deger) VALUES ('donemUcreti', '3400');
  INSERT OR IGNORE INTO settings (anahtar, deger) VALUES ('donemSuresi', '28');
`);

// Düz metin şifreleri hash'e çevir (mevcut veritabanları için)
migratePasswordsToHash();

// ============ ÖĞRENCİ FONKSİYONLARI ============

function getAllStudents(subeId = null) {
  let query = 'SELECT * FROM students';
  if (subeId) {
    query += ' WHERE subeId = ?';
    const stmt = db.prepare(query + ' ORDER BY id DESC');
    return stmt.all(subeId);
  } else {
    const stmt = db.prepare(query + ' ORDER BY id DESC');
    return stmt.all();
  }
}

function getStudentById(id) {
  const stmt = db.prepare('SELECT * FROM students WHERE id = ?');
  return stmt.get(id);
}

/** ID listesine göre öğrencileri getir (bellek optimizasyonu) */
function getStudentsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const validIds = ids.filter(id => Number.isInteger(id) && id > 0);
  if (validIds.length === 0) return [];
  const placeholders = validIds.map(() => '?').join(',');
  const stmt = db.prepare(`SELECT * FROM students WHERE id IN (${placeholders}) ORDER BY id`);
  return stmt.all(...validIds);
}

/** Velinin erişebileceği öğrenci ID'leri - SQL'de filtre (bellek yükü yok) */
function getParentStudentIds(parentUserId) {
  const user = db.prepare('SELECT studentId, telefon, email FROM users WHERE id = ? AND rol = ?').get(parentUserId, 'veli');
  if (!user) return [];
  if (user.studentId) return [user.studentId];
  const tel = (user.telefon || '').trim();
  const em = (user.email || '').trim();
  if (!tel && !em) return [];
  let stmt;
  if (tel && em) {
    stmt = db.prepare('SELECT id FROM students WHERE veliTelefon1 = ? OR email = ?');
    return stmt.all(tel, em).map(r => r.id);
  }
  if (tel) {
    stmt = db.prepare('SELECT id FROM students WHERE veliTelefon1 = ?');
    return stmt.all(tel).map(r => r.id);
  }
  stmt = db.prepare('SELECT id FROM students WHERE email = ?');
  return stmt.all(em).map(r => r.id);
}

/** Velinin öğrencilerini getir - SQL'de filtre */
function getStudentsByParentUserId(parentUserId) {
  const ids = getParentStudentIds(parentUserId);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const stmt = db.prepare(`SELECT * FROM students WHERE id IN (${placeholders}) ORDER BY id DESC`);
  return stmt.all(...ids);
}

function addStudent(student) {
  try {
    const stmt = db.prepare(`
      INSERT INTO students (ad, soyad, tcNo, dogumTarihi, veliAdi, email, veliTelefon1, veliTelefon2, mahalle, okul, kayitKaynagi, kayitTarihi, groupId, subeId)
      VALUES (@ad, @soyad, @tcNo, @dogumTarihi, @veliAdi, @email, @veliTelefon1, @veliTelefon2, @mahalle, @okul, @kayitKaynagi, @kayitTarihi, @groupId, @subeId)
    `);
    const info = stmt.run(student);
    const studentId = info.lastInsertRowid;
    
   // Aktif dönemler için orantılı borç oluştur
    createProportionalDebtsForNewStudent(studentId, student.kayitTarihi);
    
    // Veli kullanıcısı oluştur (TC yoksa rastgele şifre döner)
    const parentCred = createParentUser(studentId, student.veliAdi, student.tcNo, student.veliTelefon1, student.email);
    
    return { id: studentId, ...student, parentCredentials: parentCred };
    
  } catch (error) {
    console.error('ADD STUDENT HATASI:', error.message);
    throw error;
  }
}

// Veli kullanıcısı otomatik oluştur
function createParentUser(studentId, veliAdi, tcNo, telefon, email) {
  try {
    // Kullanıcı adı ve şifre: öğrenci TC kimlik numarası (aynı ad soyad çakışmasını önler)
    const kullaniciAdi = tcNo || ('veli' + studentId);
    const sifre = tcNo || crypto.randomBytes(4).toString('hex');
    
    // Kullanıcı adı zaten var mı kontrol et
    const existingUser = db.prepare('SELECT id FROM users WHERE kullaniciAdi = ?').get(kullaniciAdi);
    
    if (existingUser) return null;
    
    // Veli kullanıcısı oluştur
    const stmt = db.prepare(`
      INSERT INTO users (kullaniciAdi, sifre, rol, adSoyad, telefon, email, studentId, subeId, aktif, olusturmaTarihi)
      VALUES (?, ?, 'veli', ?, ?, ?, ?, ?, 1, ?)
    `);
    
    // Öğrencinin subeId'sini al
    const student = db.prepare('SELECT subeId FROM students WHERE id = ?').get(studentId);
    const subeId = student ? student.subeId : null;
    
    const hashedSifre = bcrypt.hashSync(sifre, 10);
    const info = stmt.run(kullaniciAdi, hashedSifre, veliAdi, telefon, email, studentId, subeId, new Date().toISOString());
    
    // Rastgele şifre üretildiyse dönüşte göster (admin veliye iletebilsin)
    return { id: info.lastInsertRowid, kullaniciAdi, ...(tcNo ? {} : { sifre }) };
  } catch (error) {
    console.error('Veli kullanıcısı oluşturma hatası:', error.message);
    return null;
  }
}

// Öğrenci kaydedildikten sonra aktif dönemler için orantılı borç oluştur
function createProportionalDebtsForNewStudent(studentId, kayitTarihi) {
  try {
    // Öğrencinin şubesini al
    const student = db.prepare('SELECT subeId FROM students WHERE id = ?').get(studentId);
    
    // Aktif dönemleri getir (öğrencinin şubesine ait olanlar)
    let query = "SELECT * FROM payment_periods WHERE durum = 'Aktif'";
    let activePeriods;
    
    if (student && student.subeId) {
      query += " AND (subeId = ? OR subeId IS NULL)";
      activePeriods = db.prepare(query).all(student.subeId);
    } else {
      activePeriods = db.prepare(query).all();
    }
    
    activePeriods.forEach(period => {
      // Kayıt tarihi ile dönem bitiş tarihi arasındaki hafta sayısını hesapla
      const kayitDate = new Date(kayitTarihi);
      const bitisDate = new Date(period.bitisTarihi);
      const baslangicDate = new Date(period.baslangicTarihi);
      
      // Eğer kayıt tarihi dönem bitiş tarihinden sonraysa, bu dönemi atla
      if (kayitDate > bitisDate) return;
      
      // Eğer kayıt tarihi dönem başlangıcından önceyse, tam tutar
      if (kayitDate <= baslangicDate) {
        const stmt = db.prepare(`
          INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
          VALUES (?, ?, ?, 'Borçlu', ?)
        `);
        stmt.run(studentId, period.id, period.tutar, new Date().toISOString());
        return;
      }
      
      // Orantılı hesaplama
      const toplamGun = Math.ceil((bitisDate - baslangicDate) / (1000 * 60 * 60 * 24));
      const kalanGun = Math.ceil((bitisDate - kayitDate) / (1000 * 60 * 60 * 24)) + 1; // +1 kayıt gününü dahil et
      
      const orantiliTutar = (period.tutar * kalanGun) / toplamGun;
      
      // Borç oluştur
      const stmt = db.prepare(`
        INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
        VALUES (?, ?, ?, 'Borçlu', ?)
      `);
      stmt.run(studentId, period.id, Math.round(orantiliTutar * 100) / 100, new Date().toISOString());
    });
    
  } catch (error) {
    console.error('Orantılı borç oluşturma hatası:', error);
  }
}

function updateStudent(id, student) {
  try {
    const stmt = db.prepare(`
     UPDATE students 
    SET ad = ?, soyad = ?, tcNo = ?, dogumTarihi = ?, 
    durum = ?, veliAdi = ?, email = ?, 
    veliTelefon1 = ?, veliTelefon2 = ?, 
    mahalle = ?, okul = ?, kayitKaynagi = ?, ayrilmaTarihi = ?, notlar = ?, groupId = ?
WHERE id = ?
    `);
    
    stmt.run(
      student.ad,
      student.soyad,
      student.tcNo,
      student.dogumTarihi,
      student.durum || 'Aktif',
      student.veliAdi,
      student.email || null,
      student.veliTelefon1,
      student.veliTelefon2 || null,
      student.mahalle,
      student.okul,
      student.kayitKaynagi || null,
      student.ayrilmaTarihi || null,
      student.notlar || null,
      student.groupId || null,
      id
    );
    
    return { id, ...student };
  } catch (error) {
    console.error('UPDATE HATASI:', error.message);
    throw error;
  }
}

function deleteStudent(id) {
  try {
    // Önce öğrenciye bağlı veli kullanıcılarını sil
    const deleteUsersStmt = db.prepare("DELETE FROM users WHERE studentId = ? AND rol = 'veli'");
    deleteUsersStmt.run(id);
    
    // Öğrenciye ait yoklama kayıtlarını sil
    const deleteAttendanceStmt = db.prepare('DELETE FROM attendance_entries WHERE studentId = ?');
    deleteAttendanceStmt.run(id);

    // Öğrenciye ait veli notlarını sil
    const deleteParentNotesStmt = db.prepare('DELETE FROM parent_notes WHERE studentId = ?');
    deleteParentNotesStmt.run(id);

    // Öğrenciye ait eski ödeme kayıtlarını sil
    const deleteLegacyPaymentsStmt = db.prepare('DELETE FROM payments WHERE studentId = ?');
    deleteLegacyPaymentsStmt.run(id);

    // Öğrenciye ait dönem ödemelerini sil
    const deletePaymentsStmt = db.prepare('DELETE FROM student_period_payments WHERE studentId = ?');
    deletePaymentsStmt.run(id);
    
    // Öğrenciye ait durum geçmişini sil
    const deleteHistoryStmt = db.prepare('DELETE FROM student_status_history WHERE studentId = ?');
    deleteHistoryStmt.run(id);
    
    // Sonra öğrenciyi sil
    const stmt = db.prepare('DELETE FROM students WHERE id = ?');
    stmt.run(id);
    
    return { success: true };
  } catch (error) {
    console.error('Öğrenci silme hatası:', error.message);
    throw error;
  }
}

// ============ KULLANICI FONKSİYONLARI ============

function getAllUsers(subeId = null) {
  let query = 'SELECT id, kullaniciAdi, rol, adSoyad, telefon, email, subeId, aktif, olusturmaTarihi FROM users';
  if (subeId) {
    query += ' WHERE subeId = ?';
    const stmt = db.prepare(query + ' ORDER BY id DESC');
    return stmt.all(subeId);
  } else {
    const stmt = db.prepare(query + ' ORDER BY id DESC');
    return stmt.all();
  }
}

function getUserById(id) {
  const stmt = db.prepare('SELECT id, kullaniciAdi, rol, adSoyad, telefon, email, studentId, subeId, aktif, olusturmaTarihi FROM users WHERE id = ?');
  return stmt.get(id);
}

function createUser(user) {
  const hashedSifre = user.sifre ? bcrypt.hashSync(user.sifre, 10) : '';
  const userToInsert = { ...user, sifre: hashedSifre };
  const stmt = db.prepare(`
    INSERT INTO users (kullaniciAdi, sifre, rol, adSoyad, telefon, email, studentId, subeId, aktif, olusturmaTarihi)
    VALUES (@kullaniciAdi, @sifre, @rol, @adSoyad, @telefon, @email, @studentId, @subeId, @aktif, @olusturmaTarihi)
  `);
  const info = stmt.run(userToInsert);
  return { id: info.lastInsertRowid, ...user };
}

function updateUser(id, user) {
  if (user.sifre) {
    const hashedSifre = bcrypt.hashSync(user.sifre, 10);
    const stmt = db.prepare(`
      UPDATE users 
      SET kullaniciAdi = @kullaniciAdi, sifre = @sifre, rol = @rol, adSoyad = @adSoyad, 
          telefon = @telefon, email = @email, aktif = @aktif, subeId = @subeId
      WHERE id = @id
    `);
    stmt.run({ id, ...user, sifre: hashedSifre });
  } else {
    const stmt = db.prepare(`
      UPDATE users 
      SET kullaniciAdi = @kullaniciAdi, rol = @rol, adSoyad = @adSoyad, 
          telefon = @telefon, email = @email, aktif = @aktif, subeId = @subeId
      WHERE id = @id
    `);
    stmt.run({ id, ...user });
  }
  return { id, ...user };
}

function deleteUser(id) {
  // Önce bu kullanıcıya bağlı grup var mı kontrol et
  const groupCheck = db.prepare('SELECT COUNT(*) as count FROM groups WHERE instructorId = ?').get(id);
  
  if (groupCheck.count > 0) {
    throw new Error('Bu antrenör bir veya daha fazla gruba bağlı! Önce grupları başka antrenöre atayın.');
  }
  
  const stmt = db.prepare('DELETE FROM users WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

function getUserByUsername(kullaniciAdi) {
  const stmt = db.prepare('SELECT * FROM users WHERE kullaniciAdi = ?');
  return stmt.get(kullaniciAdi);
}

function updateUserPassword(userId, hashedPassword) {
  db.prepare('UPDATE users SET sifre = ? WHERE id = ?').run(hashedPassword, userId);
}

function getStudentsByParent(parentName, parentPhone) {
  const stmt = db.prepare('SELECT * FROM students WHERE veliAdi = ? OR veliTelefon1 = ?');
  return stmt.all(parentName, parentPhone);
}
// ============ ÖDEME FONKSİYONLARI ============

function getAllPayments() {
  const stmt = db.prepare(`
    SELECT p.*, s.ad, s.soyad 
    FROM payments p
    JOIN students s ON p.studentId = s.id
    ORDER BY p.odemeTarihi DESC
  `);
  return stmt.all();
}

function getPaymentsByStudent(studentId) {
  const stmt = db.prepare('SELECT * FROM payments WHERE studentId = ? ORDER BY odemeTarihi DESC');
  return stmt.all(studentId);
}

function addPayment(payment) {
  const stmt = db.prepare(`
    INSERT INTO payments (studentId, miktar, odemeTipi, donem, donemBaslangic, donemBitis, odemeTarihi, notlar)
    VALUES (@studentId, @miktar, @odemeTipi, @donem, @donemBaslangic, @donemBitis, @odemeTarihi, @notlar)
  `);
  const info = stmt.run(payment);
  return { id: info.lastInsertRowid, ...payment };
}

function deleteLegacyPayment(id) {
  const stmt = db.prepare('DELETE FROM payments WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// ============ AYARLAR FONKSİYONLARI ============

function getSetting(key) {
  const stmt = db.prepare('SELECT deger FROM settings WHERE anahtar = ?');
  const result = stmt.get(key);
  return result ? result.deger : null;
}

function updateSetting(key, value) {
  const stmt = db.prepare('UPDATE settings SET deger = ? WHERE anahtar = ?');
  stmt.run(value, key);
  return { key, value };
}
// ============ GRUP YÖNETİMİ FONKSİYONLARI ============

// Sporcu durumunu değiştir
function changeStudentStatus(studentId, durum, ayrilmaTarihi = null, sebep = null, aciklama = null, degistirenKullanici = null) {
  // Önce mevcut durumu ve grubu al
  const currentStudent = db.prepare('SELECT durum, groupId FROM students WHERE id = ?').get(studentId);
  
 // Durumu güncelle (Pasif oluyorsa gruptan çıkar)
  const stmt = db.prepare(`
    UPDATE students 
    SET durum = ?, ayrilmaTarihi = ?, groupId = ?
    WHERE id = ?
  `);
  const newGroupId = durum === 'Pasif' ? null : currentStudent.groupId || null;
  stmt.run(durum, ayrilmaTarihi, newGroupId, studentId);
  
  // Durum geçmişine kaydet
  const historyStmt = db.prepare(`
    INSERT INTO student_status_history (studentId, eskiDurum, yeniDurum, degisimTarihi, sebep, aciklama, degistirenKullanici, groupId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  historyStmt.run(
    studentId,
    currentStudent.durum,
    durum,
    new Date().toISOString(),
    sebep,
    aciklama,
    degistirenKullanici,
    currentStudent.groupId || null
  );
  
  return { success: true };
}

// Öğrencinin durum geçmişini getir
function getStudentStatusHistory(studentId) {
  const stmt = db.prepare(`
    SELECT * FROM student_status_history 
    WHERE studentId = ? 
    ORDER BY degisimTarihi DESC
  `);
  return stmt.all(studentId);
}

// Aktif öğrencileri getir (şube filtrelemeli)
function getActiveStudents(subeId = null) {
  if (subeId) {
    const stmt = db.prepare("SELECT * FROM students WHERE durum = 'Aktif' AND subeId = ? ORDER BY ad, soyad");
    return stmt.all(subeId);
  }
  const stmt = db.prepare("SELECT * FROM students WHERE durum = 'Aktif' ORDER BY ad, soyad");
  return stmt.all();
}

// Pasif öğrencileri getir (şube filtrelemeli)
function getInactiveStudents(subeId = null) {
  if (subeId) {
    const stmt = db.prepare("SELECT * FROM students WHERE durum != 'Aktif' AND subeId = ? ORDER BY ayrilmaTarihi DESC");
    return stmt.all(subeId);
  }
  const stmt = db.prepare("SELECT * FROM students WHERE durum != 'Aktif' ORDER BY ayrilmaTarihi DESC");
  return stmt.all();
}
// Öğrenci istatistikleri
function getStudentStats(subeId = null) {
  let totalQuery = "SELECT COUNT(*) as count FROM students";
  let activeQuery = "SELECT COUNT(*) as count FROM students WHERE durum = 'Aktif'";
  let inactiveQuery = "SELECT COUNT(*) as count FROM students WHERE durum != 'Aktif'";
  
  if (subeId) {
    totalQuery += " WHERE subeId = ?";
    activeQuery += " AND subeId = ?";
    inactiveQuery += " AND subeId = ?";
    
    const total = db.prepare(totalQuery).get(subeId);
    const active = db.prepare(activeQuery).get(subeId);
    const inactive = db.prepare(inactiveQuery).get(subeId);
    
    return {
      total: total.count,
      active: active.count,
      inactive: inactive.count
    };
  }
  
  const total = db.prepare(totalQuery).get();
  const active = db.prepare(activeQuery).get();
  const inactive = db.prepare(inactiveQuery).get();
  
  return {
    total: total.count,
    active: active.count,
    inactive: inactive.count
  };
}
// ============ ÖDEME DÖNEMLERİ FONKSİYONLARI ============

// Tüm dönemleri getir
function getAllPeriods(subeId = null) {
  let query = 'SELECT * FROM payment_periods';
  if (subeId) {
    query += ' WHERE subeId = ? OR subeId IS NULL';
    const stmt = db.prepare(query + ' ORDER BY baslangicTarihi DESC');
    return stmt.all(subeId);
  } else {
    const stmt = db.prepare(query + ' ORDER BY baslangicTarihi DESC');
    return stmt.all();
  }
}

// Aktif dönemleri getir
function getActivePeriods() {
  const stmt = db.prepare("SELECT * FROM payment_periods WHERE durum = 'Aktif' ORDER BY baslangicTarihi DESC");
  return stmt.all();
}

// Yeni dönem oluştur
function createPeriod(period) {
  const stmt = db.prepare(`
    INSERT INTO payment_periods (donemAdi, baslangicTarihi, bitisTarihi, tutar, subeId, durum, olusturmaTarihi)
    VALUES (@donemAdi, @baslangicTarihi, @bitisTarihi, @tutar, @subeId, @durum, @olusturmaTarihi)
  `);
  const info = stmt.run(period);
  return { id: info.lastInsertRowid, ...period };
}

// Dönem güncelle
function updatePeriod(id, period) {
  // Önce mevcut dönemi al
  const currentPeriod = db.prepare('SELECT * FROM payment_periods WHERE id = ?').get(id);
  
  // Dönemi güncelle
  const stmt = db.prepare(`
    UPDATE payment_periods 
    SET donemAdi = @donemAdi, baslangicTarihi = @baslangicTarihi, 
        bitisTarihi = @bitisTarihi, tutar = @tutar
    WHERE id = @id
  `);
  stmt.run({ id, ...period });
  
  // Eğer dönem aktifse ve tutar değiştiyse, borçlu öğrencilerin tutarını güncelle
  if (currentPeriod.durum === 'Aktif' && currentPeriod.tutar !== period.tutar) {
    const updatePaymentsStmt = db.prepare(`
      UPDATE student_period_payments 
      SET tutar = ?
      WHERE periodId = ? AND odemeDurumu = 'Borçlu'
    `);
    updatePaymentsStmt.run(period.tutar, id);
  }
  
  return { id, ...period };
}

// Dönem sil
function deletePeriod(id) {
  // Önce bu döneme ait ödemeleri sil
  const deletePayments = db.prepare('DELETE FROM student_period_payments WHERE periodId = ?');
  deletePayments.run(id);
  
  // Dönemi sil
  const stmt = db.prepare('DELETE FROM payment_periods WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// Dönem başlatıldığında tüm aktif öğrencilere borç oluştur
function activatePeriod(periodId) {
  const period = db.prepare('SELECT * FROM payment_periods WHERE id = ?').get(periodId);
  
  let query = "SELECT id FROM students WHERE durum = 'Aktif'";
  let activeStudents;
  
  // Eğer dönem bir şubeye aitse, sadece o şubedeki öğrencilere borç oluştur
  if (period.subeId) {
    query += " AND subeId = ?";
    activeStudents = db.prepare(query).all(period.subeId);
  } else {
    activeStudents = db.prepare(query).all();
  }
  
  const stmt = db.prepare(`
    INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
    VALUES (?, ?, ?, 'Borçlu', ?)
  `);
  
  activeStudents.forEach(student => {
    stmt.run(student.id, periodId, period.tutar, new Date().toISOString());
  });
  
  // Dönem durumunu aktif yap
  const updateStmt = db.prepare("UPDATE payment_periods SET durum = 'Aktif' WHERE id = ?");
  updateStmt.run(periodId);
  
  return { success: true, count: activeStudents.length };
}

// Dönem ödeme özeti (raporlar için)
function getPeriodPaymentStats(periodIds, subeId = null) {
  if (!periodIds || periodIds.length === 0) {
    return { totalOdenen: 0, totalBorclu: 0, odenenSayisi: 0, borcluSayisi: 0 };
  }
  const placeholders = periodIds.map(() => '?').join(',');
  let query = `
    SELECT odemeDurumu, COUNT(*) as sayi, SUM(tutar) as toplam
    FROM student_period_payments spp
    JOIN students s ON spp.studentId = s.id
    WHERE spp.periodId IN (${placeholders})
  `;
  const params = [...periodIds];
  if (subeId) {
    query += ' AND s.subeId = ?';
    params.push(subeId);
  }
  query += ' GROUP BY odemeDurumu';
  const rows = db.prepare(query).all(...params);
  let totalOdenen = 0, totalBorclu = 0, odenenSayisi = 0, borcluSayisi = 0;
  rows.forEach(r => {
    if (r.odemeDurumu === 'Ödendi') {
      odenenSayisi = r.sayi;
      totalOdenen = r.toplam || 0;
    } else {
      borcluSayisi = r.sayi;
      totalBorclu = r.toplam || 0;
    }
  });
  return { totalOdenen, totalBorclu, odenenSayisi, borcluSayisi };
}

// Öğrencinin dönem ödeme durumunu getir
function getStudentPeriodPayments(studentId) {
  const stmt = db.prepare(`
    SELECT spp.*, pp.donemAdi, pp.baslangicTarihi, pp.bitisTarihi
    FROM student_period_payments spp
    JOIN payment_periods pp ON spp.periodId = pp.id
    WHERE spp.studentId = ?
    ORDER BY pp.baslangicTarihi DESC
  `);
  return stmt.all(studentId);
}

// Tüm öğrencilerin dönem ödemelerini getir (detaylı)
// subeId verilirse: sadece o şubedeki öğrencilerin, o şubeye ait dönemlerdeki ödemeleri
function getAllStudentPeriodPayments(subeId = null) {
  let query = `
    SELECT 
      spp.*,
      s.ad,
      s.soyad,
      s.subeId,
      s.kayitTarihi,
      s.ayrilmaTarihi,
      (
        SELECT MAX(h.degisimTarihi)
        FROM student_status_history h
        WHERE h.studentId = s.id AND h.yeniDurum = 'Aktif'
      ) AS sonAktifTarihi,
      pp.donemAdi,
      pp.baslangicTarihi,
      pp.bitisTarihi,
      pp.subeId AS periodSubeId
    FROM student_period_payments spp
    JOIN students s ON spp.studentId = s.id
    JOIN payment_periods pp ON spp.periodId = pp.id
  `;
  
  if (subeId) {
    // Her şube sadece kendi dönemlerindeki ödemeleri görsün (öğrenci + dönem aynı şubede)
    query += ' WHERE s.subeId = ? AND pp.subeId = ?';
    const stmt = db.prepare(query + ' ORDER BY pp.baslangicTarihi DESC, s.ad');
    return stmt.all(subeId, subeId);
  } else {
    const stmt = db.prepare(query + ' ORDER BY pp.baslangicTarihi DESC, s.ad');
    return stmt.all();
  }
}

// Ödeme yap
function makePayment(paymentId, paymentData) {
  const stmt = db.prepare(`
    UPDATE student_period_payments 
    SET odemeDurumu = 'Ödendi', odemeTarihi = ?, odemeYontemi = ?, notlar = ?
    WHERE id = ?
  `);
  stmt.run(paymentData.odemeTarihi, paymentData.odemeYontemi, paymentData.notlar, paymentId);
  return { success: true };
}
// Ödeme makbuzu bilgisini getir (veli e-postası dahil)
function getPaymentReceipt(paymentId) {
  const stmt = db.prepare(`
    SELECT spp.*, s.ad, s.soyad, s.tcNo, s.subeId, s.email, s.veliAdi, s.veliTelefon1, s.veliTelefon2, pp.donemAdi, pp.baslangicTarihi, pp.bitisTarihi
    FROM student_period_payments spp
    JOIN students s ON spp.studentId = s.id
    JOIN payment_periods pp ON spp.periodId = pp.id
    WHERE spp.id = ?
  `);
  return stmt.get(paymentId);
}

// ============ ÖN MUHASEBE FONKSİYONLARI ============

function addIncome(income) {
  const stmt = db.prepare(`
    INSERT INTO accounting_incomes (subeId, kaynak, tutar, odemeTarihi, odemeYontemi, aciklama, paymentId, olusturmaTarihi)
    VALUES (@subeId, @kaynak, @tutar, @odemeTarihi, @odemeYontemi, @aciklama, @paymentId, @olusturmaTarihi)
  `);
  const info = stmt.run(income);
  return { id: info.lastInsertRowid, ...income };
}

function deleteIncomeByPaymentId(paymentId) {
  const stmt = db.prepare('DELETE FROM accounting_incomes WHERE paymentId = ?');
  stmt.run(paymentId);
  return { success: true };
}

function getIncomes(subeId = null, startDate = null, endDate = null) {
  let query = 'SELECT * FROM accounting_incomes';
  const params = [];
  const clauses = [];
  if (subeId) {
    clauses.push('subeId = ?');
    params.push(subeId);
  }
  if (startDate) {
    clauses.push('odemeTarihi >= ?');
    params.push(startDate);
  }
  if (endDate) {
    clauses.push('odemeTarihi <= ?');
    params.push(endDate);
  }
  if (clauses.length > 0) {
    query += ' WHERE ' + clauses.join(' AND ');
  }
  query += ' ORDER BY odemeTarihi DESC, id DESC';
  return db.prepare(query).all(...params);
}

function addExpense(expense) {
  const stmt = db.prepare(`
    INSERT INTO accounting_expenses (subeId, kategori, tutar, giderTarihi, aciklama, olusturmaTarihi)
    VALUES (@subeId, @kategori, @tutar, @giderTarihi, @aciklama, @olusturmaTarihi)
  `);
  const info = stmt.run(expense);
  return { id: info.lastInsertRowid, ...expense };
}

function updateExpense(id, expense) {
  const stmt = db.prepare(`
    UPDATE accounting_expenses
    SET kategori = ?, tutar = ?, giderTarihi = ?, aciklama = ?, subeId = ?
    WHERE id = ?
  `);
  stmt.run(
    expense.kategori,
    expense.tutar,
    expense.giderTarihi,
    expense.aciklama || null,
    expense.subeId || null,
    id
  );
  return { id, ...expense };
}

function deleteExpense(id) {
  const stmt = db.prepare('DELETE FROM accounting_expenses WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

function getExpenses(subeId = null, startDate = null, endDate = null) {
  let query = 'SELECT * FROM accounting_expenses';
  const params = [];
  const clauses = [];
  if (subeId) {
    clauses.push('subeId = ?');
    params.push(subeId);
  }
  if (startDate) {
    clauses.push('giderTarihi >= ?');
    params.push(startDate);
  }
  if (endDate) {
    clauses.push('giderTarihi <= ?');
    params.push(endDate);
  }
  if (clauses.length > 0) {
    query += ' WHERE ' + clauses.join(' AND ');
  }
  query += ' ORDER BY giderTarihi DESC, id DESC';
  return db.prepare(query).all(...params);
}
// Ödeme güncelle
function updatePayment(paymentId, paymentData) {
  const stmt = db.prepare(`
    UPDATE student_period_payments 
    SET odemeTarihi = ?, odemeYontemi = ?, notlar = ?
    WHERE id = ?
  `);
  stmt.run(paymentData.odemeTarihi, paymentData.odemeYontemi, paymentData.notlar, paymentId);
  return { success: true };
}

// Dönem ödemesini sil (öğrenci tekrar borçlu olur - satır silinmez, sıfırlanır)
function deletePeriodPayment(paymentId) {
  const stmt = db.prepare(`
    UPDATE student_period_payments 
    SET odemeDurumu = 'Borçlu', odemeTarihi = NULL, odemeYontemi = NULL, notlar = NULL
    WHERE id = ?
  `);
  stmt.run(paymentId);
  return { success: true };
}
// ============ GRUP YÖNETİMİ FONKSİYONLARI ============

// Tüm grupları getir
function getAllGroups(subeId = null) {
  let query = 'SELECT * FROM groups';
  if (subeId) {
    query += ' WHERE subeId = ?';
    const stmt = db.prepare(query + ' ORDER BY durum DESC, groupName');
    return stmt.all(subeId);
  } else {
    const stmt = db.prepare(query + ' ORDER BY durum DESC, groupName');
    return stmt.all();
  }
}

// Aktif grupları getir
function getActiveGroups(subeId = null) {
  let query = "SELECT * FROM groups WHERE durum = 'Aktif'";
  if (subeId) {
    query += " AND subeId = ?";
    const stmt = db.prepare(query + " ORDER BY groupName");
    return stmt.all(subeId);
  } else {
    const stmt = db.prepare(query + " ORDER BY groupName");
    return stmt.all();
  }
}

// Yeni grup oluştur
function createGroup(group) {
  const stmt = db.prepare(`
    INSERT INTO groups (groupName, subeId, instructorId, durum, olusturmaTarihi, notlar)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    group.groupName, 
    group.subeId, 
    group.instructorId || null, 
    'Aktif', 
    group.olusturmaTarihi, 
    group.notlar || null
  );
  return { id: info.lastInsertRowid, ...group };
}

// Grup güncelle
function updateGroup(id, group) {
  const stmt = db.prepare(`
    UPDATE groups 
    SET groupName = ?, instructorId = ?, notlar = ?
    WHERE id = ?
  `);
  stmt.run(group.groupName, group.instructorId || null, group.notlar, id);
  return { id, ...group };
}

// Grup kapat
function closeGroup(id, kapatmaTarihi) {
  const stmt = db.prepare(`
    UPDATE groups 
    SET durum = 'Kapalı', kapanis = ?
    WHERE id = ?
  `);
  stmt.run(kapatmaTarihi, id);
  return { success: true };
}

// Grup getir (ID ile)
function getGroupById(id) {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
}

// Grupta kaç öğrenci var
function getGroupStudentCount(groupId) {
  const stmt = db.prepare("SELECT COUNT(*) as count FROM students WHERE groupId = ? AND durum = 'Aktif'");
  const result = stmt.get(groupId);
  return result.count;
}

// Gruba öğrenci aktar
function transferStudentsToGroup(studentIds, newGroupId) {
  const stmt = db.prepare('UPDATE students SET groupId = ? WHERE id = ?');
  
  studentIds.forEach(studentId => {
    stmt.run(newGroupId, studentId);
  });
  
  return { success: true };
}

// Grup sil
function deleteGroup(id) {
  // Önce grupta öğrenci var mı kontrol et
  const count = getGroupStudentCount(id);
  if (count > 0) {
    throw new Error('Bu grupta öğrenci var! Önce öğrencileri başka gruba aktarın.');
  }
  const deleteAttendanceEntriesStmt = db.prepare(`
    DELETE FROM attendance_entries
    WHERE sessionId IN (SELECT id FROM attendance_sessions WHERE groupId = ?)
  `);
  const deleteAttendanceSessionsStmt = db.prepare(
    'DELETE FROM attendance_sessions WHERE groupId = ?'
  );
  const clearTestGroupStmt = db.prepare(
    'UPDATE test_sessions SET groupId = NULL WHERE groupId = ?'
  );
  const deleteGroupStmt = db.prepare('DELETE FROM groups WHERE id = ?');

  const transaction = db.transaction(() => {
    deleteAttendanceEntriesStmt.run(id);
    deleteAttendanceSessionsStmt.run(id);
    clearTestGroupStmt.run(id);
    deleteGroupStmt.run(id);
  });

  transaction();
  return { success: true };
}
// ============ VELİ NOTLARI FONKSİYONLARI ============

// Veliye özel notları getir
function getParentNotes(parentUserId) {
  const stmt = db.prepare(`
    SELECT pn.*, s.ad, s.soyad 
    FROM parent_notes pn
    LEFT JOIN students s ON pn.studentId = s.id
    WHERE (pn.parentUserId = ? OR pn.isPublic = 1)
    ORDER BY pn.createdAt DESC
  `);
  return stmt.all(parentUserId);
}

// Not ekle
function addParentNote(note) {
  const stmt = db.prepare(`
    INSERT INTO parent_notes (parentUserId, studentId, note, createdBy, createdAt, isPublic)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    note.parentUserId || null,
    note.studentId || null,
    note.note,
    note.createdBy,
    new Date().toISOString(),
    note.isPublic ? 1 : 0
  );
  return { id: info.lastInsertRowid, ...note };
}

function getParentNoteById(id) {
  const stmt = db.prepare('SELECT * FROM parent_notes WHERE id = ?');
  return stmt.get(id);
}

// Not sil
function deleteParentNote(id) {
  const stmt = db.prepare('DELETE FROM parent_notes WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// ============ YOKLAMA FONKSİYONLARI ============

function getAttendanceSession(groupId, date) {
  const stmt = db.prepare(
    'SELECT * FROM attendance_sessions WHERE groupId = ? AND date = ?'
  );
  return stmt.get(groupId, date);
}

function getAttendanceEntries(groupId, date) {
  const session = getAttendanceSession(groupId, date);
  if (!session) return [];
  const stmt = db.prepare(`
    SELECT ae.*, s.ad, s.soyad
    FROM attendance_entries ae
    LEFT JOIN students s ON ae.studentId = s.id
    WHERE ae.sessionId = ?
    ORDER BY s.ad, s.soyad
  `);
  return stmt.all(session.id);
}

function saveAttendance({ groupId, date, instructorId, entries }) {
  const createSessionStmt = db.prepare(`
    INSERT INTO attendance_sessions (groupId, date, instructorId, createdAt)
    VALUES (?, ?, ?, ?)
  `);
  const updateSessionStmt = db.prepare(`
    UPDATE attendance_sessions
    SET instructorId = ?
    WHERE id = ?
  `);
  const deleteEntriesStmt = db.prepare(
    'DELETE FROM attendance_entries WHERE sessionId = ?'
  );
  const insertEntryStmt = db.prepare(`
    INSERT INTO attendance_entries (sessionId, studentId, status, note)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    let session = getAttendanceSession(groupId, date);
    if (!session) {
      const info = createSessionStmt.run(
        groupId,
        date,
        instructorId || null,
        new Date().toISOString()
      );
      session = { id: info.lastInsertRowid };
    } else {
      updateSessionStmt.run(instructorId || null, session.id);
      deleteEntriesStmt.run(session.id);
    }

    entries.forEach(entry => {
      insertEntryStmt.run(
        session.id,
        entry.studentId,
        entry.status,
        entry.note || null
      );
    });

    return { success: true, sessionId: session.id };
  });

  return transaction();
}

function getAttendanceReport(subeId = null, startDate, endDate, groupId = null) {
  const params = [startDate, endDate];
  let groupWhere = 'WHERE s.date BETWEEN ? AND ?';
  if (subeId) {
    groupWhere += ' AND g.subeId = ?';
    params.push(subeId);
  }
  if (groupId) {
    groupWhere += ' AND g.id = ?';
    params.push(groupId);
  }

  const groupRows = db.prepare(`
    SELECT 
      g.id as groupId,
      g.groupName,
      sb.subeAdi,
      COUNT(DISTINCT s.id) as sessionCount,
      SUM(CASE WHEN ae.status = 'Var' THEN 1 ELSE 0 END) as presentCount,
      SUM(CASE WHEN ae.status = 'Yok' THEN 1 ELSE 0 END) as absentCount
    FROM attendance_sessions s
    JOIN groups g ON s.groupId = g.id
    LEFT JOIN subeler sb ON g.subeId = sb.id
    JOIN attendance_entries ae ON ae.sessionId = s.id
    ${groupWhere}
    GROUP BY g.id
    ORDER BY g.groupName
  `).all(...params);

  const studentParams = [startDate, endDate];
  let studentWhere = 'WHERE s.date BETWEEN ? AND ?';
  if (subeId) {
    studentWhere += ' AND g.subeId = ?';
    studentParams.push(subeId);
  }
  if (groupId) {
    studentWhere += ' AND g.id = ?';
    studentParams.push(groupId);
  }

  const studentRows = db.prepare(`
    SELECT 
      st.id as studentId,
      st.ad,
      st.soyad,
      g.groupName,
      sb.subeAdi,
      SUM(CASE WHEN ae.status = 'Var' THEN 1 ELSE 0 END) as presentCount,
      SUM(CASE WHEN ae.status = 'Yok' THEN 1 ELSE 0 END) as absentCount
    FROM attendance_sessions s
    JOIN attendance_entries ae ON ae.sessionId = s.id
    JOIN students st ON ae.studentId = st.id
    JOIN groups g ON s.groupId = g.id
    LEFT JOIN subeler sb ON g.subeId = sb.id
    ${studentWhere}
    GROUP BY st.id
    ORDER BY absentCount DESC, st.ad, st.soyad
  `).all(...studentParams);

  const totals = studentRows.reduce(
    (acc, row) => {
      acc.present += row.presentCount || 0;
      acc.absent += row.absentCount || 0;
      return acc;
    },
    { present: 0, absent: 0 }
  );

  return {
    totals,
    groups: groupRows,
    students: studentRows
  };
}

function getAttendanceMonthlyTrend(subeId = null, startDate, endDate, groupId = null) {
  const params = [startDate, endDate];
  let whereClause = 'WHERE s.date BETWEEN ? AND ?';
  if (subeId) {
    whereClause += ' AND g.subeId = ?';
    params.push(subeId);
  }
  if (groupId) {
    whereClause += ' AND g.id = ?';
    params.push(groupId);
  }

  const rows = db.prepare(`
    SELECT 
      substr(s.date, 1, 7) as month,
      SUM(CASE WHEN ae.status = 'Var' THEN 1 ELSE 0 END) as presentCount,
      SUM(CASE WHEN ae.status = 'Yok' THEN 1 ELSE 0 END) as absentCount
    FROM attendance_sessions s
    JOIN attendance_entries ae ON ae.sessionId = s.id
    JOIN groups g ON s.groupId = g.id
    ${whereClause}
    GROUP BY substr(s.date, 1, 7)
    ORDER BY month
  `).all(...params);

  return rows;
}

// ============ TEST FONKSİYONLARI ============

function createTestSession(session) {
  const insertSessionStmt = db.prepare(`
    INSERT INTO test_sessions (studentId, olcumNo, date, groupId, createdBy, createdRole, notes, aiComment, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMetricStmt = db.prepare(`
    INSERT INTO test_metrics (sessionId, metricKey, label, value, unit, teamAvg, generalAvg)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const info = insertSessionStmt.run(
      session.studentId,
      session.olcumNo || null,
      session.date,
      session.groupId || null,
      session.createdBy || null,
      session.createdRole || null,
      session.notes || null,
      session.aiComment || null,
      new Date().toISOString()
    );

    const sessionId = info.lastInsertRowid;
    (session.metrics || []).forEach(m => {
      insertMetricStmt.run(
        sessionId,
        m.metricKey,
        m.label,
        m.value !== '' && m.value !== null ? m.value : null,
        m.unit || null,
        m.teamAvg !== '' && m.teamAvg !== null ? m.teamAvg : null,
        m.generalAvg !== '' && m.generalAvg !== null ? m.generalAvg : null
      );
    });

    return { success: true, id: sessionId };
  });

  return transaction();
}

function getStudentTests(studentId) {
  const sessions = db.prepare(`
    SELECT * FROM test_sessions
    WHERE studentId = ?
    ORDER BY date DESC, id DESC
  `).all(studentId);

  if (sessions.length === 0) return [];

  const ids = sessions.map(s => s.id);
  const placeholders = ids.map(() => '?').join(',');
  const metrics = db.prepare(`
    SELECT * FROM test_metrics
    WHERE sessionId IN (${placeholders})
    ORDER BY id
  `).all(...ids);

  const metricsBySession = {};
  metrics.forEach(m => {
    if (!metricsBySession[m.sessionId]) metricsBySession[m.sessionId] = [];
    metricsBySession[m.sessionId].push(m);
  });

  return sessions.map(s => ({
    ...s,
    metrics: metricsBySession[s.id] || []
  }));
}

function getTestAverages(groupId = null, date) {
  const generalRows = db.prepare(`
    SELECT metricKey, AVG(value) as avgValue
    FROM test_metrics tm
    JOIN test_sessions ts ON tm.sessionId = ts.id
    WHERE ts.date = ? AND tm.value IS NOT NULL
    GROUP BY metricKey
  `).all(date);

  const generalMap = {};
  generalRows.forEach(r => {
    generalMap[r.metricKey] = r.avgValue;
  });

  if (!groupId) {
    return { team: {}, general: generalMap };
  }

  const teamRows = db.prepare(`
    SELECT metricKey, AVG(value) as avgValue
    FROM test_metrics tm
    JOIN test_sessions ts ON tm.sessionId = ts.id
    WHERE ts.date = ? AND ts.groupId = ? AND tm.value IS NOT NULL
    GROUP BY metricKey
  `).all(date, groupId);

  const teamMap = {};
  teamRows.forEach(r => {
    teamMap[r.metricKey] = r.avgValue;
  });

  return { team: teamMap, general: generalMap };
}

// ============ ŞUBE YÖNETİMİ FONKSİYONLARI ============

// Tüm şubeleri getir
function getAllSubeler() {
  const stmt = db.prepare('SELECT * FROM subeler ORDER BY id');
  return stmt.all();
}

// Aktif şubeleri getir
function getActiveSubeler() {
  const stmt = db.prepare('SELECT * FROM subeler WHERE aktif = 1 ORDER BY subeAdi');
  return stmt.all();
}

// Şube detayı getir
function getSubeById(id) {
  const stmt = db.prepare('SELECT * FROM subeler WHERE id = ?');
  return stmt.get(id);
}

// Yeni şube ekle
function createSube(sube) {
  const stmt = db.prepare(`
    INSERT INTO subeler (subeAdi, adres, telefon, aktif, olusturmaTarihi)
    VALUES (?, ?, ?, 1, ?)
  `);
  const info = stmt.run(sube.subeAdi, sube.adres || null, sube.telefon || null, new Date().toISOString());
  return { id: info.lastInsertRowid, ...sube };
}

// Şube güncelle
function updateSube(id, sube) {
  const stmt = db.prepare(`
    UPDATE subeler 
    SET subeAdi = ?, adres = ?, telefon = ?
    WHERE id = ?
  `);
  stmt.run(sube.subeAdi, sube.adres || null, sube.telefon || null, id);
  return { id, ...sube };
}

// Şube durumunu değiştir (aktif/pasif)
function toggleSubeStatus(id) {
  const stmt = db.prepare(`
    UPDATE subeler 
    SET aktif = CASE WHEN aktif = 1 THEN 0 ELSE 1 END
    WHERE id = ?
  `);
  stmt.run(id);
  return { success: true };
}

// Şube sil (sadece pasif şubeler silinebilir)
function deleteSube(id) {
  // Önce şubenin aktif olup olmadığını kontrol et
  const sube = db.prepare('SELECT aktif FROM subeler WHERE id = ?').get(id);
  
  if (sube && sube.aktif === 1) {
    throw new Error('Aktif şube silinemez! Önce pasif yapın.');
  }
  
  // Şubeye bağlı kayıt var mı kontrol et
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE subeId = ?').get(id);
  const studentCount = db.prepare('SELECT COUNT(*) as count FROM students WHERE subeId = ?').get(id);
  const groupCount = db.prepare('SELECT COUNT(*) as count FROM groups WHERE subeId = ?').get(id);
  
  if (userCount.count > 0 || studentCount.count > 0 || groupCount.count > 0) {
    throw new Error('Bu şubeye bağlı kullanıcı, öğrenci veya grup var! Önce bunları temizleyin.');
  }
  
  // Şubeyi sil
  const stmt = db.prepare('DELETE FROM subeler WHERE id = ?');
  stmt.run(id);
  return { success: true };
}

// Şube istatistikleri
function getSubeStats(subeId) {
  const studentCount = db.prepare("SELECT COUNT(*) as count FROM students WHERE subeId = ?").get(subeId);
  const activeStudents = db.prepare("SELECT COUNT(*) as count FROM students WHERE subeId = ? AND durum = 'Aktif'").get(subeId);
  const groupCount = db.prepare("SELECT COUNT(*) as count FROM groups WHERE subeId = ?").get(subeId);
  const instructorCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE subeId = ? AND rol = 'antrenor'").get(subeId);
  
  return {
    totalStudents: studentCount.count,
    activeStudents: activeStudents.count,
    groups: groupCount.count,
    instructors: instructorCount.count
  };
}

function getReportSummary(subeId, startDate, endDate) {
  const params = [];
  let studentQuery = 'SELECT id, dogumTarihi, okul, mahalle, groupId, kayitTarihi, kayitKaynagi FROM students';
  if (subeId) {
    studentQuery += ' WHERE subeId = ?';
    params.push(subeId);
  }
  const students = db.prepare(studentQuery).all(...params);

  const ageStats = {};
  const schoolStats = {};
  const mahalleStats = {};
  const sourceStats = {};
  const start = new Date(startDate);
  const end = new Date(endDate);

  students.forEach(s => {
    if (s.dogumTarihi) {
      const birth = new Date(s.dogumTarihi);
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

    if (s.kayitTarihi) {
      const kayitDate = new Date(s.kayitTarihi);
      if (kayitDate >= start && kayitDate <= end) {
        const sourceKey = s.kayitKaynagi || '-';
        sourceStats[sourceKey] = (sourceStats[sourceKey] || 0) + 1;
      }
    }
  });

  const groupParams = [];
  let groupQuery = `
    SELECT g.id, g.groupName, g.instructorId, u.adSoyad as instructorName, u.subeId as instructorSubeId, sb.subeAdi as instructorSubeAdi
    FROM groups g
    LEFT JOIN users u ON g.instructorId = u.id
    LEFT JOIN subeler sb ON u.subeId = sb.id
  `;
  if (subeId) {
    groupQuery += ' WHERE g.subeId = ?';
    groupParams.push(subeId);
  }
  const groups = db.prepare(groupQuery).all(...groupParams);

  const groupIds = groups.map(g => g.id);
  const groupIdPlaceholders = groupIds.map(() => '?').join(',');

  const groupStats = [];
  const instructorStatsMap = {};

  let studentCounts = {};
  let registrationCounts = {};
  let inactiveCounts = {};

  if (groupIds.length > 0) {
    const studentCountRows = db.prepare(
      `SELECT groupId, COUNT(*) as count FROM students WHERE groupId IN (${groupIdPlaceholders}) AND durum = 'Aktif' GROUP BY groupId`
    ).all(...groupIds);
    studentCounts = Object.fromEntries(studentCountRows.map(r => [r.groupId, r.count]));

    const registrationRows = db.prepare(
      `SELECT groupId, COUNT(*) as count FROM students WHERE groupId IN (${groupIdPlaceholders}) AND kayitTarihi BETWEEN ? AND ? GROUP BY groupId`
    ).all(...groupIds, startDate, endDate);
    registrationCounts = Object.fromEntries(registrationRows.map(r => [r.groupId, r.count]));

    const inactiveRows = db.prepare(
      `SELECT groupId, COUNT(*) as count FROM student_status_history WHERE yeniDurum = 'Pasif' AND groupId IN (${groupIdPlaceholders}) AND degisimTarihi BETWEEN ? AND ? GROUP BY groupId`
    ).all(...groupIds, startDate, endDate);
    inactiveCounts = Object.fromEntries(inactiveRows.map(r => [r.groupId, r.count]));
  }

  groups.forEach(group => {
    const stats = {
      groupId: group.id,
      groupName: group.groupName,
      instructorId: group.instructorId,
      instructorName: group.instructorName || 'Atanmamış',
      instructorSubeAdi: group.instructorSubeAdi || null,
      studentCount: studentCounts[group.id] || 0,
      registrations: registrationCounts[group.id] || 0,
      inactives: inactiveCounts[group.id] || 0
    };
    groupStats.push(stats);

    if (!instructorStatsMap[stats.instructorId || 'none']) {
      instructorStatsMap[stats.instructorId || 'none'] = {
        instructorName: stats.instructorName,
        instructorSubeAdi: stats.instructorSubeAdi,
        groupCount: 0,
        studentCount: 0,
        registrations: 0,
        inactives: 0
      };
    }

    const acc = instructorStatsMap[stats.instructorId || 'none'];
    acc.groupCount += 1;
    acc.studentCount += stats.studentCount;
    acc.registrations += stats.registrations;
    acc.inactives += stats.inactives;
  });

  const instructorStats = Object.values(instructorStatsMap).sort(
    (a, b) => b.groupCount - a.groupCount
  );

  return {
    ageStats,
    schoolStats,
    mahalleStats,
    sourceStats,
    groupStats,
    instructorStats
  };
}

function getStudentPeriodStats(subeId, startDate, endDate) {
  let totalQuery = 'SELECT COUNT(*) as count FROM students';
  let regQuery = 'SELECT COUNT(*) as count FROM students WHERE kayitTarihi BETWEEN ? AND ?';
  let inactiveQuery = "SELECT COUNT(*) as count FROM student_status_history WHERE yeniDurum = 'Pasif' AND degisimTarihi BETWEEN ? AND ?";

  const totalParams = [];
  const periodParams = [startDate, endDate];

  if (subeId) {
    totalQuery += ' WHERE subeId = ?';
    regQuery += ' AND subeId = ?';
    inactiveQuery += ' AND studentId IN (SELECT id FROM students WHERE subeId = ?)';
    totalParams.push(subeId);
    periodParams.push(subeId);
  }

  const total = db.prepare(totalQuery).get(...totalParams);
  const registrations = db.prepare(regQuery).get(...periodParams);
  const inactives = db.prepare(inactiveQuery).get(...periodParams);

  return {
    totalStudents: total ? total.count : 0,
    registrations: registrations ? registrations.count : 0,
    inactives: inactives ? inactives.count : 0
  };
}

function getInstructorReport(instructorId, startDate, endDate) {
  const groups = db.prepare(
    'SELECT id, durum FROM groups WHERE instructorId = ?'
  ).all(instructorId);

  const groupIds = groups.map(g => g.id);
  const activeGroupIds = groups.filter(g => g.durum === 'Aktif').map(g => g.id);

  const groupIdPlaceholders = groupIds.map(() => '?').join(',');
  const activeGroupIdPlaceholders = activeGroupIds.map(() => '?').join(',');

  const activeGroupCount = activeGroupIds.length;

  let activeStudentCount = 0;
  if (activeGroupIds.length > 0) {
    const row = db.prepare(
      `SELECT COUNT(*) as count FROM students WHERE durum = 'Aktif' AND groupId IN (${activeGroupIdPlaceholders})`
    ).get(...activeGroupIds);
    activeStudentCount = row ? row.count : 0;
  }

  let registrations = 0;
  let inactives = 0;

  if (groupIds.length > 0) {
    const regRow = db.prepare(
      `SELECT COUNT(*) as count FROM students WHERE groupId IN (${groupIdPlaceholders}) AND kayitTarihi BETWEEN ? AND ?`
    ).get(...groupIds, startDate, endDate);
    registrations = regRow ? regRow.count : 0;

    const inactiveRow = db.prepare(
      `SELECT COUNT(*) as count FROM student_status_history WHERE yeniDurum = 'Pasif' AND groupId IN (${groupIdPlaceholders}) AND degisimTarihi BETWEEN ? AND ?`
    ).get(...groupIds, startDate, endDate);
    inactives = inactiveRow ? inactiveRow.count : 0;
  }

  return {
    activeGroupCount,
    activeStudentCount,
    registrations,
    inactives
  };
}

// Geri dönen öğrenci için orantılı borç oluştur (duplicate kontrolü ile)
function createProportionalDebtsForReturningStudent(studentId, dönüsTarihi) {
  try {
    const student = db.prepare('SELECT subeId FROM students WHERE id = ?').get(studentId);
    
    let query = "SELECT * FROM payment_periods WHERE durum = 'Aktif'";
    let activePeriods;
    
    if (student && student.subeId) {
      query += " AND (subeId = ? OR subeId IS NULL)";
      activePeriods = db.prepare(query).all(student.subeId);
    } else {
      activePeriods = db.prepare(query).all();
    }
    
    activePeriods.forEach(period => {
      // Bu dönem için zaten borç var mı kontrol et
      const existingDebt = db.prepare(
        'SELECT id FROM student_period_payments WHERE studentId = ? AND periodId = ?'
      ).get(studentId, period.id);
      
      if (existingDebt) {
        return; // Borç zaten var, atla
      }
      
      const donusDate = new Date(dönüsTarihi);
      const bitisDate = new Date(period.bitisTarihi);
      const baslangicDate = new Date(period.baslangicTarihi);
      
      // Dönem bitmişse atla
      if (donusDate > bitisDate) return;
      
      let orantiliTutar = period.tutar;
      
      // Eğer dönüş tarihi dönem içindeyse orantılı hesapla
      if (donusDate > baslangicDate) {
        const toplamGun = Math.ceil((bitisDate - baslangicDate) / (1000 * 60 * 60 * 24));
        const kalanGun = Math.ceil((bitisDate - donusDate) / (1000 * 60 * 60 * 24)) + 1;
        orantiliTutar = (period.tutar * kalanGun) / toplamGun;
      }
      
      // Borç oluştur
      const stmt = db.prepare(`
        INSERT INTO student_period_payments (studentId, periodId, tutar, odemeDurumu, olusturmaTarihi)
        VALUES (?, ?, ?, 'Borçlu', ?)
      `);
      stmt.run(studentId, period.id, Math.round(orantiliTutar * 100) / 100, new Date().toISOString());
    });
    
  } catch (error) {
    console.error('Geri dönen öğrenci için borç oluşturma hatası:', error);
  }
}

module.exports = {
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

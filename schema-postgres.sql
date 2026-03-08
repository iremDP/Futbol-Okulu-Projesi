-- Futbol Okulu - PostgreSQL Şeması
-- Yüksek ölçek (on binlerce öğrenci/veli) için optimize edilmiş

-- Şubeler
CREATE TABLE IF NOT EXISTS subeler (
  id SERIAL PRIMARY KEY,
  subeAdi VARCHAR(255) UNIQUE NOT NULL,
  adres TEXT,
  telefon VARCHAR(50),
  aktif SMALLINT DEFAULT 1,
  olusturmaTarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subeler_aktif ON subeler(aktif);

-- Öğrenciler
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  ad VARCHAR(255) NOT NULL,
  soyad VARCHAR(255) NOT NULL,
  tcNo VARCHAR(20),
  dogumTarihi DATE NOT NULL,
  durum VARCHAR(20) DEFAULT 'Aktif',
  veliAdi VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  veliTelefon1 VARCHAR(50) NOT NULL,
  veliTelefon2 VARCHAR(50),
  mahalle VARCHAR(255),
  okul VARCHAR(255),
  kayitKaynagi VARCHAR(255),
  kayitTarihi TIMESTAMPTZ NOT NULL,
  ayrilmaTarihi DATE,
  notlar TEXT,
  groupId INTEGER,
  subeId INTEGER REFERENCES subeler(id)
);
CREATE INDEX IF NOT EXISTS idx_students_subeId ON students(subeId);
CREATE INDEX IF NOT EXISTS idx_students_durum ON students(durum);
CREATE INDEX IF NOT EXISTS idx_students_groupId ON students(groupId);
CREATE INDEX IF NOT EXISTS idx_students_veliTelefon ON students(veliTelefon1);
CREATE INDEX IF NOT EXISTS idx_students_kayitTarihi ON students(kayitTarihi);

-- Kullanıcılar
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  kullaniciAdi VARCHAR(255) UNIQUE NOT NULL,
  sifre VARCHAR(255) NOT NULL,
  rol VARCHAR(50) NOT NULL,
  adSoyad VARCHAR(255) NOT NULL,
  telefon VARCHAR(50),
  email VARCHAR(255),
  studentId INTEGER REFERENCES students(id),
  subeId INTEGER REFERENCES subeler(id),
  aktif SMALLINT DEFAULT 1,
  olusturmaTarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_kullaniciAdi ON users(kullaniciAdi);
CREATE INDEX IF NOT EXISTS idx_users_rol ON users(rol);
CREATE INDEX IF NOT EXISTS idx_users_subeId ON users(subeId);

-- Gruplar
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  groupName VARCHAR(255) NOT NULL,
  subeId INTEGER REFERENCES subeler(id),
  instructorId INTEGER REFERENCES users(id),
  durum VARCHAR(20) DEFAULT 'Aktif',
  olusturmaTarihi TIMESTAMPTZ,
  kapanis VARCHAR(50),
  notlar TEXT
);
CREATE INDEX IF NOT EXISTS idx_groups_subeId ON groups(subeId);
CREATE INDEX IF NOT EXISTS idx_groups_durum ON groups(durum);

-- Ödemeler (eski)
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  studentId INTEGER NOT NULL REFERENCES students(id),
  miktar DECIMAL(12,2) NOT NULL,
  odemeTipi VARCHAR(50) NOT NULL,
  donem VARCHAR(100) NOT NULL,
  donemBaslangic DATE NOT NULL,
  donemBitis DATE NOT NULL,
  odemeTarihi DATE NOT NULL,
  notlar TEXT
);

-- Ayarlar
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  anahtar VARCHAR(100) UNIQUE NOT NULL,
  deger TEXT NOT NULL
);

-- Ödeme dönemleri
CREATE TABLE IF NOT EXISTS payment_periods (
  id SERIAL PRIMARY KEY,
  donemAdi VARCHAR(255) NOT NULL,
  baslangicTarihi DATE NOT NULL,
  bitisTarihi DATE NOT NULL,
  tutar DECIMAL(12,2) NOT NULL,
  durum VARCHAR(20) DEFAULT 'Bekliyor',
  subeId INTEGER REFERENCES subeler(id),
  olusturmaTarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_periods_subeId ON payment_periods(subeId);
CREATE INDEX IF NOT EXISTS idx_payment_periods_durum ON payment_periods(durum);

-- Öğrenci dönem ödemeleri
CREATE TABLE IF NOT EXISTS student_period_payments (
  id SERIAL PRIMARY KEY,
  studentId INTEGER NOT NULL REFERENCES students(id),
  periodId INTEGER NOT NULL REFERENCES payment_periods(id),
  tutar DECIMAL(12,2) NOT NULL,
  odemeDurumu VARCHAR(20) DEFAULT 'Borçlu',
  odemeTarihi DATE,
  odemeYontemi VARCHAR(50),
  notlar TEXT,
  olusturmaTarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spp_studentId ON student_period_payments(studentId);
CREATE INDEX IF NOT EXISTS idx_spp_periodId ON student_period_payments(periodId);
CREATE INDEX IF NOT EXISTS idx_spp_odemeDurumu ON student_period_payments(odemeDurumu);

-- Veli notları
CREATE TABLE IF NOT EXISTS parent_notes (
  id SERIAL PRIMARY KEY,
  parentUserId INTEGER REFERENCES users(id),
  studentId INTEGER REFERENCES students(id),
  note TEXT NOT NULL,
  createdBy VARCHAR(255) NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isPublic SMALLINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_parent_notes_parentUserId ON parent_notes(parentUserId);

-- Yoklama
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id SERIAL PRIMARY KEY,
  groupId INTEGER NOT NULL REFERENCES groups(id),
  date DATE NOT NULL,
  instructorId INTEGER REFERENCES users(id),
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(groupId, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_groupId ON attendance_sessions(groupId);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date ON attendance_sessions(date);

CREATE TABLE IF NOT EXISTS attendance_entries (
  id SERIAL PRIMARY KEY,
  sessionId INTEGER NOT NULL REFERENCES attendance_sessions(id),
  studentId INTEGER NOT NULL REFERENCES students(id),
  status VARCHAR(20) NOT NULL,
  note TEXT,
  UNIQUE(sessionId, studentId)
);
CREATE INDEX IF NOT EXISTS idx_attendance_entries_sessionId ON attendance_entries(sessionId);

-- Performans testleri
CREATE TABLE IF NOT EXISTS test_sessions (
  id SERIAL PRIMARY KEY,
  studentId INTEGER NOT NULL REFERENCES students(id),
  olcumNo INTEGER,
  date DATE NOT NULL,
  groupId INTEGER REFERENCES groups(id),
  createdBy INTEGER REFERENCES users(id),
  createdRole VARCHAR(50),
  notes TEXT,
  aiComment TEXT,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_test_sessions_studentId ON test_sessions(studentId);
CREATE INDEX IF NOT EXISTS idx_test_sessions_date ON test_sessions(date);

CREATE TABLE IF NOT EXISTS test_metrics (
  id SERIAL PRIMARY KEY,
  sessionId INTEGER NOT NULL REFERENCES test_sessions(id),
  metricKey VARCHAR(50) NOT NULL,
  label VARCHAR(255) NOT NULL,
  value DECIMAL(10,2),
  unit VARCHAR(20),
  teamAvg DECIMAL(10,2),
  generalAvg DECIMAL(10,2)
);
CREATE INDEX IF NOT EXISTS idx_test_metrics_sessionId ON test_metrics(sessionId);

-- Öğrenci durum geçmişi
CREATE TABLE IF NOT EXISTS student_status_history (
  id SERIAL PRIMARY KEY,
  studentId INTEGER NOT NULL REFERENCES students(id),
  eskiDurum VARCHAR(20) NOT NULL,
  yeniDurum VARCHAR(20) NOT NULL,
  degisimTarihi TIMESTAMPTZ NOT NULL,
  sebep TEXT,
  aciklama TEXT,
  degistirenKullanici VARCHAR(255),
  groupId INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ssh_studentId ON student_status_history(studentId);
CREATE INDEX IF NOT EXISTS idx_ssh_degisimTarihi ON student_status_history(degisimTarihi);

-- Muhasebe
CREATE TABLE IF NOT EXISTS accounting_incomes (
  id SERIAL PRIMARY KEY,
  subeId INTEGER REFERENCES subeler(id),
  kaynak VARCHAR(255) NOT NULL,
  tutar DECIMAL(12,2) NOT NULL,
  odemeTarihi DATE NOT NULL,
  odemeYontemi VARCHAR(50),
  aciklama TEXT,
  paymentId INTEGER,
  olusturmaTarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incomes_subeId ON accounting_incomes(subeId);
CREATE INDEX IF NOT EXISTS idx_incomes_odemeTarihi ON accounting_incomes(odemeTarihi);

CREATE TABLE IF NOT EXISTS accounting_expenses (
  id SERIAL PRIMARY KEY,
  subeId INTEGER REFERENCES subeler(id),
  kategori VARCHAR(255) NOT NULL,
  tutar DECIMAL(12,2) NOT NULL,
  giderTarihi DATE NOT NULL,
  aciklama TEXT,
  olusturmaTarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_subeId ON accounting_expenses(subeId);
CREATE INDEX IF NOT EXISTS idx_expenses_giderTarihi ON accounting_expenses(giderTarihi);

-- Varsayılan veriler (tablo boşsa)
INSERT INTO subeler (subeAdi, aktif, olusturmaTarihi) 
SELECT 'Meydan Şube', 1, NOW() WHERE NOT EXISTS (SELECT 1 FROM subeler WHERE subeAdi = 'Meydan Şube');
INSERT INTO subeler (subeAdi, aktif, olusturmaTarihi) 
SELECT 'Liman Şube', 1, NOW() WHERE NOT EXISTS (SELECT 1 FROM subeler WHERE subeAdi = 'Liman Şube');
INSERT INTO subeler (subeAdi, aktif, olusturmaTarihi) 
SELECT 'Lara Şube', 1, NOW() WHERE NOT EXISTS (SELECT 1 FROM subeler WHERE subeAdi = 'Lara Şube');

INSERT INTO settings (anahtar, deger) VALUES 
  ('donemUcreti', '3400'),
  ('donemSuresi', '28')
ON CONFLICT (anahtar) DO NOTHING;

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('./db');
const auth = require('./auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    const ext = (file.originalname || '').toLowerCase();
    const isExcelExt = ext.endsWith('.xlsx') || ext.endsWith('.xls');
    if (allowed.includes(file.mimetype) && (isExcelExt || !file.originalname)) cb(null, true);
    else cb(new Error('Sadece Excel dosyaları (.xlsx, .xls) kabul edilir'));
  }
});

let mailTransporter = null;
function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpHost || !smtpUser || !smtpPass) return null;
  mailTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: smtpUser, pass: smtpPass }
  });
  return mailTransporter;
}

function getPdfFontPath() {
  const candidates = [
    path.join(__dirname, 'fonts', 'DejaVuSans.ttf'),
    path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const windowsFont = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf');
  if (fs.existsSync(windowsFont)) return windowsFont;
  return null;
}

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const safeErrorMsg = (msg) => isProduction ? 'Bir hata oluştu' : msg;

function safeParseId(val) {
  const id = parseInt(val, 10);
  return (isNaN(id) || id < 1) ? null : id;
}

/** Query param'dan güvenli subeId/instructorId/groupId parse */
function safeQueryId(val) {
  if (val === undefined || val === null || val === '') return null;
  return safeParseId(val);
}

/** Mass assignment koruması - sadece izin verilen alanları al */
function pickAllowed(body, allowedFields) {
  if (!body || typeof body !== 'object') return {};
  const result = {};
  for (const f of allowedFields) {
    if (body[f] !== undefined) result[f] = body[f];
  }
  return result;
}

// Güvenlik middleware - CSP XSS son savunma hattı
// script-src-attr: inline event handler'lar (onclick vb.) için gerekli - HTML'de kullanılıyor
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      "script-src-attr": ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"]
    }
  }
}));
if (isProduction && !process.env.CORS_ORIGIN) {
  console.error('FATAL: Production\'da CORS_ORIGIN ortam değişkeni zorunludur!');
  process.exit(1);
}
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : true,
  credentials: true
}));
// Login rate limit - body parse'dan ÖNCE (geçersiz JSON ile bypass engeli)
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/login') return loginLimiter(req, res, next);
  next();
});
app.use(bodyParser.json({ limit: '1mb' }));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static('public'));

// HTTPS zorlaması (production'da reverse proxy arkasında)
if (isProduction) {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
    }
    next();
  });
}

// Genel API rate limiting (DoS koruması)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Çok fazla istek. Lütfen biraz bekleyin.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// Login rate limiting - IP + kullanıcı adı bazlı (dağıtık brute force'a karşı)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const un = (req.body?.kullaniciAdi || '').trim().toLowerCase();
    return un ? `login:${un}` : req.ip;
  }
});

// E-posta gönderim rate limiting (makbuz spam koruması)
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Çok fazla e-posta gönderimi. Lütfen bekleyin.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Token doğrulamasında kullanıcı aktiflik kontrolü (silinen/devre dışı hesaplar)
auth.setCheckUserActive(async (userId) => {
  try {
    const user = await db.getUserById(userId);
    return user && (user.aktif === 1 || user.aktif === true);
  } catch {
    return true;
  }
});

// API kimlik doğrulama - /api/login ve /api/health hariç tüm /api istekleri için
app.use((req, res, next) => {
  if ((req.originalUrl === '/api/login' && req.method === 'POST') || req.originalUrl === '/api/health') return next();
  if (req.originalUrl.startsWith('/api/')) return auth.verifyToken(req, res, next);
  next();
});

// Yönetici şube izolasyonu - yönetici sadece kendi şubesinin verisini görebilir
app.use((req, res, next) => {
  req.effectiveSubeId = (req.user?.rol === 'yonetici' && req.user?.subeId) ? req.user.subeId : null;
  next();
});

// Ana sayfa
app.get('/', (req, res) => {
  res.send('Futbol Okulu API Çalışıyor! 🎉');
});

// Health check (hosting/monitoring için)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Tüm öğrencileri getir (şube filtrelemeli)
app.get('/api/students', auth.requireStaff, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const students = await db.getAllStudents(subeId);
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Yeni öğrenci ekle
const STUDENT_CREATE_FIELDS = ['ad', 'soyad', 'tcNo', 'dogumTarihi', 'veliAdi', 'email', 'veliTelefon1', 'veliTelefon2', 'mahalle', 'okul', 'kayitKaynagi', 'groupId', 'subeId'];
app.post('/api/students', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const body = pickAllowed(req.body, STUDENT_CREATE_FIELDS);
    const student = {
      ...body,
      kayitTarihi: new Date().toISOString(),
      subeId: req.effectiveSubeId ?? body.subeId ?? null
    };
    const newStudent = await db.addStudent(student);
    res.json(newStudent);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Excel'den öğrenci içe aktar
// Beklenen sütunlar (büyük/küçük harf esnek): Ad, Soyad, TC/TC No, Doğum Tarihi, Veli Adı, Veli Telefon/Telefon, E-posta, Mahalle, Okul, Şube, Grup, Kayıt Kaynağı
app.post('/api/students/import', auth.requireAdminOrYonetici, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message === 'LIMIT_FILE_SIZE' ? 'Dosya boyutu 5MB\'ı aşamaz' : err.message });
    }
    if (err) return res.status(400).json({ error: err.message || 'Dosya yükleme hatası' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Excel dosyası yükleyin.' });
    }
    const subeler = await db.getActiveSubeler();
    const groups = await db.getAllGroups(null);
    const effectiveSubeId = req.effectiveSubeId;

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) {
      return res.status(400).json({ error: 'Excel dosyasında en az 1 veri satırı olmalı (ilk satır başlık).' });
    }
    const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
    const col = (name) => {
      const aliases = {
        ad: ['ad', 'adi', 'adı', 'isim', 'öğrenci adı'],
        soyad: ['soyad', 'soyadi', 'soyadı', 'soy isim'],
        tc: ['tc', 'tc no', 'tcno', 'tckn', 'kimlik'],
        dogumtarihi: ['doğum tarihi', 'dogum tarihi', 'dogumtarihi', 'doğum', 'birth'],
        veliadi: ['veli adı', 'veli adi', 'veliadi', 'veli', 'anne', 'baba'],
        telefon: ['veli telefon', 'telefon', 'veli telefon1', 'velitelefon', 'tel', 'gsm'],
        email: ['e-posta', 'email', 'eposta', 'mail'],
        mahalle: ['mahalle'],
        okul: ['okul', 'okul adı'],
        sube: ['şube', 'sube', 'şube adı', 'sube adi'],
        grup: ['grup', 'grup adı', 'grup adi', 'group'],
        kayitkaynagi: ['kayıt kaynağı', 'kayit kaynagi', 'kaynak']
      };
      const keys = aliases[name] || [name];
      for (const k of keys) {
        const i = headers.findIndex(h => (h && (h.includes(k) || k.includes(h))));
        if (i >= 0) return i;
      }
      return -1;
    };

    const results = { imported: 0, errors: [], parentCredentials: [] };
    const today = new Date().toISOString().split('T')[0];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => c === '' || c == null)) continue;
      const get = (idx) => (idx >= 0 && row[idx] != null ? String(row[idx]).trim() : '');
      const ad = get(col('ad'));
      const soyad = get(col('soyad'));
      const veliAdi = get(col('veliadi')) || (ad + ' ' + soyad);
      const veliTelefon1 = get(col('telefon'));
      const mahalle = get(col('mahalle'));
      const okul = get(col('okul'));
      const grupAdi = get(col('grup'));
      if (!ad || !soyad || !veliTelefon1) {
        results.errors.push({ row: i + 1, msg: 'Ad, Soyad ve Veli Telefon zorunludur.' });
        continue;
      }
      if (!mahalle || !okul) {
        results.errors.push({ row: i + 1, msg: 'Mahalle ve Okul zorunludur.' });
        continue;
      }
      let subeId = effectiveSubeId;
      if (!subeId) {
        const subeAdi = get(col('sube'));
        if (subeAdi) {
          const sube = subeler.find(s => (s.subeAdi || '').toLowerCase() === subeAdi.toLowerCase());
          subeId = sube ? sube.id : null;
        }
      }
      if (!grupAdi) {
        results.errors.push({ row: i + 1, msg: 'Grup zorunludur.' });
        continue;
      }
      if (!subeId) {
        results.errors.push({ row: i + 1, msg: 'Şube zorunludur. (Admin için Excel\'de Şube sütununu doldurun)' });
        continue;
      }
      const grp = groups.find(g => g.subeId == subeId && (g.groupName || '').toLowerCase() === grupAdi.toLowerCase());
      const groupId = grp ? grp.id : null;
      if (!groupId) {
        results.errors.push({ row: i + 1, msg: `Grup "${grupAdi}" bulunamadı. Önce grupları oluşturun.` });
        continue;
      }
      const dogumStr = get(col('dogumtarihi'));
      let dogumTarihi = dogumStr;
      if (dogumStr) {
        const d = new Date(dogumStr);
        if (!isNaN(d.getTime())) dogumTarihi = d.toISOString().split('T')[0];
      }
      if (!dogumTarihi) dogumTarihi = today;

      const student = {
        ad,
        soyad,
        tcNo: get(col('tc')) || null,
        dogumTarihi,
        veliAdi,
        email: get(col('email')) || null,
        veliTelefon1: veliTelefon1.replace(/\D/g, '').length >= 10 ? veliTelefon1 : veliTelefon1,
        veliTelefon2: null,
        mahalle,
        okul,
        kayitKaynagi: get(col('kayitkaynagi')) || 'Diğer',
        kayitTarihi: today,
        groupId,
        subeId
      };
      try {
        const added = await db.addStudent(student);
        results.imported++;
        if (added.parentCredentials && added.parentCredentials.sifre) {
          results.parentCredentials.push({
            row: i + 1,
            ogrenci: `${ad} ${soyad}`,
            kullaniciAdi: added.parentCredentials.kullaniciAdi,
            sifre: added.parentCredentials.sifre
          });
        }
      } catch (err) {
        results.errors.push({ row: i + 1, msg: err.message || 'Kayıt hatası' });
      }
    }
    res.json({ success: true, ...results });
  } catch (error) {
    console.error('Import hatası:', error);
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Excel şablonu indir
app.get('/api/students/import-template', auth.requireAdminOrYonetici, (req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Ad', 'Soyad', 'TC No', 'Doğum Tarihi', 'Veli Adı', 'Veli Telefon', 'E-posta', 'Mahalle', 'Okul', 'Şube', 'Grup', 'Kayıt Kaynağı'],
    ['Ahmet', 'Yılmaz', '12345678901', '2015-03-15', '', '0532 111 22 33', 'veli@ornek.com', 'Merkez Mahallesi', 'ABC İlkokulu', 'Meydan Şube', '2015 17:00', 'Diğer']
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Öğrenciler');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=ogrenci-sablon.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Öğrenci güncelle
app.put('/api/students/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    if (req.effectiveSubeId) {
      const student = await db.getStudentById(id);
      if (!student || student.subeId != req.effectiveSubeId) {
        return res.status(403).json({ error: 'Bu öğrenciye erişim yetkiniz yok' });
      }
    }
    const STUDENT_UPDATE_FIELDS = ['ad', 'soyad', 'tcNo', 'dogumTarihi', 'durum', 'veliAdi', 'email', 'veliTelefon1', 'veliTelefon2', 'mahalle', 'okul', 'kayitKaynagi', 'ayrilmaTarihi', 'notlar', 'groupId'];
    const updatedStudent = await db.updateStudent(id, pickAllowed(req.body, STUDENT_UPDATE_FIELDS));
    res.json(updatedStudent);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Öğrenci sil
app.delete('/api/students/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    if (req.effectiveSubeId) {
      const student = await db.getStudentById(id);
      if (!student || student.subeId != req.effectiveSubeId) {
        return res.status(403).json({ error: 'Bu öğrenciye erişim yetkiniz yok' });
      }
    }
    await db.deleteStudent(id);
    res.json({ message: 'Öğrenci silindi' });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});
// Sporcu durumunu değiştir
app.put('/api/students/:id/status', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    if (req.effectiveSubeId) {
      const student = await db.getStudentById(id);
      if (!student || student.subeId != req.effectiveSubeId) {
        return res.status(403).json({ error: 'Bu öğrenciye erişim yetkiniz yok' });
      }
    }
    const allowed = pickAllowed(req.body || {}, ['durum', 'ayrilmaTarihi', 'sebep', 'aciklama', 'degistirenKullanici']);
    const { durum, ayrilmaTarihi, sebep, aciklama, degistirenKullanici } = allowed;
    await db.changeStudentStatus(id, durum, ayrilmaTarihi, sebep, aciklama, degistirenKullanici);
    res.json({ success: true, message: 'Durum güncellendi' });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Öğrencinin durum geçmişini getir
app.get('/api/students/:id/status-history', auth.requireStaff, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const history = await db.getStudentStatusHistory(id);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});


// Aktif öğrencileri getir
app.get('/api/students/active', auth.requireStaff, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const students = await db.getActiveStudents(subeId);
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Pasif öğrencileri getir
app.get('/api/students/inactive', auth.requireStaff, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const students = await db.getInactiveStudents(subeId);
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});
/// ============ KULLANICI YÖNETİMİ API ============

// Giriş yap (rate limit uygulanır)
app.post('/api/login', async (req, res) => {
  try {
    const { kullaniciAdi, sifre } = req.body || {};
    if (!kullaniciAdi || !sifre || typeof kullaniciAdi !== 'string' || typeof sifre !== 'string') {
      return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli' });
    }
    const user = await db.getUserByUsername(kullaniciAdi.trim());
    
    if (!user) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
    
    // Şifre kontrolü (bcrypt hash veya eski düz metin - migration sonrası hep hash)
    let sifreGecerli = false;
    if (!user.sifre) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
    if (user.sifre.startsWith('$2')) {
      sifreGecerli = bcrypt.compareSync(sifre, user.sifre);
    } else {
      sifreGecerli = user.sifre === sifre;
      if (sifreGecerli) {
        const hash = bcrypt.hashSync(sifre, 10);
        await db.updateUserPassword(user.id, hash);
      }
    }
    if (!sifreGecerli) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
    
    if (!user.aktif || user.aktif == 0) {
      return res.status(403).json({ error: 'Hesabınız devre dışı bırakılmış' });
    }
    
    const token = auth.generateToken(user);
    const mustChangePassword = user.kullaniciAdi === 'admin' && sifre === 'admin123';
    res.json({ 
      success: true, 
      token,
      mustChangePassword: !!mustChangePassword,
      user: { 
        id: user.id, 
        kullaniciAdi: user.kullaniciAdi, 
        rol: user.rol,
        adSoyad: user.adSoyad,
        studentId: user.studentId,
        subeId: user.subeId
      } 
    });
  } catch (error) {
    res.status(500).json({ error: isProduction ? 'Giriş sırasında hata oluştu' : error.message });
  }
});

// Tüm kullanıcıları getir (şube filtrelemeli)
app.get('/api/users', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const users = await db.getAllUsers(subeId);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Kullanıcı detayı getir
app.get('/api/users/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const user = await db.getUserById(id);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Yeni kullanıcı oluştur
app.post('/api/users', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    // Yönetici admin veya yönetici rolü atayamaz
    if (req.user.rol === 'yonetici' && ['admin', 'yonetici'].includes(req.body.rol)) {
      return res.status(403).json({ error: 'Yönetici bu rolü atayamaz' });
    }
    const USER_CREATE_FIELDS = ['kullaniciAdi', 'sifre', 'rol', 'adSoyad', 'telefon', 'email', 'studentId', 'subeId'];
    const body = pickAllowed(req.body, USER_CREATE_FIELDS);
    const user = {
      ...body,
      aktif: 1,
      olusturmaTarihi: new Date().toISOString(),
      subeId: req.effectiveSubeId ?? body.subeId ?? null
    };
    const newUser = await db.createUser(user);
    const { sifre, ...safeUser } = newUser;
    res.json({ success: true, user: safeUser });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Kullanıcı güncelle
app.put('/api/users/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    // Yönetici admin veya yönetici rolüne değiştiremez
    if (req.user.rol === 'yonetici' && req.body.rol && ['admin', 'yonetici'].includes(req.body.rol)) {
      return res.status(403).json({ error: 'Yönetici bu rolü atayamaz' });
    }
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const USER_UPDATE_FIELDS = ['kullaniciAdi', 'sifre', 'rol', 'adSoyad', 'telefon', 'email', 'studentId', 'subeId', 'aktif'];
    const updatedUser = await db.updateUser(id, pickAllowed(req.body, USER_UPDATE_FIELDS));
    const { sifre, ...safeUser } = updatedUser;
    res.json(safeUser);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Kullanıcı sil
app.delete('/api/users/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    await db.deleteUser(id);
    res.json({ message: 'Kullanıcı silindi' });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Veli için öğrencileri getir - KALDIRILDI (güvenlik: yetkisiz erişim riski)
// Veliler /api/parent/:id/students kullanmalı (kendi ID'leri ile, auth gerekli)

// Kullanıcı oluştur (sadece veli - admin/yönetici tarafından)
app.post('/api/register', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const REGISTER_FIELDS = ['kullaniciAdi', 'sifre', 'adSoyad', 'telefon', 'email', 'studentId', 'subeId'];
    const body = { ...pickAllowed(req.body, REGISTER_FIELDS), rol: 'veli', olusturmaTarihi: new Date().toISOString() };
    const newUser = await db.createUser(body);
    res.json({ success: true, user: { id: newUser.id, kullaniciAdi: newUser.kullaniciAdi, rol: 'veli' } });
  } catch (error) {
    res.status(500).json({ error: isProduction ? 'Kayıt sırasında hata oluştu' : error.message });
  }
});
// ============ ÖDEME API ============

// Tüm ödemeleri getir (eski payments tablosu - admin/yönetici)
app.get('/api/payments', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const payments = await db.getAllPayments();
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Öğrenciye göre ödemeleri getir
app.get('/api/payments/student/:studentId', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const studentId = safeParseId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'Geçersiz ID' });
    const payments = await db.getPaymentsByStudent(studentId);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Yeni ödeme ekle
const PAYMENT_FIELDS = ['studentId', 'miktar', 'odemeTipi', 'donem', 'donemBaslangic', 'donemBitis', 'odemeTarihi', 'notlar'];
app.post('/api/payments', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const payment = await db.addPayment(pickAllowed(req.body, PAYMENT_FIELDS));
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Ödeme sil (eski payments tablosu)
app.delete('/api/payments/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    await db.deleteLegacyPayment(id);
    res.json({ message: 'Ödeme silindi' });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// ============ AYARLAR API ============

/** Ayar anahtarı validasyonu - en fazla 64 karakter, alfanumerik/underscore/tire */
function isValidSettingKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key.length > 64) return false;
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

// Ayar getir
app.get('/api/settings/:key', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const key = req.params.key;
    if (!isValidSettingKey(key)) return res.status(400).json({ error: 'Geçersiz ayar anahtarı' });
    const value = await db.getSetting(key);
    res.json({ key, value });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Ayar güncelle
app.put('/api/settings/:key', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const key = req.params.key;
    if (!isValidSettingKey(key)) return res.status(400).json({ error: 'Geçersiz ayar anahtarı' });
    const result = await db.updateSetting(key, req.body.value);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});
// ============ GRUP YÖNETİMİ API ============

app.get('/api/groups', auth.requireStaff, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const instructorId = safeQueryId(req.query.instructorId);
    
    let groups = await db.getAllGroups(subeId);
    
    // Sonra instructorId varsa onunla da filtrele
    if (instructorId) {
      groups = groups.filter(g => g.instructorId == instructorId);
    }
    
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Aktif grupları getir (şube filtrelemeli)
app.get('/api/groups/active', auth.requireStaff, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const groups = await db.getActiveGroups(subeId);
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Yeni grup oluştur
const GROUP_CREATE_FIELDS = ['groupName', 'instructorId', 'notlar', 'subeId'];
app.post('/api/groups', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const body = pickAllowed(req.body, GROUP_CREATE_FIELDS);
    const group = {
      ...body,
      durum: 'Aktif',
      olusturmaTarihi: new Date().toISOString()
    };
    if (req.effectiveSubeId) group.subeId = req.effectiveSubeId;
    const newGroup = await db.createGroup(group);
    res.json(newGroup);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Grup güncelle
app.put('/api/groups/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    if (req.effectiveSubeId) {
      const grp = await db.getGroupById(id);
      if (!grp || grp.subeId !== req.effectiveSubeId) {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
      }
    }
    const GROUP_UPDATE_FIELDS = ['groupName', 'instructorId', 'durum', 'notlar', 'subeId'];
    const updatedGroup = await db.updateGroup(id, pickAllowed(req.body, GROUP_UPDATE_FIELDS));
    res.json(updatedGroup);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Grup kapat
app.put('/api/groups/:id/close', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    if (req.effectiveSubeId) {
      const grp = await db.getGroupById(id);
      if (!grp || grp.subeId !== req.effectiveSubeId) {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
      }
    }
    const { kapatmaTarihi } = req.body;
    await db.closeGroup(id, kapatmaTarihi);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Gruptaki öğrenci sayısını getir
app.get('/api/groups/:id/count', auth.requireStaff, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const count = await db.getGroupStudentCount(id);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Öğrencileri başka gruba aktar
app.post('/api/groups/transfer', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const { studentIds, newGroupId } = req.body || {};
    const gid = safeParseId(newGroupId);
    if (!gid) return res.status(400).json({ error: 'Geçerli grup ID gerekli' });
    const ids = Array.isArray(studentIds) ? studentIds.map(id => safeParseId(id)).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Geçerli öğrenci ID listesi gerekli' });
    if (req.effectiveSubeId) {
      const grp = await db.getGroupById(gid);
      if (!grp || grp.subeId !== req.effectiveSubeId) {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
      }
    }
    await db.transferStudentsToGroup(ids, gid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Grup sil
app.delete('/api/groups/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    if (req.effectiveSubeId) {
      const grp = await db.getGroupById(id);
      if (!grp || grp.subeId !== req.effectiveSubeId) {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
      }
    }
    await db.deleteGroup(id);
    res.json({ success: true, message: 'Grup silindi' });
  } catch (error) {
    res.status(400).json({ error: safeErrorMsg(error.message) });
  }
});
// Öğrenci istatistikleri
app.get('/api/students/stats', auth.requireStaff, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const stats = await db.getStudentStats(subeId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});
// ============ ÖDEME DÖNEMLERİ API ============

// Tüm dönemleri getir (şube filtrelemeli)
app.get('/api/periods', auth.requireStaff, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const periods = await db.getAllPeriods(subeId);
    res.json(periods);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Yeni dönem oluştur
const PERIOD_CREATE_FIELDS = ['donemAdi', 'baslangicTarihi', 'bitisTarihi', 'tutar', 'subeId'];
app.post('/api/periods', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const body = pickAllowed(req.body, PERIOD_CREATE_FIELDS);
    const period = {
      ...body,
      durum: 'Bekliyor',
      olusturmaTarihi: new Date().toISOString(),
      subeId: req.effectiveSubeId ?? body.subeId ?? null
    };
    const newPeriod = await db.createPeriod(period);
    res.json(newPeriod);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Dönem güncelle
app.put('/api/periods/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const PERIOD_UPDATE_FIELDS = ['donemAdi', 'baslangicTarihi', 'bitisTarihi', 'tutar', 'durum', 'subeId'];
    const updatedPeriod = await db.updatePeriod(id, pickAllowed(req.body, PERIOD_UPDATE_FIELDS));
    res.json(updatedPeriod);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Dönem sil
app.delete('/api/periods/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    await db.deletePeriod(id);
    res.json({ success: true, message: 'Dönem silindi' });
  } catch (error) {
    res.status(400).json({ error: safeErrorMsg(error.message) });
  }
});

// Dönemi aktif et (borçları oluştur)
app.post('/api/periods/:id/activate', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const result = await db.activatePeriod(id);
    res.json({ success: true, message: `${result.count} öğrenci için borç oluşturuldu` });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Öğrencinin dönem ödemelerini getir (veli sadece kendi çocuğununkini görebilir)
app.get('/api/students/:studentId/period-payments', async (req, res) => {
  try {
    const studentId = safeParseId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'Geçersiz ID' });
    if (req.user.rol === 'veli') {
      const parentStudentIds = await db.getParentStudentIds(req.user.id);
      if (!parentStudentIds.includes(studentId)) {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
      }
    }
    const payments = await db.getStudentPeriodPayments(studentId);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Tüm öğrencilerin dönem ödemelerini getir
app.get('/api/period-payments', auth.requireStaff, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const payments = await db.getAllStudentPeriodPayments(subeId);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Ödeme yap
app.post('/api/period-payments/:id/pay', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const MAKE_PAYMENT_FIELDS = ['odemeTarihi', 'odemeYontemi', 'notlar'];
    await db.makePayment(id, pickAllowed(req.body, MAKE_PAYMENT_FIELDS));
    const payment = await db.getPaymentReceipt(id);
    if (payment) {
      await db.addIncome({
        subeId: payment.subeId || null,
        kaynak: 'Kurs Ödemesi',
        tutar: payment.tutar,
        odemeTarihi: req.body.odemeTarihi || new Date().toISOString().split('T')[0],
        odemeYontemi: req.body.odemeYontemi || null,
        aciklama: `Dönem: ${payment.donemAdi}`,
        paymentId: id,
        olusturmaTarihi: new Date().toISOString()
      });
    }
    res.json({ success: true, message: 'Ödeme kaydedildi' });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});
// Ödeme güncelle
app.put('/api/period-payments/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const UPDATE_PAYMENT_FIELDS = ['odemeTarihi', 'odemeYontemi', 'notlar'];
    await db.updatePayment(id, pickAllowed(req.body, UPDATE_PAYMENT_FIELDS));
    res.json({ success: true, message: 'Ödeme güncellendi' });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Ödeme sil (öğrenci tekrar borçlu olur)
app.delete('/api/period-payments/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    await db.deletePeriodPayment(id);
    await db.deleteIncomeByPaymentId(id);
    res.json({ success: true, message: 'Ödeme silindi' });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});
// Ödeme makbuzu PDF oluştur
app.get('/api/period-payments/:id/receipt', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    
    // Ödeme bilgisini al
    const payment = await db.getPaymentReceipt(id);
    
    if (!payment) {
      return res.status(404).json({ error: 'Ödeme bulunamadı' });
    }
    
    // PDF oluştur
    const doc = new PDFDocument({ margin: 50 });
    const fontPath = getPdfFontPath();
    if (fontPath) doc.font(fontPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=makbuz-${id}.pdf`);
    
    doc.pipe(res);
    
    // Başlık
    doc.fontSize(20).text('BESIKTAS FUTBOL OKULU', { align: 'center' });
    doc.fontSize(16).text('ODEME MAKBUZU', { align: 'center' });
    doc.moveDown(2);
    
    // Bilgiler
    doc.fontSize(12);
    doc.text('Sporcu: ' + payment.ad + ' ' + payment.soyad);
    doc.text('TC Kimlik No: ' + (payment.tcNo || '-'));
    doc.moveDown();
    
    doc.text('Odeme Tarihi: ' + (payment.odemeTarihi ? new Date(payment.odemeTarihi).toLocaleDateString('tr-TR') : '-'));
    doc.text('Odeme Tipi: ' + (payment.odemeYontemi || '-'));
    doc.moveDown();
    
    doc.text('Odenen Donem: ' + payment.donemAdi);
    doc.text('Donem Tarihleri: ' + new Date(payment.baslangicTarihi).toLocaleDateString('tr-TR') + ' - ' + new Date(payment.bitisTarihi).toLocaleDateString('tr-TR'));
    doc.moveDown();
    
    doc.fontSize(16).text('Toplam Tutar: ' + payment.tutar.toFixed(2) + ' TL', { align: 'right' });
    doc.moveDown(2);
    
    // Alt bilgi
    doc.fontSize(10).text('Makbuz No: ' + id, { align: 'center' });
    doc.text('Duzenlenme: ' + new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR'), { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Makbuz PDF'ini buffer olarak oluştur (e-posta için)
function generateReceiptPdfBuffer(payment) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const fontPath = getPdfFontPath();
    if (fontPath) doc.font(fontPath);
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(20).text('BESIKTAS FUTBOL OKULU', { align: 'center' });
    doc.fontSize(16).text('ODEME MAKBUZU', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(12);
    doc.text('Sporcu: ' + payment.ad + ' ' + payment.soyad);
    doc.text('TC Kimlik No: ' + (payment.tcNo || '-'));
    doc.moveDown();
    doc.text('Odeme Tarihi: ' + (payment.odemeTarihi ? new Date(payment.odemeTarihi).toLocaleDateString('tr-TR') : '-'));
    doc.text('Odeme Tipi: ' + (payment.odemeYontemi || '-'));
    doc.moveDown();
    doc.text('Odenen Donem: ' + payment.donemAdi);
    doc.text('Donem Tarihleri: ' + new Date(payment.baslangicTarihi).toLocaleDateString('tr-TR') + ' - ' + new Date(payment.bitisTarihi).toLocaleDateString('tr-TR'));
    doc.moveDown();
    doc.fontSize(16).text('Toplam Tutar: ' + payment.tutar.toFixed(2) + ' TL', { align: 'right' });
    doc.moveDown(2);
    doc.fontSize(10).text('Makbuz No: ' + payment.id, { align: 'center' });
    doc.text('Duzenlenme: ' + new Date().toLocaleDateString('tr-TR') + ' ' + new Date().toLocaleTimeString('tr-TR'), { align: 'center' });
    doc.end();
  });
}

// Makbuz iletişim bilgisi (modal önizleme için)
app.get('/api/period-payments/:id/receipt-info', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const payment = await db.getPaymentReceipt(id);
    if (!payment) return res.status(404).json({ error: 'Ödeme bulunamadı' });
    const phone = payment.veliTelefon1 || payment.veliTelefon2 || '';
    res.json({
      email: payment.email || '',
      phone: (phone || '').replace(/\D/g, '').replace(/^0/, ''),
      studentName: payment.ad + ' ' + payment.soyad,
      periodName: payment.donemAdi
    });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// SMS gönder (NetGSM XML API - POST ile credentials URL'de değil body'de)
async function sendSms(gsmno, message) {
  const usercode = process.env.NETGSM_USERCODE;
  const password = process.env.NETGSM_PASSWORD;
  const msgheader = process.env.NETGSM_MSGHEADER || 'FUTBOL';
  if (!usercode || !password) return false;
  const num = String(gsmno).replace(/\D/g, '').replace(/^0/, '');
  if (num.length < 10) return false;
  const gsm = num.startsWith('90') ? num : '90' + num;
  try {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><mainbody><header><company dil="TR">Netgsm</company><usercode>${escapeXml(usercode)}</usercode><password>${escapeXml(password)}</password><type>1:n</type><msgheader>${escapeXml(msgheader)}</msgheader></header><body><msg><![CDATA[${message}]]></msg><no>${gsm}</no></body></mainbody>`;
    const res = await fetch('https://api.netgsm.com.tr/sms/send/xml', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: xml
    });
    const text = await res.text();
    return text.startsWith('00') || text.startsWith('01') || text.startsWith('02');
  } catch (e) {
    console.error('SMS gönderme hatası:', e.message);
    return false;
  }
}
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Makbuzu gönder (e-posta varsa e-posta, telefon varsa SMS - ikisi de opsiyonel, hata vermez)
app.post('/api/period-payments/:id/send-receipt-email', auth.requireAdminOrYonetici, emailLimiter, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const { email } = req.body || {};
    const toEmail = (email && String(email).trim()) || null;

    const payment = await db.getPaymentReceipt(id);
    if (!payment) {
      return res.status(404).json({ error: 'Ödeme bulunamadı' });
    }

    let emailSent = false;
    let smsSent = false;

    const targetEmail = ((toEmail || payment.email) || '').replace(/[\r\n]/g, '').trim();
    const hasValidEmail = targetEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail);

    if (hasValidEmail) {
      const transporter = getMailTransporter();
      if (transporter) {
        const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER;
        const pdfBuffer = await generateReceiptPdfBuffer(payment);
        await transporter.sendMail({
          from: smtpFrom,
          to: targetEmail,
          subject: `Beşiktaş Futbol Okulu - Ödeme Makbuzu (${payment.ad} ${payment.soyad} - ${payment.donemAdi})`,
          text: `Sayın ${payment.veliAdi || 'Veli'},\n\n${payment.ad} ${payment.soyad} için ${payment.donemAdi} dönemi ödeme makbuzu ekteki PDF dosyasında yer almaktadır.\n\nToplam Tutar: ${payment.tutar.toFixed(2)} TL\n\nBeşiktaş Futbol Okulu`,
          attachments: [{ filename: `makbuz-${id}.pdf`, content: pdfBuffer }]
        });
        emailSent = true;
      }
    }

    const phone = payment.veliTelefon1 || payment.veliTelefon2 || '';
    const phoneNum = (phone || '').replace(/\D/g, '').replace(/^0/, '');
    if (phoneNum.length >= 10) {
      const smsMsg = `Beşiktaş Futbol Okulu: ${payment.ad} ${payment.soyad} - ${payment.donemAdi} dönemi ödeme makbuzu. Toplam: ${payment.tutar.toFixed(2)} TL.`;
      smsSent = await sendSms(phoneNum, smsMsg);
    }

    const parts = [];
    if (emailSent) parts.push('E-posta gönderildi');
    if (smsSent) parts.push('SMS gönderildi');
    const message = parts.length > 0 ? parts.join('. ') : 'E-posta veya SMS gönderilemedi. SMTP ve NetGSM ayarlarını kontrol edin.';

    res.json({ success: true, emailSent, smsSent, message });
  } catch (error) {
    console.error('Makbuz gönderme hatası:', error.message);
    res.status(500).json({ error: 'Makbuz gönderilemedi. Lütfen ayarları kontrol edin.' });
  }
});

// Grup yoklama PDF
app.get('/api/groups/attendance-pdf', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const { groupName, date, students } = req.query;
    if (!groupName || !date || !students) {
      return res.status(400).json({ error: 'groupName, date ve students gerekli' });
    }
    const studentIds = students.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
    if (studentIds.length === 0) return res.status(400).json({ error: 'Geçerli öğrenci ID\'leri gerekli' });
    
    // Öğrenci bilgilerini al (bellek optimizasyonu - sadece istenen ID'ler)
    const studentList = await db.getStudentsByIds(studentIds);
    
    // PDF oluştur
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const fontPath = getPdfFontPath();
    if (fontPath) doc.font(fontPath);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=yoklama-${Date.now()}.pdf`);
    
    doc.pipe(res);
  
    // Başlık
    doc.fontSize(20).text('BESIKTAS FUTBOL OKULU', { align: 'center' });
    doc.fontSize(16).text('YOKLAMA LISTESI', { align: 'center' });
    doc.moveDown();
    
    // Grup ve tarih bilgisi
    doc.fontSize(12);
    doc.text('Grup: ' + groupName);
    doc.text('Toplam Ogrenci: ' + studentList.length);
    doc.moveDown();
    
    // Tablo başlıkları
    doc.fontSize(10);
    const startY = doc.y;
    
    // Başlıklar
    doc.text('Sira', 50, startY, { width: 30 });
    doc.text('Ad Soyad', 90, startY, { width: 150 });
    doc.text('Dogum Tarihi', 250, startY, { width: 80 });
    doc.text('Tarih 1>', 340, startY, { width: 50, align: 'center' });
    doc.text('Tarih 2>', 400, startY, { width: 50, align: 'center' });
    doc.text('Bilgi', 460, startY, { width: 90 });
    
    doc.moveTo(50, startY + 15).lineTo(550, startY + 15).stroke();
    doc.moveDown();
    
    // Öğrenci listesi
    studentList.forEach((student, index) => {
      const y = doc.y;
      
      if (y > 700) {
        doc.addPage();
        doc.y = 50;
      }
      
      doc.text(`${index + 1}`, 50, doc.y, { width: 30 });
      doc.text(`${student.ad} ${student.soyad}`, 90, y, { width: 150 });
      doc.text(student.dogumTarihi ? new Date(student.dogumTarihi).toLocaleDateString('tr-TR') : '-', 250, y, { width: 80 });
      doc.text('', 340, y, { width: 50, align: 'center' });
      doc.text('', 400, y, { width: 50, align: 'center' });
      doc.text('', 460, y, { width: 90 });
      
      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
    });
    
    // Kalan boş satırları ekle (toplam 25 satır olacak)
    const remainingRows = 25 - studentList.length;
    for (let i = 0; i < remainingRows; i++) {
      const y = doc.y;
      
      if (y > 700) {
        doc.addPage();
        doc.y = 50;
      }
      
      doc.text(`${studentList.length + i + 1}`, 50, doc.y, { width: 30 });
      doc.text('', 90, y, { width: 150 });
      doc.text('', 250, y, { width: 80 });
      doc.text('', 340, y, { width: 50 });
      doc.text('', 400, y, { width: 50 });
      doc.text('', 460, y, { width: 90 });
      
      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
    }
    
    // Misafir Oyuncular Tablosu
    doc.moveDown(2);
    doc.fontSize(14).text('MISAFIR OYUNCULAR', 50, doc.y, { width: 500, align: 'center' });
    doc.fontSize(10);
    doc.moveDown();
    
    const guestStartY = doc.y;
    
    // Başlıklar
    doc.text('Sira', 50, guestStartY, { width: 30 });
    doc.text('Ad Soyad', 90, guestStartY, { width: 150 });
    doc.text('Dogum Tarihi', 250, guestStartY, { width: 80 });
    doc.text('Tarih 1>', 340, guestStartY, { width: 50, align: 'center' });
    doc.text('Tarih 2>', 400, guestStartY, { width: 50, align: 'center' });
    doc.text('Bilgi', 460, guestStartY, { width: 90 });
    
    doc.moveTo(50, guestStartY + 15).lineTo(550, guestStartY + 15).stroke();
    doc.moveDown();
    
    // 5 boş satır
    for (let i = 0; i < 5; i++) {
      const y = doc.y;
      
      doc.text(`${i + 1}`, 50, doc.y, { width: 30 });
      doc.text('', 90, y, { width: 150 });
      doc.text('', 250, y, { width: 80 });
      doc.text('', 340, y, { width: 50 });
      doc.text('', 400, y, { width: 50 });
      doc.text('', 460, y, { width: 90 });
      
      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
    }
    doc.end();
    
  } catch (error) {
    console.error('Yoklama PDF hatası:', error);
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// ============ YOKLAMA API ============

app.get('/api/attendance', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const groupId = safeQueryId(req.query.groupId);
    const date = req.query.date;
    if (!groupId || !date) {
      return res.status(400).json({ error: 'groupId ve date gerekli' });
    }
    const entries = await db.getAttendanceEntries(groupId, date);
    res.json({ entries });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.post('/api/attendance', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const { groupId, date, instructorId, entries } = req.body;
    if (!groupId || !date || !Array.isArray(entries)) {
      return res.status(400).json({ error: 'groupId, date ve entries gerekli' });
    }
    const result = await db.saveAttendance({
      groupId: parseInt(groupId),
      date,
      instructorId: instructorId ? parseInt(instructorId) : null,
      entries
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Yoklama raporu
app.get('/api/reports/attendance', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const { start, end, subeId, groupId } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'start ve end gerekli' });
    }
    const result = await db.getAttendanceReport(
      subeId ? parseInt(subeId) : null,
      start,
      end,
      groupId ? parseInt(groupId) : null
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.get('/api/reports/attendance-monthly', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const { start, end, subeId, groupId } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'start ve end gerekli' });
    }
    const rows = await db.getAttendanceMonthlyTrend(
      subeId ? parseInt(subeId) : null,
      start,
      end,
      groupId ? parseInt(groupId) : null
    );
    res.json({ rows });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// ============ TEST API ============

app.get('/api/tests/student/:studentId', async (req, res) => {
  try {
    const studentId = safeParseId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'Geçersiz ID' });
    if (req.user.rol === 'veli') {
      const parentStudentIds = await db.getParentStudentIds(req.user.id);
      if (!parentStudentIds.includes(studentId)) {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
      }
    }
    const sessions = await db.getStudentTests(studentId);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.post('/api/tests', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const { studentId, olcumNo, date, groupId, createdBy, createdRole, notes, aiComment, metrics } = req.body;
    if (!studentId || !date || !Array.isArray(metrics)) {
      return res.status(400).json({ error: 'studentId, date ve metrics gerekli' });
    }
    const result = await db.createTestSession({
      studentId: parseInt(studentId),
      olcumNo,
      date,
      groupId,
      createdBy,
      createdRole,
      notes,
      aiComment,
      metrics
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.get('/api/tests/averages', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const { groupId, date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'date gerekli' });
    }
    const result = await db.getTestAverages(
      groupId ? parseInt(groupId) : null,
      date
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// ============ VELİ PANELİ ENDPOINT'LERİ ============

// Veli notları
app.get('/api/parent-notes/:parentUserId', auth.requireParentNotesAccess, async (req, res) => {
  try {
    const parentUserId = safeParseId(req.params.parentUserId);
    if (!parentUserId) return res.status(400).json({ error: 'Geçersiz ID' });
    const notes = await db.getParentNotes(parentUserId);
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

const PARENT_NOTE_FIELDS = ['parentUserId', 'note', 'isPublic', 'studentId'];
app.post('/api/parent-notes', async (req, res) => {
  try {
    const body = pickAllowed(req.body, PARENT_NOTE_FIELDS);
    if (req.user.rol === 'veli') body.parentUserId = req.user.id;
    const currentUser = await db.getUserById(req.user.id);
    body.createdBy = currentUser?.adSoyad || currentUser?.kullaniciAdi || 'Bilinmeyen';
    const note = await db.addParentNote(body);
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.delete('/api/parent-notes/:id', async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const note = await db.getParentNoteById(id);
    if (!note) return res.status(404).json({ error: 'Not bulunamadı' });
    if (req.user.rol === 'veli' && note.parentUserId !== req.user.id) {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }
    await db.deleteParentNote(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Velinin sporcu bilgilerini getir (sadece kendi verisi - SQL'de filtre)
app.get('/api/parent/:parentUserId/students', auth.requireOwnParent, async (req, res) => {
  try {
    const parentUserId = safeParseId(req.params.parentUserId);
    if (!parentUserId) return res.status(400).json({ error: 'Geçersiz ID' });
    const user = await db.getUserById(parentUserId);
    if (!user || user.rol !== 'veli') {
      return res.status(403).json({ error: 'Yetkisiz erişim' });
    }
    const parentStudents = await db.getStudentsByParentUserId(parentUserId);
    res.json(parentStudents);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// ============ ŞUBE YÖNETİMİ API ============

// Tüm şubeleri getir
app.get('/api/subeler', auth.requireStaff, async (req, res) => {
  try {
    const subeler = await db.getAllSubeler();
    res.json(subeler);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Aktif şubeleri getir
app.get('/api/subeler/active', auth.requireStaff, async (req, res) => {
  try {
    const subeler = await db.getActiveSubeler();
    res.json(subeler);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Şube detayı getir
app.get('/api/subeler/:id', auth.requireStaff, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const sube = await db.getSubeById(id);
    res.json(sube);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Yeni şube ekle
const SUBE_CREATE_FIELDS = ['subeAdi', 'adres', 'telefon'];
app.post('/api/subeler', auth.requireAdmin, async (req, res) => {
  try {
    const sube = await db.createSube(pickAllowed(req.body, SUBE_CREATE_FIELDS));
    res.json(sube);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Şube güncelle
app.put('/api/subeler/:id', auth.requireAdmin, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const SUBE_UPDATE_FIELDS = ['subeAdi', 'adres', 'telefon'];
    const sube = await db.updateSube(id, pickAllowed(req.body, SUBE_UPDATE_FIELDS));
    res.json(sube);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Şube durumunu değiştir
app.put('/api/subeler/:id/toggle', auth.requireAdmin, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    await db.toggleSubeStatus(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Şube sil
app.delete('/api/subeler/:id', auth.requireAdmin, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    await db.deleteSube(id);
    res.json({ success: true, message: 'Şube silindi' });
  } catch (error) {
    res.status(400).json({ error: safeErrorMsg(error.message) });
  }
});
// Şube istatistikleri
app.get('/api/subeler/:id/stats', auth.requireStaff, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const stats = await db.getSubeStats(id);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Raporlama - özet
app.get('/api/reports/summary', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const range = req.query.range || 'periods';
    const count = Math.max(1, safeParseId(req.query.count) || 1);
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);

    let startDate;
    let endDate;
    let selectedPeriods = [];

    if (range === 'year') {
      endDate = new Date();
      startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - 1);
    } else {
      const periods = await db.getAllPeriods(subeId);
      const sorted = [...periods].sort((a, b) => new Date(b.baslangicTarihi) - new Date(a.baslangicTarihi));
      selectedPeriods = sorted.slice(0, Math.max(1, count));
      if (selectedPeriods.length === 0) {
        // Dönem yoksa son 1 yıl kullan
        endDate = new Date();
        startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 1);
      } else {
        startDate = new Date(selectedPeriods[selectedPeriods.length - 1].baslangicTarihi);
        endDate = new Date(selectedPeriods[0].bitisTarihi);
      }
    }

    const result = await db.getReportSummary(
      subeId,
      startDate.toISOString(),
      endDate.toISOString()
    );

    // Dönem ödeme özeti
    if (selectedPeriods.length > 0) {
      const periodIds = selectedPeriods.map(p => p.id);
      result.paymentStats = await db.getPeriodPaymentStats(periodIds, subeId);
    } else {
      result.paymentStats = { totalOdenen: 0, totalBorclu: 0, odenenSayisi: 0, borcluSayisi: 0 };
    }

    result.selectedPeriods = selectedPeriods.map(p => ({
      id: p.id,
      donemAdi: p.donemAdi || p.donemadi,
      baslangicTarihi: p.baslangicTarihi || p.baslangictarihi,
      bitisTarihi: p.bitisTarihi || p.bitistarihi,
      tutar: p.tutar
    }));
    result.dateRange = { start: startDate.toISOString().split('T')[0], end: endDate.toISOString().split('T')[0] };
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Öğrenci dönem istatistikleri
app.get('/api/reports/student-period-stats', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const start = req.query.start;
    const end = req.query.end;
    if (!start || !end) {
      return res.status(400).json({ error: 'start ve end gerekli' });
    }
    const result = await db.getStudentPeriodStats(subeId, start, end);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Antrenör raporu
app.get('/api/reports/instructor', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const range = req.query.range || 'periods';
    const count = Math.max(1, safeParseId(req.query.count) || 1);
    const instructorId = safeQueryId(req.query.instructorId);

    if (!instructorId) {
      return res.status(400).json({ error: 'instructorId gerekli' });
    }
    if (req.effectiveSubeId) {
      const instructor = await db.getUserById(instructorId);
      if (!instructor || instructor.subeId !== req.effectiveSubeId) {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
      }
    }

    let startDate;
    let endDate;

    if (range === 'year') {
      endDate = new Date();
      startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - 1);
    } else {
      const subeId = req.effectiveSubeId ?? null;
      const periods = await db.getAllPeriods(subeId);
      const sorted = [...periods].sort((a, b) => new Date(b.baslangicTarihi) - new Date(a.baslangicTarihi));
      const selected = sorted.slice(0, Math.max(1, count));
      if (selected.length === 0) {
        return res.json({
          activeGroupCount: 0,
          activeStudentCount: 0,
          registrations: 0,
          inactives: 0
        });
      }
      startDate = new Date(selected[selected.length - 1].baslangicTarihi);
      endDate = new Date(selected[0].bitisTarihi);
    }

    const result = await db.getInstructorReport(
      instructorId,
      startDate.toISOString(),
      endDate.toISOString()
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Rapor PDF
app.get('/api/reports/pdf', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const range = req.query.range || 'periods';
    const count = Math.max(1, safeParseId(req.query.count) || 1);
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);

    let startDate;
    let endDate;
    let titleRange = 'Son Dönem';

    if (range === 'year') {
      endDate = new Date();
      startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - 1);
      titleRange = 'Son 1 Yıl';
    } else {
      const periods = await db.getAllPeriods(subeId);
      const sorted = [...periods].sort((a, b) => new Date(b.baslangicTarihi) - new Date(a.baslangicTarihi));
      const selected = sorted.slice(0, Math.max(1, count));
      if (selected.length === 0) {
        return res.status(404).json({ error: 'Dönem bulunamadı' });
      }
      startDate = new Date(selected[selected.length - 1].baslangicTarihi);
      endDate = new Date(selected[0].bitisTarihi);
      titleRange = count === 1 ? 'Son Dönem' : `Son ${count} Dönem`;
    }

    const data = await db.getReportSummary(
      subeId,
      startDate.toISOString(),
      endDate.toISOString()
    );

    const doc = new PDFDocument({ margin: 40 });
    const fontPath = getPdfFontPath();
    if (fontPath) doc.font(fontPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=rapor-${Date.now()}.pdf`);
    doc.pipe(res);

    doc.fontSize(18).text('FUTBOL OKULU RAPORLAR', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Aralık: ${titleRange}`, { align: 'center' });
    if (subeId) {
      const sube = await db.getSubeById(subeId);
      doc.text(`Şube: ${sube ? sube.subeAdi : subeId}`, { align: 'center' });
    }
    doc.moveDown(1.5);

    const writeList = (title, stats) => {
      doc.fontSize(14).text(title);
      doc.fontSize(11);
      const rows = Object.entries(stats || {}).sort((a, b) => b[1] - a[1]);
      if (rows.length === 0) {
        doc.text('Veri yok');
      } else {
        rows.forEach(([label, count]) => {
          const text = `${label} : ${count}`;
          doc.text(text);
        });
      }
      doc.moveDown(0.8);
    };

    writeList('Yaş Dağılımı', data.ageStats);
    writeList('Okul Dağılımı', data.schoolStats);
    writeList('Mahalle Dağılımı', data.mahalleStats);
    writeList('Kayıt Kaynağı', data.sourceStats);

    doc.fontSize(14).text('Antrenör / Grup Raporu');
    doc.moveDown(0.3);
    doc.fontSize(11);
    if (!data.instructorStats || data.instructorStats.length === 0) {
      doc.text('Veri yok');
    } else {
      data.instructorStats.forEach(row => {
        doc.text(
          `${row.instructorName} | Grup: ${row.groupCount} | Öğrenci: ${row.studentCount} | Kayıt: ${row.registrations} | Pasif: ${row.inactives}`
        );
      });
    }

    doc.end();
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Ön muhasebe gelirler
app.get('/api/accounting/incomes', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const start = req.query.start || null;
    const end = req.query.end || null;
    const data = await db.getIncomes(subeId, start, end);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.post('/api/accounting/incomes', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const INCOME_FIELDS = ['kaynak', 'tutar', 'odemeTarihi', 'odemeYontemi', 'aciklama', 'paymentId', 'subeId'];
    const body = pickAllowed(req.body, INCOME_FIELDS);
    const income = {
      ...body,
      olusturmaTarihi: new Date().toISOString(),
      subeId: req.effectiveSubeId ?? body.subeId ?? null
    };
    const result = await db.addIncome(income);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Ön muhasebe giderler
app.get('/api/accounting/expenses', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const subeId = req.effectiveSubeId ?? safeQueryId(req.query.subeId);
    const start = req.query.start || null;
    const end = req.query.end || null;
    const data = await db.getExpenses(subeId, start, end);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.post('/api/accounting/expenses', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const EXPENSE_CREATE_FIELDS = ['kategori', 'tutar', 'giderTarihi', 'aciklama', 'subeId'];
    const body = pickAllowed(req.body, EXPENSE_CREATE_FIELDS);
    const expense = {
      ...body,
      olusturmaTarihi: new Date().toISOString(),
      subeId: req.effectiveSubeId ?? body.subeId ?? null
    };
    const result = await db.addExpense(expense);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.put('/api/accounting/expenses/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const EXPENSE_UPDATE_FIELDS = ['kategori', 'tutar', 'giderTarihi', 'aciklama', 'subeId'];
    const result = await db.updateExpense(id, pickAllowed(req.body, EXPENSE_UPDATE_FIELDS));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

app.delete('/api/accounting/expenses/:id', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const id = safeParseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Geçersiz ID' });
    const result = await db.deleteExpense(id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// Öğrenciye aktif dönemler için orantılı borç oluştur (pasiften aktif yaparken)
app.post('/api/students/:id/create-debts', auth.requireAdminOrYonetici, async (req, res) => {
  try {
    const studentId = safeParseId(req.params.id);
    if (!studentId) return res.status(400).json({ error: 'Geçersiz ID' });
    const bugun = new Date().toISOString();
    await db.createProportionalDebtsForReturningStudent(studentId, bugun);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: safeErrorMsg(error.message) });
  }
});

// 404 - Bilinmeyen API route (tüm route'lardan sonra)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint bulunamadı' });
});

// Global hata yakalayıcı (yakalanmamış hatalar)
app.use((err, req, res, next) => {
  console.error('Yakalanmamış hata:', err);
  res.status(500).json({ error: isProduction ? 'Sunucu hatası' : (err.message || 'Bilinmeyen hata') });
});

// Otomatik dönem kontrolü - Her 1 saatte bir çalışır
async function checkAndActivatePeriods() {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD formatı
    const periods = await db.getAllPeriods();
    
    for (const period of periods) {
      if (period.durum === 'Bekliyor' && period.baslangicTarihi <= today) {
        await db.activatePeriod(period.id);
      }
    }
  } catch (error) {
    console.error('Dönem kontrolünde hata:', error);
  }
}

// Production başlangıç kontrolleri
function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const required = ['JWT_SECRET', 'CORS_ORIGIN'];
  const missing = required.filter(k => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    console.error('FATAL: Production\'da şu ortam değişkenleri zorunludur:', missing.join(', '));
    process.exit(1);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET en az 32 karakter olmalı (güvenlik için)');
    process.exit(1);
  }
}

(async () => {
  try {
    validateProductionConfig();
    await db.init();

    // Dönem kontrolünü init'ten SONRA yap (DB hazır olmalı)
    checkAndActivatePeriods();
    setInterval(checkAndActivatePeriods, 3600000);

    app.listen(port, () => {
      console.log(`Futbol Okulu sunucusu http://localhost:${port} adresinde çalışıyor`);
      const dbType = (process.env.USE_SQLITE === 'true' || process.env.USE_SQLITE === '1') ? 'SQLite' : (process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite');
      console.log(`✅ ${dbType} veritabanı aktif`);
    });
  } catch (err) {
    console.error('Sunucu başlatma hatası:', err.message);
    process.exit(1);
  }
})();

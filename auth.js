/**
 * Kimlik doğrulama middleware
 * JWT token kontrolü ve rol bazlı yetkilendirme
 */
const jwt = require('jsonwebtoken');

const DEFAULT_DEV_SECRET = 'futbol-okulu-gizli-anahtar-degistirin';
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : DEFAULT_DEV_SECRET);
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: Production\'da JWT_SECRET ortam değişkeni zorunludur!');
  process.exit(1);
}
if (process.env.NODE_ENV !== 'production' && JWT_SECRET === DEFAULT_DEV_SECRET) {
  console.warn('UYARI: Varsayılan JWT_SECRET kullanılıyor. Production öncesi .env dosyasında değiştirin!');
}
const JWT_EXPIRES = process.env.JWT_EXPIRES || '1d';

function generateToken(user) {
  const subeId = user.subeId ?? user.subeid;
  return jwt.sign(
    { id: user.id, rol: user.rol, subeId },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/** DB'den kullanıcı aktiflik kontrolü - token revoke için */
let checkUserActive = null;
function setCheckUserActive(fn) {
  checkUserActive = fn;
}

function verifyToken(req, res, next) {
  // Öncelik: HttpOnly cookie (XSS koruması), sonra Authorization header (fallback)
  let token = req.cookies?.token || null;
  if (!token) {
    const authHeader = req.headers.authorization;
    token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  }

  if (!token) {
    return res.status(401).json({ error: 'Oturum açmanız gerekiyor' });
  }

  try {
    if (!JWT_SECRET) {
      return res.status(503).json({ error: 'Sunucu yapılandırma hatası' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    if (checkUserActive && decoded.id) {
      checkUserActive(decoded.id).then(active => {
        if (active === false) {
          return res.status(401).json({ error: 'Hesabınız devre dışı bırakılmış' });
        }
        next();
      }).catch(() => res.status(503).json({ error: 'Sunucu geçici olarak kullanılamıyor' }));
    } else {
      next();
    }
  } catch (err) {
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum' });
  }
}

/** Admin veya yönetici gerekli */
function requireAdminOrYonetici(req, res, next) {
  if (!['admin', 'yonetici'].includes(req.user.rol)) {
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  }
  next();
}

/** Sadece admin */
function requireAdmin(req, res, next) {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekli' });
  }
  next();
}

/** Admin, yönetici veya antrenör */
function requireStaff(req, res, next) {
  if (!['admin', 'yonetici', 'antrenor'].includes(req.user.rol)) {
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  }
  next();
}

/** Veli kendi verisine erişebilir - parentUserId === req.user.id kontrolü */
function requireOwnParent(req, res, next) {
  const requestedId = parseInt(req.params.parentUserId, 10);
  if (isNaN(requestedId) || requestedId < 1) {
    return res.status(400).json({ error: 'Geçersiz ID' });
  }
  if (req.user.rol !== 'veli' || req.user.id !== requestedId) {
    return res.status(403).json({ error: 'Yetkisiz erişim' });
  }
  next();
}

/** Veli notları - veli sadece kendi notlarına, admin/yönetici hepsine erişir */
function requireParentNotesAccess(req, res, next) {
  const parentUserId = parseInt(req.params.parentUserId, 10);
  if (isNaN(parentUserId) || parentUserId < 1) {
    return res.status(400).json({ error: 'Geçersiz ID' });
  }
  if (req.user.rol === 'veli' && req.user.id !== parentUserId) {
    return res.status(403).json({ error: 'Yetkisiz erişim' });
  }
  next();
}

module.exports = {
  generateToken,
  verifyToken,
  setCheckUserActive,
  requireAdminOrYonetici,
  requireAdmin,
  requireOwnParent,
  requireParentNotesAccess,
  requireStaff
};

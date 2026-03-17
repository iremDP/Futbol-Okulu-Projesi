/**
 * Admin şifresini sıfırlar.
 * SQLite veya PostgreSQL ile çalışır (.env ayarlarına göre).
 *
 * Kullanım:
 *   node scripts/reset-admin-password.js
 *   node scripts/reset-admin-password.js yeniSifre123
 *
 * Şifre belirtilmezse varsayılan: admin123
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcrypt');

async function main() {
  const db = require('../db');
  const newPassword = process.argv[2] || 'admin123';

  if (newPassword.length < 6) {
    console.error('Hata: Şifre en az 6 karakter olmalı.');
    process.exit(1);
  }

  console.log('Veritabanına bağlanılıyor...');
  await db.init();

  const admin = await db.getUserByUsername('admin');
  if (!admin) {
    console.error('Hata: admin kullanıcısı bulunamadı.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await db.updateUserPassword(admin.id, hash);

  // İlk şifre zorunlu değiştirme uyarısını kaldır
  if (typeof db.deleteSetting === 'function') {
    await db.deleteSetting('admin_initial_password_hash');
  }

  console.log('\n✓ Admin şifresi başarıyla sıfırlandı.');
  console.log('  Kullanıcı: admin');
  console.log('  Yeni şifre:', newPassword);
  console.log('\nİlk girişte bu şifreyi değiştirmeniz önerilir.\n');
}

main().catch((err) => {
  console.error('Hata:', err.message);
  process.exit(1);
});

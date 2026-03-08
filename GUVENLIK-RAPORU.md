# Futbol Okulu - Güvenlik Raporu

**Son güncelleme:** Mart 2026

## ✅ Uygulanan Güvenlik Önlemleri

### 1. Kimlik Doğrulama
- **JWT token** ile oturum yönetimi
- Tüm API endpoint'leri (login hariç) kimlik doğrulama gerektirir
- Token süresi: 1 gün (varsayılan, XSS riskini azaltmak için)

### 2. Şifre Güvenliği
- **bcrypt** ile şifre hashleme (10 round)
- API yanıtlarında şifre/hash **hiçbir zaman** gönderilmez
- Kullanıcı listesinde şifre alanı maskelenir (••••••••)

### 3. Yetkilendirme
- **Admin:** Şubeler (ekleme, güncelleme, silme, toggle)
- **Admin/Yönetici:** Kullanıcılar, ayarlar, kayıt
- **Veli:** Sadece kendi öğrenci verileri (`/api/parent/:id/students`)
- **Yönetici şube izolasyonu:** Yönetici sadece kendi şubesinin verisini görür/düzenler

### 4. IDOR Koruması
- Yönetici başka şubedeki öğrenciyi güncelleyemez/silemez
- Aktif/pasif öğrenci listesi şube filtresine tabi

### 5. Rate Limiting
- Login: 15 dakikada max 10 deneme (brute force koruması)

### 6. Diğer
- **Helmet** - HTTP güvenlik başlıkları
- **CORS** - `CORS_ORIGIN` ile kısıtlanabilir
- **Production:** Hata mesajları gizlenir (detay sızıntısı önlenir)
- **SQL:** Parametreli sorgular (SQL injection koruması)

---

## 📋 Production Checklist

| Öğe | Durum |
|-----|-------|
| `.env` dosyası oluşturuldu | ☐ |
| `JWT_SECRET` güçlü değerle değiştirildi | ☐ |
| `NODE_ENV=production` ayarlandı | ☐ |
| Admin şifresi değiştirildi | ☐ |
| HTTPS kullanılıyor | ☐ |
| `CORS_ORIGIN` kendi domain ile ayarlandı | ☐ |

---

## Son Revizyonlar (Mart 2026) - v9.1

- **Veli-öğrenci eşleştirmesi:** Bellekte filtre yerine SQL (getParentStudentIds, getStudentsByParentUserId)
- **Rate limiting:** Login'de kullanıcı adı bazlı limit (dağıtık brute force koruması)
- **Admin şifre:** admin/admin123 ile girişte mustChangePassword, kullanicilar sayfasına yönlendirme
- **Token revoke:** verifyToken'da DB'den kullanıcı aktiflik kontrolü (silinen/devre dışı hesaplar)
- **Mass assignment:** Tüm create/update endpoint'lerinde whitelist (pickAllowed) kullanılıyor
- **CSP:** Helmet Content-Security-Policy aktif (scriptSrc, styleSrc unsafe-inline ile)
- **HTTPS:** Production'da x-forwarded-proto ile HTTPS zorlaması
- **Veli şifresi:** TC yoksa rastgele şifre üretiliyor ve API/import yanıtında gösteriliyor
- **NetGSM:** GET yerine POST/XML API kullanılıyor (credentials URL'de değil body'de)
- **Production hazırlık:** PRODUCTION-CHECKLIST.md; JWT_SECRET min 32 karakter; global hata yakalayıcı; 404 handler; login input validasyonu
- **Güvenlik:** Yönetici admin/yonetici oluşturamaz; Excel import dosya tipi + uzantı; hassas endpoint rol kontrolü; parseInt NaN; JWT 1 gün; JWT_SECRET export kaldırıldı
- Veli otomatik şifresi bcrypt ile hashleniyor
- console.log ve şifre loglaması kaldırıldı
- parent-notes, payments, accounting yetkilendirildi
- Veli öğrenci ödemeleri - sadece kendi çocuğu
- deletePayment/deletePeriodPayment ayrıştırıldı
- /api/health endpoint eklendi
- package.json start script

## ⚠️ Bilinen Sınırlamalar

- **XSS:** Kullanıcı girdileri `innerHTML` ile render edilebilir; özel karakterler escape edilmiyor
- **Input validation:** Gelen veriler detaylı validate edilmiyor (express-validator önerilir)
- **Veritabanı:** SQLite - yüksek trafikte performans sınırlı

---

## 🔧 Önerilen İyileştirmeler (İleride)

1. **HTTPS zorunluluğu** - Production'da HTTP'yi reddet
2. **Şifre politikası** - Minimum uzunluk, karmaşıklık kuralları
3. **Audit log** - Kritik işlemlerin kaydı
4. **2FA** - Admin hesapları için iki faktörlü doğrulama

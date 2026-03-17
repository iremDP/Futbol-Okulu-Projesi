# PostgreSQL Kurulumu - Futbol Okulu

Bu rehber PostgreSQL bağlantısını adım adım kurmanızı sağlar.

## Ön koşul

PostgreSQL yüklü olmalı. İndir: https://www.postgresql.org/download/windows/

Kurulum sırasında **postgres** kullanıcısı için bir şifre belirleyin. Bu şifreyi not alın.

---

## Adım 1: .env dosyası

Proje kökünde `.env` dosyası yoksa:

```bash
copy .env.example .env
```

`.env` dosyasını açın ve şu satırı bulun (yorum satırı olabilir):

```
# DATABASE_URL=postgresql://postgres:SIZIN_SIFRENIZ@localhost:5432/futbol_okulu
```

**Başındaki `#` işaretini kaldırın** ve `SIZIN_SIFRENIZ` yerine PostgreSQL kurulumunda belirlediğiniz şifreyi yazın:

```
DATABASE_URL=postgresql://postgres:gercek_sifreniz@localhost:5432/futbol_okulu
```

---

## Adım 2: Veritabanını oluşturun

```bash
npm run pg:setup
```

Bu komut `futbol_okulu` veritabanını oluşturur. Başarılı olursa "✓ futbol_okulu veritabanı oluşturuldu" mesajını görürsünüz.

---

## Adım 3: SQLite verisi varsa taşıyın

Mevcut `futbol-okulu.db` dosyanız varsa (öğrenci, ödeme vb. veriler):

```bash
# Önce sunucuyu durdurun (Ctrl+C)
npm run migrate
```

---

## Adım 4: Bağlantıyı test edin

```bash
npm run pg:check
```

Bu komut adım adım kontrol eder:
- .env dosyası var mı
- DATABASE_URL tanımlı mı
- PostgreSQL'e bağlanılabiliyor mu
- Tablolar ve kayıt sayıları

Hata varsa ne yapmanız gerektiğini söyler.

---

## Adım 5: Uygulamayı başlatın

```bash
npm start
```

"✅ PostgreSQL aktif" mesajını görmelisiniz.

---

## Sorun giderme

| Hata | Çözüm |
|------|-------|
| **password authentication failed** | .env'deki DATABASE_URL içindeki şifre yanlış. Kurulumda belirlediğiniz postgres şifresini kullanın. |
| **connect ECONNREFUSED** | PostgreSQL servisi çalışmıyor. Windows: `Services` > `postgresql-x64-16` > Start |
| **database "futbol_okulu" does not exist** | `npm run pg:setup` çalıştırın |
| **Veriler görünmüyor** | `npm run migrate` ile SQLite verisini taşıyın. `futbol-okulu.db` proje kökünde olmalı. |

### Teşhis komutu

Sorun yaşıyorsanız önce:

```bash
npm run pg:check
```

Bu komut sorunu tespit eder ve ne yapmanız gerektiğini söyler.

---

## SQLite'a geri dönmek

PostgreSQL sorun çıkarıyorsa geçici olarak SQLite kullanabilirsiniz:

1. `.env` dosyasına ekleyin: `USE_SQLITE=true`
2. `DATABASE_URL` satırını yorum yapın (# ile başlatın) veya silin
3. `npm start`

# PostgreSQL ile Yüksek Ölçek Kurulumu

On binlerce öğrenci ve veli verisi için PostgreSQL kullanmanız önerilir. SQLite eşzamanlı yazma ve büyük veri setlerinde sınırlıdır.

## 1. PostgreSQL Kurulumu

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
```

**Windows:** https://www.postgresql.org/download/windows/

## 2. Veritabanı Oluşturma

```bash
sudo -u postgres psql
CREATE DATABASE futbol_okulu;
CREATE USER futbol_user WITH ENCRYPTED PASSWORD 'güçlü_şifre';
GRANT ALL PRIVILEGES ON DATABASE futbol_okulu TO futbol_user;
\q
```

## 3. Schema Yükleme (ilk kurulum)

```bash
psql -U futbol_user -d futbol_okulu -f schema-postgres.sql
```

Veya uygulama ilk çalıştığında `database-pg.js` otomatik tablo oluşturur.

## 4. Ortam Değişkenleri

`.env` dosyasına ekleyin:

```env
DATABASE_URL=postgresql://futbol_user:güçlü_şifre@localhost:5432/futbol_okulu
```

## 5. Bağlantı Havuzu

PostgreSQL adapter varsayılan olarak 20 bağlantılı pool kullanır. Yüksek trafikte `database-pg.js` içindeki `max: 20` değerini artırabilirsiniz.

## 6. Yedekleme

```bash
pg_dump -U futbol_user futbol_okulu > yedek_$(date +%Y%m%d).sql
```

## 7. SQLite'dan Geçiş

Mevcut SQLite veritabanından PostgreSQL'e veri taşımak için özel bir migration script yazmanız gerekir. Şu an manuel export/import veya pgloader gibi araçlar kullanılabilir.

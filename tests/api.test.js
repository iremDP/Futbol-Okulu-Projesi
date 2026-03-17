/**
 * API entegrasyon testleri
 * Veritabanı gerekir (SQLite varsayılan). USE_SQLITE=true ile çalıştırın.
 */
const request = require('supertest');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.USE_SQLITE = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-32-characters-long';
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../db');
let app;

beforeAll(async () => {
  await db.init();
  app = require('../index');
}, 15000);

describe('Genel API', () => {
  it('GET /durum - sunucu durumu', async () => {
    const res = await request(app).get('/durum');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });

  it('GET /api/ping - API ping', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /api/health - sağlık kontrolü', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('POST /api/login - eksik bilgi ile 400', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ kullaniciAdi: '' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
  });

  it('POST /api/login - yanlış şifre ile 401', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ kullaniciAdi: 'admin', sifre: 'yanlis-sifre' })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(401);
  });
});

describe('Korumalı endpointler', () => {
  it('GET /api/students - token olmadan 401', async () => {
    const res = await request(app).get('/api/students');
    expect(res.status).toBe(401);
  });

  it('GET /api/me - token olmadan 401', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });
});

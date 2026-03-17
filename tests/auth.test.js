/**
 * Auth modülü birim testleri
 */
const jwt = require('jsonwebtoken');

// JWT_SECRET test ortamı için
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-32-characters-long';
process.env.NODE_ENV = 'test';

const auth = require('../auth');

describe('auth.generateToken', () => {
  it('geçerli kullanıcı için token üretir', () => {
    const user = { id: 1, rol: 'admin', subeId: null };
    const token = auth.generateToken(user);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    const decoded = jwt.decode(token);
    expect(decoded.id).toBe(1);
    expect(decoded.rol).toBe('admin');
  });
});

describe('auth.requireAdminOrYonetici', () => {
  const next = jest.fn();
  beforeEach(() => next.mockClear());

  it('admin için next() çağırır', () => {
    const req = { user: { rol: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    auth.requireAdminOrYonetici(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('yonetici için next() çağırır', () => {
    const req = { user: { rol: 'yonetici' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    auth.requireAdminOrYonetici(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('veli için 403 döner', () => {
    const req = { user: { rol: 'veli' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    auth.requireAdminOrYonetici(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('auth.requireAdmin', () => {
  const next = jest.fn();
  beforeEach(() => next.mockClear());

  it('admin için next() çağırır', () => {
    const req = { user: { rol: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    auth.requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('yonetici için 403 döner', () => {
    const req = { user: { rol: 'yonetici' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    auth.requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('auth.requireStaff', () => {
  const next = jest.fn();
  beforeEach(() => next.mockClear());

  it('antrenor için next() çağırır', () => {
    const req = { user: { rol: 'antrenor' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    auth.requireStaff(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('veli için 403 döner', () => {
    const req = { user: { rol: 'veli' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    auth.requireStaff(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

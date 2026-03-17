/**
 * PostgreSQL lowercase sütun adlarını camelCase'e çevirir.
 * Frontend camelCase beklediği için API yanıtlarında kullanılır.
 */
function toCamelCase(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const KEY_MAP = {
  kullaniciadi: 'kullaniciAdi', adsoyad: 'adSoyad', tcno: 'tcNo',
  subeadi: 'subeAdi', subeid: 'subeId', olusturmatarihi: 'olusturmaTarihi',
  groupname: 'groupName', instructorid: 'instructorId', kapanis: 'kapanis',
  donemadi: 'donemAdi', baslangictarihi: 'baslangicTarihi', bitistarihi: 'bitisTarihi',
  dogumtarihi: 'dogumTarihi', kayittarihi: 'kayitTarihi', kayitkaynagi: 'kayitKaynagi',
  veliadi: 'veliAdi', velitelefon1: 'veliTelefon1', velitelefon2: 'veliTelefon2',
  ayrilmatarihi: 'ayrilmaTarihi',   odemetarihi: 'odemeTarihi', odemeyontemi: 'odemeYontemi', odemedurumu: 'odemeDurumu',
  instructorsubeadi: 'instructorSubeAdi', instructorsubeid: 'instructorSubeId',
  studentid: 'studentId', groupid: 'groupId', periodid: 'periodId', sessionid: 'sessionId',
  presentcount: 'presentCount', absentcount: 'absentCount', sessioncount: 'sessionCount',
  createdat: 'createdAt', createdby: 'createdBy', ispublic: 'isPublic',
  parentuserid: 'parentUserId', degisimtarihi: 'degisimTarihi', degistirenkullanici: 'degistirenKullanici',
  aicomment: 'aiComment', createdrole: 'createdRole', olcumno: 'olcumNo',
  metrickey: 'metricKey', teamavg: 'teamAvg', generalavg: 'generalAvg',
  periodsubeid: 'periodSubeId', sonaktiftarihi: 'sonAktifTarihi'
};

function mapKey(key) {
  if (!key) return key;
  const lower = key.toLowerCase();
  return KEY_MAP[lower] || (key.includes('_') ? toCamelCase(key) : key);
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const newKey = mapKey(k);
    out[newKey] = Array.isArray(v) ? v.map(normalizeRow) : (v && typeof v === 'object' && !(v instanceof Date) ? normalizeRow(v) : v);
  }
  return out;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(normalizeRow);
}

module.exports = { normalizeRow, normalizeRows, mapKey };

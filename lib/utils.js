/**
 * Ortak yardımcı fonksiyonlar
 */

function safeParseId(val) {
  const id = parseInt(val, 10);
  return (isNaN(id) || id < 1) ? null : id;
}

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

function safeErrorMsg(msg, isProduction) {
  return isProduction ? 'Bir hata oluştu' : msg;
}

module.exports = {
  safeParseId,
  safeQueryId,
  pickAllowed,
  safeErrorMsg
};

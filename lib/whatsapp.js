/**
 * WhatsApp gönderim yardımcı modülü.
 * .env içinde WHATSAPP_API_TOKEN + WHATSAPP_PHONE_NUMBER_ID varsa
 * Meta WhatsApp Cloud API ile mesaj gönderir; yoksa sessizce no-op.
 *
 * Not: Meta, 24 saatlik "müşteri servis" penceresi dışında yalnızca ONAYLI
 * "template" mesajlarına izin verir. Bu yüzden varsayılan olarak template
 * kullanılır; WHATSAPP_USE_PLAIN=1 ise düz metin denenir.
 *
 * Ayrıca "wa.me" click-to-chat bağlantısı için buildClickToChatUrl() yardımcı.
 */
const logger = require('./logger');

const API_VERSION = (process.env.WHATSAPP_API_VERSION || 'v20.0').trim();
const TOKEN = (process.env.WHATSAPP_API_TOKEN || '').trim();
const PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const TEMPLATE_NAME = (process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
const LANGUAGE_CODE = (process.env.WHATSAPP_LANGUAGE_CODE || 'tr').trim();
const USE_PLAIN = /^(1|true|yes)$/i.test(process.env.WHATSAPP_USE_PLAIN || '');

function isEnabled() {
  return !!(TOKEN && PHONE_NUMBER_ID);
}

/** Telefonu E.164'e yakın temizler. TR için başında 0 varsa 90 ekler. */
function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('90') && d.length >= 12) return d;
  if (d.startsWith('0') && d.length === 11) return '9' + d;
  if (d.length === 10) return '90' + d;
  if (d.length >= 10) return d;
  return null;
}

/** wa.me click-to-chat bağlantısı üretir — ücretsiz, tarayıcı/telefondan manuel gönderim içindir. */
function buildClickToChatUrl(phone, message) {
  const num = normalizePhone(phone);
  if (!num) return null;
  return 'https://wa.me/' + num + '?text=' + encodeURIComponent(message || '');
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (_) { /* sessiz */ }
  if (!res.ok) {
    const errMsg = payload?.error?.message || res.statusText || 'WhatsApp hatası';
    const err = new Error(errMsg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

/**
 * Template mesaj gönder. parameters: body değişkenleri string dizisi.
 * Örn: template "odeme_hatirlatma" için parameters: [veliAd, donemAd, tutar, bitisTarihi]
 */
async function sendTemplate(phone, parameters = []) {
  if (!isEnabled() || !TEMPLATE_NAME) return { skipped: true };
  const num = normalizePhone(phone);
  if (!num) return { error: 'invalid-phone' };
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const components = parameters.length
    ? [{
        type: 'body',
        parameters: parameters.map(p => ({ type: 'text', text: String(p ?? '') }))
      }]
    : [];
  try {
    const payload = await postJson(url, {
      messaging_product: 'whatsapp',
      to: num,
      type: 'template',
      template: {
        name: TEMPLATE_NAME,
        language: { code: LANGUAGE_CODE },
        ...(components.length ? { components } : {})
      }
    });
    return { ok: true, id: payload?.messages?.[0]?.id || null };
  } catch (err) {
    logger.warn('WhatsApp template hatası: ' + err.message);
    return { error: err.message };
  }
}

/** Plain text (24 saat penceresinde); template yoksa fallback için denenebilir. */
async function sendText(phone, text) {
  if (!isEnabled()) return { skipped: true };
  if (!USE_PLAIN && TEMPLATE_NAME) {
    return { skipped: true, reason: 'plain-disabled' };
  }
  const num = normalizePhone(phone);
  if (!num) return { error: 'invalid-phone' };
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  try {
    const payload = await postJson(url, {
      messaging_product: 'whatsapp',
      to: num,
      type: 'text',
      text: { body: text || '' }
    });
    return { ok: true, id: payload?.messages?.[0]?.id || null };
  } catch (err) {
    logger.warn('WhatsApp text hatası: ' + err.message);
    return { error: err.message };
  }
}

/** Birden fazla veli için sırayla gönderim; özet döner. */
async function sendBulk(recipients, builder) {
  // recipients: [{ phone, params, text }]
  const result = { sent: 0, skipped: 0, failed: 0, enabled: isEnabled() };
  if (!isEnabled()) { result.skipped = recipients.length; return result; }
  for (const r of recipients) {
    const params = typeof builder === 'function' ? builder(r) : null;
    let res;
    if (TEMPLATE_NAME) res = await sendTemplate(r.phone, params?.parameters || r.params || []);
    else res = await sendText(r.phone, params?.text || r.text || '');
    if (res?.ok) result.sent++;
    else if (res?.skipped) result.skipped++;
    else result.failed++;
  }
  return result;
}

module.exports = {
  isEnabled,
  normalizePhone,
  buildClickToChatUrl,
  sendTemplate,
  sendText,
  sendBulk
};

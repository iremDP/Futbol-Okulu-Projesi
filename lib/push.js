/**
 * Web Push yardımcı modülü.
 * VAPID anahtarları .env'de yoksa sessizce devre dışı kalır (no-op).
 * Anahtar üretimi: `npm run push:keys`
 */
const logger = require('./logger');

let webPush = null;
let enabled = false;

try {
  webPush = require('web-push');
} catch (_) {
  webPush = null;
}

const VAPID_PUBLIC = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:admin@example.com';

if (webPush && VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    enabled = true;
  } catch (e) {
    logger.warn('Web Push yapılandırma hatası: ' + e.message);
    enabled = false;
  }
}

function getPublicKey() {
  return enabled ? VAPID_PUBLIC : null;
}

function isEnabled() {
  return enabled;
}

/** subscription: { endpoint, keys: { p256dh, auth } } — payload: { title, body, url? } */
async function sendToSubscription(subscription, payload) {
  if (!enabled) return { skipped: true };
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const status = err.statusCode;
    if (status === 404 || status === 410) {
      return { expired: true, endpoint: subscription.endpoint };
    }
    logger.warn('Push gönderim hatası: ' + (err.message || status));
    return { error: err.message || String(status) };
  }
}

/** db: ./db modülü; userIds: array; payload: { title, body, url? } */
async function sendToUsers(db, userIds, payload) {
  if (!enabled || !Array.isArray(userIds) || userIds.length === 0) return { sent: 0, skipped: true };
  let sent = 0;
  const toRemove = [];
  for (const uid of userIds) {
    try {
      const subs = await db.getPushSubscriptionsByUserId(uid);
      for (const s of subs || []) {
        const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
        const r = await sendToSubscription(sub, payload);
        if (r && r.ok) sent++;
        if (r && r.expired) toRemove.push(s.endpoint);
      }
    } catch (e) {
      logger.warn('sendToUsers kullanıcı hatası: ' + e.message);
    }
  }
  for (const ep of toRemove) {
    try { await db.removePushSubscription(ep); } catch (_) { /* sessiz */ }
  }
  return { sent };
}

module.exports = {
  getPublicKey,
  isEnabled,
  sendToSubscription,
  sendToUsers
};

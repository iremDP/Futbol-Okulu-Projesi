/**
 * Tarayıcıdan Web Push aboneliği kurar/kaldırır.
 * Kullanım: <script src="/push-client.js"></script>; buton click'inde PushClient.enable()
 */
(function () {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) throw new Error('Bu tarayıcı desteklemiyor');
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) reg = await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function getVapidPublicKey() {
    const res = await fetch('/api/push/vapid-key');
    if (!res.ok) throw new Error('Sunucu bildirimleri kapalı');
    const data = await res.json();
    if (!data.publicKey) throw new Error('VAPID anahtarı yok');
    return data.publicKey;
  }

  async function isEnabled() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch (_) { return false; }
  }

  async function enable() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('Bu tarayıcı push bildirimlerini desteklemiyor');
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Bildirim izni reddedildi');

    const reg = await ensureServiceWorker();
    const vapidPublic = await getVapidPublicKey();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic)
      });
    }
    const json = sub.toJSON();
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Abonelik kaydedilemedi');
    }
    return true;
  }

  async function disable() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return true;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return true;
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint })
      }).catch(() => {});
      return true;
    } catch (e) {
      return false;
    }
  }

  async function test() {
    const res = await fetch('/api/push/test', { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Test gönderilemedi');
    }
    return true;
  }

  window.PushClient = { enable, disable, isEnabled, test };
})();

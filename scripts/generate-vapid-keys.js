/**
 * VAPID anahtar çifti üretir. Konsola .env'e kopyalanacak satırları basar.
 * Kullanım: npm run push:keys
 */
const webPush = require('web-push');
const keys = webPush.generateVAPIDKeys();
console.log('# .env içine ekleyin (push bildirimleri için)');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('VAPID_SUBJECT=mailto:admin@futbolokulu.com');

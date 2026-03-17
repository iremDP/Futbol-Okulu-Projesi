/**
 * API yardımcıları - Kimlik doğrulama HttpOnly cookie ile (XSS güvenli)
 * Tüm sayfalarda bu dosya menu.js'den önce yüklenmeli
 */
(function() {
    const API_BASE = window.location.origin + '/api';

    /** XSS koruması - innerHTML ve attribute'larda kullanıcı verisini escape et */
    window.esc = function(str) {
        if (str == null || str === undefined) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML.replace(/'/g, '&#39;');
    };
    
    window.API_URL = API_BASE;
    
    /** API istekleri için header - credentials: 'include' cookie gönderir */
    window.getAuthHeaders = function() {
        return { 'Content-Type': 'application/json' };
    };

    /** Çıkış - HttpOnly cookie temizlenir */
    window.logout = function() {
        fetch(API_BASE + '/logout', { method: 'POST', credentials: 'include' }).finally(function() {
            localStorage.removeItem('currentUser');
            localStorage.removeItem('mustChangePassword');
            window.location.href = 'login.html';
        });
    };

    /** Makbuz PDF - credentials: 'include' ile cookie gönderilir */
    window.openReceipt = async function(paymentId) {
        try {
            const url = API_BASE + '/period-payments/' + paymentId + '/receipt';
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || 'Makbuz alınamadı');
                return;
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            window.open(objectUrl, '_blank');
            setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
        } catch (e) {
            alert('Makbuz açılamadı: ' + (e.message || 'Bilinmeyen hata'));
        }
    };
    
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
        options = options || {};
        const isApi = typeof url === 'string' && (url.includes('/api/') || url.includes('/api'));
        if (isApi) {
            options.credentials = options.credentials || 'include';
        }
        return originalFetch.call(this, url, options).then(function(res) {
            if (res.status === 401 && isApi && String(url).indexOf('/login') === -1) {
                fetch(API_BASE + '/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
                localStorage.removeItem('currentUser');
                localStorage.removeItem('mustChangePassword');
                window.location.href = 'login.html';
            }
            return res;
        });
    };
})();

/* PWA Service Worker kaydı */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/service-worker.js').catch(function() {});
    });
}

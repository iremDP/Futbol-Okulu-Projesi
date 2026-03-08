/**
 * API yardımcıları - JWT token ile kimlik doğrulama
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
    
    window.getAuthHeaders = function() {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        return headers;
    };

    /** Makbuz PDF'ini token ile fetch edip yeni sekmede açar (link tıklaması token göndermez) */
    window.openReceipt = async function(paymentId) {
        try {
            const url = API_BASE + '/period-payments/' + paymentId + '/receipt';
            const res = await fetch(url);
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
        const token = localStorage.getItem('token');
        const isApi = typeof url === 'string' && (url.includes('/api/') || url.includes('/api'));
        if (token && isApi) {
            const h = options.headers;
            if (h && typeof h.set === 'function') {
                h.set('Authorization', 'Bearer ' + token);
            } else {
                options.headers = { ...(h || {}), 'Authorization': 'Bearer ' + token };
            }
        }
        return originalFetch.call(this, url, options).then(function(res) {
            if (res.status === 401 && isApi && String(url).indexOf('/login') === -1) {
                localStorage.removeItem('token');
                localStorage.removeItem('currentUser');
                window.location.href = 'login.html';
            }
            return res;
        });
    };
})();

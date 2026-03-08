(function () {
    function buildMenu() {
        const userRaw = localStorage.getItem('currentUser');
        if (!userRaw) return;

        const user = JSON.parse(userRaw);
        const navMenu = document.getElementById('navMenu');
        if (!navMenu) return;

        let items = [];

        if (user.rol === 'admin' || user.rol === 'yonetici') {
            items = [
                { href: 'dashboard.html', text: '📊 Dashboard' },
                { href: 'index.html', text: '👥 Öğrenciler' },
                { href: 'gruplar.html', text: '📊 Gruplar' },
                { href: 'testler.html', text: '🧪 Testler' },
                { href: 'odemeler.html', text: '💰 Ödemeler' },
                { href: 'donemler.html', text: '📅 Dönemler' },
                { href: 'raporlar.html', text: '📑 Raporlar' }
            ];

            if (user.rol === 'admin') {
                items.push({ href: 'subeler.html', text: '🏢 Şubeler' });
                items.push({ href: 'kullanicilar.html', text: '🔐 Kullanıcılar', isAdmin: true });
            } else if (user.rol === 'yonetici') {
                items.push({ href: 'kullanicilar.html', text: '🔐 Kullanıcılar' });
            }
        } else if (user.rol === 'antrenor') {
            items = [
                { href: 'gruplar.html', text: '📊 Gruplar' },
                { href: 'testler.html', text: '🧪 Testler' }
            ];
        }

        navMenu.style.display = 'flex';
        navMenu.style.gap = '10px';
        navMenu.style.flexWrap = 'wrap';

        const baseStyle =
            'padding: 8px 12px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;';

        navMenu.innerHTML = items
            .map(item => {
                const style = item.isAdmin
                    ? `${baseStyle} background: #dc3545;`
                    : baseStyle;
                const className = item.isAdmin ? 'admin-link' : '';
                return `<a href="${item.href}" class="${className}" style="${style}">${item.text}</a>`;
            })
            .join('');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildMenu);
    } else {
        buildMenu();
    }
})();

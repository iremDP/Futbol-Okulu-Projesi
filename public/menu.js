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
                // { href: 'testler.html', text: '🧪 Testler' }, // Gizli - ileride tekrar açılabilir
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
                { href: 'gruplar.html', text: '📊 Gruplar' }
                // { href: 'testler.html', text: '🧪 Testler' } // Gizli - ileride tekrar açılabilir
            ];
        }

        const baseStyle =
            'padding: 8px 12px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;';

        const linksHtml = items
            .map(item => {
                const style = item.isAdmin
                    ? `${baseStyle} background: #dc3545;`
                    : baseStyle;
                const className = item.isAdmin ? 'admin-link' : '';
                return `<a href="${item.href}" class="${className}" style="${style}">${item.text}</a>`;
            })
            .join('');

        navMenu.className = 'nav-wrapper';
        navMenu.innerHTML = '<button class="hamburger-btn" type="button" aria-label="Menüyü aç" aria-expanded="false">☰</button><div class="nav-links">' + linksHtml + '</div>';

        const hamburger = navMenu.querySelector('.hamburger-btn');
        const navLinks = navMenu.querySelector('.nav-links');
        if (hamburger && navLinks) {
            hamburger.addEventListener('click', function () {
                const open = navLinks.classList.toggle('nav-open');
                hamburger.setAttribute('aria-expanded', open);
                hamburger.textContent = open ? '✕' : '☰';
            });
            document.addEventListener('click', function (e) {
                if (navLinks.classList.contains('nav-open') && !navMenu.contains(e.target)) {
                    navLinks.classList.remove('nav-open');
                    hamburger.setAttribute('aria-expanded', 'false');
                    hamburger.textContent = '☰';
                }
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildMenu);
    } else {
        buildMenu();
    }
})();

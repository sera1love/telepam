// === AUTHENTICATION MODULE ===
const AuthModule = {
    currentTab: 'login',

    init() {
        this.bindEvents();
        this.checkAuth();
    },

    bindEvents() {
        // Переключение табов
        getElement('loginTab')?.addEventListener('click', () => this.switchTab('login'));
        getElement('registerTab')?.addEventListener('click', () => this.switchTab('register'));

        // Кнопки
        getElement('loginBtn')?.addEventListener('click', () => this.handleLogin());
        getElement('registerBtn')?.addEventListener('click', () => this.handleRegister());
        getElement('logoutBtn')?.addEventListener('click', () => this.logout());
    },

    switchTab(tab) {
        this.currentTab = tab;
        getElement('loginTab')?.classList.toggle('active', tab === 'login');
        getElement('registerTab')?.classList.toggle('active', tab === 'register');
        toggleHidden('loginForm', tab === 'login');
        toggleHidden('registerForm', tab !== 'login');
    },

    async checkAuth() {
        try {
            const saved = localStorage.getItem('mm_user');
            if (saved) {
                App.currentUser = JSON.parse(saved);
                socket.emit('user_login', App.currentUser.id);
                await App.loadUserSettings();
                App.showApp();
            } else {
                toggleHidden('authModal', true);
            }
        } catch (error) {
            console.error('Auth check error:', error);
            toggleHidden('authModal', true);
        }
    },

    async handleLogin() {
        try {
            const id = getElement('loginId')?.value.trim();
            const pass = getElement('loginPass')?.value;

            if (!id?.startsWith('@')) {
                showToast('ID должен начинаться с @');
                return;
            }

            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, password: pass })
            });

            const data = await res.json();
            if (data.success) {
                App.currentUser = data.user;
                localStorage.setItem('mm_user', JSON.stringify(App.currentUser));
                localStorage.setItem('telepam_last_visit', Date.now().toString());
                socket.emit('user_login', App.currentUser.id);
                toggleHidden('authModal', false);
                App.showApp();
            } else {
                showToast(data.error || 'Ошибка входа');
            }
        } catch (error) {
            console.error('Login error:', error);
            showToast('Ошибка: ' + error.message);
        }
    },

    async handleRegister() {
        try {
            const id = getElement('authId')?.value.trim();
            const name = getElement('authName')?.value.trim();
            const surname = getElement('authSurname')?.value.trim();
            const pass = getElement('authPass')?.value;
            const color = getElement('authColor')?.value;
            const bio = getElement('authBio')?.value;
            const avatarFile = getElement('authAvatar')?.files[0];

            if (!id?.startsWith('@')) {
                showToast('ID должен начинаться с @');
                return;
            }
            if (!name) {
                showToast('Введите имя');
                return;
            }

            let avatarUrl = null;
            if (avatarFile) {
                const formData = new FormData();
                formData.append('file', avatarFile);
                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json();
                avatarUrl = data.url;
            }

            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id, name, surname, password: pass,
                    avatarColor: color, avatarImage: avatarUrl, bio
                })
            });

            const data = await res.json();
            if (data.success) {
                App.currentUser = data.user;
                localStorage.setItem('mm_user', JSON.stringify(App.currentUser));
                localStorage.setItem('telepam_last_visit', Date.now().toString());
                socket.emit('user_login', App.currentUser.id);
                toggleHidden('authModal', false);
                App.showApp();
            } else {
                showToast(data.error || 'Ошибка регистрации');
            }
        } catch (error) {
            console.error('Register error:', error);
            showToast('Ошибка: ' + error.message);
        }
    },

    logout() {
        localStorage.removeItem('mm_user');
        location.reload();
    }
};

// Экспорт
window.AuthModule = AuthModule;

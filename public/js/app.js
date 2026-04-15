window.socket = io();

const App = {
    // === Свойства ===
    currentUser: null,
    currentChatId: null,
    // ... остальные свойства ...
    userSettings: { accentColor: '#007aff', sound: true, notifications: true },
    // ... и т.д. ...

    // === Вспомогательные методы ===
    getElement(id) {
        const el = document.getElementById(id);
        if (!el) console.warn(`Element #${id} not found`);
        return el;
    },

    toggleClass(id, className, force = null) {
        const el = this.getElement(id);
        if (el) {
            if (force === true) el.classList.add(className);
            else if (force === false) el.classList.remove(className);
            else el.classList.toggle(className);
            return true;
        }
        return false;
    },

    // === Основные методы ===
    async init() {
        await Crypto.init();
        this.setupSocketEvents();
        this.loadUserSettings();
        this.checkAuth();
        if ('Notification' in window) Notification.requestPermission();
    },

    setupSocketEvents() {
        socket.on('receive_message', (data) => {
            if (data.chatId === this.currentChatId) {
                MessagesModule.renderMessage(data.message);
                // ✅ Исправленная проверка:
                const fromId = data.message && data.message.from;
                const myId = this.currentUser && this.currentUser.id;
                if (fromId && myId && fromId !== myId) {
                    Utils.playNotificationSound();
                }
            }
            this.loadChats();
        });

        socket.on('user_status', (data) => {
            const user = this.allUsers.find(u => u.id === data.id);
            if (user) { 
                user.online = data.online; 
                this.loadChats(); 
            }
        });

        socket.on('user_typing', (data) => {
            // ✅ Исправленная проверка:
            const myId = this.currentUser && this.currentUser.id;
            if (data.chatId === this.currentChatId && data.userId !== myId) {
                const ind = document.getElementById('typingIndicator');
                if (ind) { 
                    ind.innerText = 'печатает...'; 
                    ind.classList.remove('hidden'); 
                    clearTimeout(this.typingTimeout); 
                    this.typingTimeout = setTimeout(() => ind.classList.add('hidden'), 3000); 
                }
            }
        });

        socket.on('message_deleted', () => {
            if (this.currentChatId) ChatModule.loadMessages(this.currentChatId);
            this.loadChats();
        });
    },

    async checkAuth() {
        try {
            const saved = localStorage.getItem('mm_user');
            if (saved) {
                this.currentUser = JSON.parse(saved);
                socket.emit('user_login', this.currentUser.id);
                
                if (Crypto.publicKeyBase64) {
                    await fetch(`/api/users/${this.currentUser.id}`, { 
                        method: 'PUT', 
                        headers: {'Content-Type':'application/json'}, 
                        body: JSON.stringify({publicKey: Crypto.publicKeyBase64}) 
                    });
                }
                this.showApp();
            } else {
                this.toggleClass('authModal', 'hidden', false); // безопасно
            }
        } catch (e) {
            console.error('Auth error:', e);
            this.toggleClass('authModal', 'hidden', false);
        }
    },

    showApp() {
        if (!this.toggleClass('appInterface', 'hidden', false)) {
            console.error('App interface not found!');
            return;
        }
        document.getElementById('appInterface').style.display = 'flex';
        
        this.updateMyProfile();
        this.loadUsers();
        this.loadFriends();
        this.loadChats();
        this.loadFolders();
        this.loadGroups();
    },

    // === Пустые методы-заглушки (чтобы не было ошибок) ===
    updateMyProfile() { console.log('updateMyProfile called'); },
    loadUserSettings() { console.log('loadUserSettings called'); },
    loadUsers() { console.log('loadUsers called'); },
    loadFriends() { console.log('loadFriends called'); },
    loadGroups() { console.log('loadGroups called'); },
    loadChats() { console.log('loadChats called'); },
    loadFolders() { console.log('loadFolders called'); }
    
}; // ← закрывающая скобка объекта

document.addEventListener('DOMContentLoaded', () => {
    const authForm = document.getElementById('authForm');
    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('usernameInput').value.trim();
            if (username.length < 2) return;
        
            try {
                const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, publicKey: Crypto.publicKeyBase64 })
            });

            if (!response.ok) {
                throw new Error(`Ошибка сервера: ${response.status}`);
            }

const user = await response.json();
            
                localStorage.setItem('mm_user', JSON.stringify(user));
                App.currentUser = user;
            
                document.getElementById('authModal').classList.add('hidden');
                App.showApp();
            
                socket.emit('user_login', user.id);
            } catch (err) {
                console.error('Login failed:', err);
                alert('Не удалось войти. Попробуйте ещё раз.');
            }
        });
    }
});

window.App = App;

document.addEventListener('DOMContentLoaded', () => App.init());

// Делаем socket доступным для всех модулей
window.socket = io();

const App = {
    currentUser: null,
    currentChatId: null,
    currentChatPartner: null,
    currentChatType: 'private',
    allUsers: [],
    friends: [],
    currentFolder: 'all',
    folders: [],
    selectedMembers: [],
    allGroups: [],
    userSettings: { accentColor: '#007aff', sound: true, notifications: true },
    isRecording: false,
    mediaRecorder: null,
    mediaChunks: [],
    recordingTimer: null,
    recordingSeconds: 0,
    recordPressTimer: null,
    replyToMessage: null,
    typingTimeout: null,

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
                if (data.message.from !== this.currentUser?.id) Utils.playNotificationSound();
            }
            this.loadChats();
        });

        socket.on('user_status', (data) => {
            const user = this.allUsers.find(u => u.id === data.id);
            if (user) { user.online = data.online; this.loadChats(); }
        });

        socket.on('user_typing', (data) => {
            if (data.chatId === this.currentChatId && data.userId !== this.currentUser?.id) {
                const ind = document.getElementById('typingIndicator');
                if (ind) { ind.innerText = 'печатает...'; ind.classList.remove('hidden'); clearTimeout(this.typingTimeout); this.typingTimeout = setTimeout(() => ind.classList.add('hidden'), 3000); }
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
                // Отправляем публичный ключ при входе
                if (Crypto.publicKeyBase64) {
                    await fetch(`/api/users/${this.currentUser.id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({publicKey: Crypto.publicKeyBase64}) });
                }
                this.showApp();
            } else {
                document.getElementById('authModal').classList.remove('hidden');
            }
        } catch (e) {
            console.error('Auth error:', e);
            document.getElementById('authModal').classList.remove('hidden');
        }
    },

    showApp() {
        document.getElementById('appInterface').classList.remove('hidden');
        document.getElementById('appInterface').style.display = 'flex';
        this.updateMyProfile();
        this.loadUsers();
        this.loadFriends();
        this.loadChats();
        this.loadFolders();
        this.loadGroups();
    },

    updateMyProfile() { /* твой код */ },
    loadUserSettings() { /* твой код */ },
    loadUsers() { /* твой код */ },
    loadFriends() { /* твой код */ },
    loadGroups() { /* твой код */ },
    loadChats() { /* твой код */ },
    loadFolders() { /* твой код */ }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());

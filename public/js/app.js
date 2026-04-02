// === MAIN APP MODULE ===
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
    userSettings: { accentColor: '#5288c1', sound: true, notifications: true },
    isRecording: false,
    mediaRecorder: null,
    mediaChunks: [],
    recordingTimer: null,
    recordingSeconds: 0,

    async init() {
        try {
            // Initialize crypto
            if (window.CryptoModule) {
                await CryptoModule.init();
            }

            // Initialize modules
            AuthModule.init();
            MessagesModule.init();
            ChatModule.init();

            // Load initial data
            await this.loadUserSettings();
            await this.loadUsers();
            await this.loadFriends();
            await this.loadGroups();
            await this.loadFolders();

            // Setup socket events
            this.setupSocketEvents();

            console.log('✅ Telepam initialized');
        } catch (error) {
            console.error('App init error:', error);
        }
    },

    setupSocketEvents() {
        socket.on('receive_message', (data) => {
            if (data.message.encrypted && window.CryptoModule) {
                data.message.text = CryptoModule.simpleDecrypt(data.message.text);
            }

            if (data.chatId === this.currentChatId) {
                const area = getElement('messagesArea');
                if (area) {
                    const div = document.createElement('div');
                    div.className = `message ${data.message.from === this.currentUser?.id ? 'me' : 'other'} animate-fade`;

                    let content = data.message.text;
                    if (data.message.type === 'sticker') {
                        content = `<div style="font-size:48px;">${data.message.text}</div>`;
                    } else if (data.message.type === 'image') {
                        content = `<img src="${data.message.text}">`;
                    } else if (data.message.type === 'video') {
                        content = `<video src="${data.message.text}" controls></video>`;
                    } else if (data.message.type === 'voice') {
                        content = window.renderVoiceMessage ? renderVoiceMessage(data.message.text, data.message.duration || '0:00') : `<audio src="${data.message.text}" controls></audio>`;
                    }

                    div.innerHTML = `${content}<div class="message-time">${data.message.time}</div>`;
                    area.appendChild(div);
                    area.scrollTop = area.scrollHeight;
                }

                if (data.message.from !== this.currentUser?.id) {
                    Utils.playNotificationSound();
                }
            }

            ChatModule.loadChats();
        });

        socket.on('user_status', (data) => {
            const user = this.allUsers.find(u => u.id === data.id);
            if (user) {
                user.online = data.online;
                ChatModule.loadChats();
            }
        });

        socket.on('user_typing', (data) => {
            if (data.chatId === this.currentChatId && data.userId !== this.currentUser?.id) {
                const indicator = getElement('typingIndicator');
                if (indicator) {
                    indicator.innerText = 'печатает...';
                    indicator.classList.remove('hidden');
                    setTimeout(() => indicator.classList.add('hidden'), 3000);
                }
            }
        });

        socket.on('message_deleted', () => {
            if (this.currentChatId) {
                fetch(`/api/messages/${this.currentChatId}`)
                    .then(r => r.json())
                    .then(msgs => {
                        const decrypted = msgs.map(m => {
                            if (m.encrypted && window.CryptoModule) {
                                m.text = CryptoModule.simpleDecrypt(m.text);
                            }
                            return m;
                        });
                        MessagesModule.renderMessages(decrypted);
                    });
            }
            ChatModule.loadChats();
        });
    },

    showApp() {
        toggleHidden('appInterface', true);

        this.updateMyProfile();
        ChatModule.loadChats();
    },

    updateMyProfile() {
        if (!this.currentUser) return;

        const btn = getElement('myProfileAvatar');
        const name = getElement('myProfileName');
        const id = getElement('myProfileId');

        if (this.currentUser.avatarImage) {
            if (btn) btn.innerHTML = `<img src="${this.currentUser.avatarImage}" alt="">`;
        } else {
            if (btn) btn.textContent = this.currentUser.id[1].toUpperCase();
        }

        if (btn) btn.style.background = this.currentUser.avatarColor;
        if (name) name.textContent = `${this.currentUser.name} ${this.currentUser.surname}`;
        if (id) id.textContent = this.currentUser.id;
    },

    async loadUserSettings() {
        try {
            const saved = localStorage.getItem('mm_settings_' + (this.currentUser?.id || 'default'));
            if (saved) {
                this.userSettings = JSON.parse(saved);
                document.documentElement.style.setProperty('--accent', this.userSettings.accentColor);
            }
        } catch (error) {
            console.error('Load settings error:', error);
        }
    },

    async loadUsers() {
        try {
            const res = await fetch('/api/users');
            this.allUsers = await res.json();
        } catch (error) {
            console.error('Load users error:', error);
        }
    },

    async loadFriends() {
        try {
            if (!this.currentUser?.id) return;
            const res = await fetch(`/api/friends/${this.currentUser.id}`);
            this.friends = await res.json();
        } catch (error) {
            console.error('Load friends error:', error);
        }
    },

    async loadGroups() {
        try {
            const res = await fetch('/api/groups');
            this.allGroups = await res.json();
        } catch (error) {
            console.error('Load groups error:', error);
        }
    },

    async loadFolders() {
        try {
            if (!this.currentUser?.id) return;
            const res = await fetch(`/api/folders/${this.currentUser.id}`);
            this.folders = await res.json();

            const bar = getElement('foldersBar');
            if (!bar) return;

            bar.innerHTML = '';
            this.folders.forEach(f => {
                const tab = document.createElement('div');
                tab.className = `folder-tab ${this.currentFolder === f.id ? 'active' : ''}`;
                tab.textContent = `${f.icon} ${f.name}`;
                tab.onclick = () => {
                    this.currentFolder = f.id;
                    ChatModule.loadChats();
                };
                bar.appendChild(tab);
            });
        } catch (error) {
            console.error('Load folders error:', error);
        }
    }
};

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}

// Export
window.App = App;

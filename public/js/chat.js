// === CHAT MODULE ===
const ChatModule = {
    init() {
        this.bindEvents();
    },

    bindEvents() {
        // Chat header click for info panel
        getElement('chatHeader')?.addEventListener('click', () => {
            // Toggle chat info panel if implemented
        });

        // Settings menu
        getElement('toggleSettingsBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleHidden('settingsMenu', true);
        });

        // Back button for mobile
        getElement('showChatListBtn')?.addEventListener('click', () => {
            if (isMobile()) {
                getElement('sidebar')?.classList.remove('hidden-mobile');
                getElement('mainChat')?.classList.remove('active');
            }
        });

        // Search
        getElement('searchInput')?.addEventListener('input', () => this.searchUsers());
    },

    async loadChats() {
        try {
            const res = await fetch(`/api/chats/${App.currentUser.id}`);
            const chats = await res.json();

            const list = getElement('chatList');
            if (!list) return;

            list.innerHTML = '';

            // Filter by folder
            const filteredChats = App.currentFolder === 'all' ? chats : chats.filter(c => {
                const folder = App.folders.find(f => f.id === App.currentFolder);
                return folder?.chats?.includes(c.id);
            });

            if (filteredChats.length === 0) {
                const support = App.allUsers.find(u => u.id === '@support') || {
                    id: '@support',
                    name: 'Поддержка',
                    surname: 'Telepam',
                    avatarColor: '#0088cc',
                    online: true
                };
                this.addChatToList(list, support, 'Напишите в поддержку!', 'private');
            }

            filteredChats.forEach(chat => {
                const user = App.allUsers.find(u => u.id === chat.id);
                this.addChatToList(list, {
                    ...chat,
                    online: chat.online || (user ? user.online : false),
                    avatarImage: chat.avatarImage || (user ? user.avatarImage : null)
                }, chat.lastMsg, chat.type || 'private', chat.members);
            });
        } catch (error) {
            console.error('Load chats error:', error);
        }
    },

    addChatToList(list, chat, lastMsg, type = 'private', membersCount) {
        const div = document.createElement('div');
        div.className = 'chat-item animate-fade';

        let avatarContent = chat.id[1].toUpperCase();
        if (chat.avatarImage) {
            avatarContent = `<img src="${chat.avatarImage}" alt="">`;
        }

        const isFriend = App.friends.find(f => f.id === chat.id);

        div.innerHTML = `
            <div class="avatar" style="background:${chat.avatarColor || '#5288c1'}" onclick="event.stopPropagation(); ChatModule.viewUserProfile('${chat.id}')">
                ${avatarContent}
                ${type === 'private' ? `<div class="online-indicator ${chat.online ? 'online' : 'offline'}"></div>` : ''}
            </div>
            <div class="chat-info">
                <div class="chat-name">
                    ${chat.name}
                    ${isFriend ? '<span class="friend-badge">Друг</span>' : ''}
                    ${type === 'group' ? `(${membersCount})` : ''}
                    ${type === 'channel' ? '📢' : ''}
                </div>
                <div class="last-message">${lastMsg || 'Нет сообщений'}</div>
            </div>
        `;

        div.onclick = () => this.openChat(chat.id, type);
        list.appendChild(div);
    },

    openChat(chatId, type = 'private') {
        App.currentChatPartner = chatId;
        App.currentChatType = type;
        App.currentChatId = type === 'private'
            ? [App.currentUser.id, chatId].sort().join('_')
            : chatId;

        socket.emit('join_chat', App.currentChatId);

        const user = App.allUsers.find(u => u.id === chatId);
        const group = App.allGroups.find(g => g.id === chatId);

        const displayName = group ? group.name : `${user?.name} ${user?.surname || ''}`;
        const avatarColor = group ? group.avatarColor : user?.avatarColor;
        const avatarImage = group ? null : user?.avatarImage;

        setTextContent('headerName', displayName);
        setTextContent('headerStatus', user?.online ? 'в сети' : '');
        getElement('headerStatus')?.classList.remove('online', 'offline');
        if (user?.online) {
            getElement('headerStatus')?.classList.add('online');
        }

        let avatarContent = chatId[1].toUpperCase();
        if (avatarImage) {
            avatarContent = `<img src="${avatarImage}" alt="">`;
        }
        setInnerHTML('headerAvatar', avatarContent);
        getElement('headerAvatar')?.style.setProperty('background', avatarColor || '#5288c1');

        // Load messages
        fetch(`/api/messages/${App.currentChatId}`)
            .then(r => r.json())
            .then(msgs => {
                const decryptedMsgs = msgs.map(m => {
                    if (m.encrypted && window.CryptoModule) {
                        m.text = CryptoModule.simpleDecrypt(m.text);
                    }
                    return m;
                });
                MessagesModule.renderMessages(decryptedMsgs);
            });

        // Update active chat
        document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));

        // Mobile view
        if (isMobile()) {
            getElement('sidebar')?.classList.add('hidden-mobile');
            getElement('mainChat')?.classList.add('active');
        }
    },

    async searchUsers() {
        const query = getElement('searchInput')?.value.trim();
        const suggestions = getElement('searchSuggestions');

        if (!query || query.length < 1) {
            toggleHidden('searchSuggestions', false);
            return;
        }

        try {
            const res = await fetch(`/api/users/search/${query}?exclude=${App.currentUser.id}`);
            const users = await res.json();

            if (!suggestions) return;

            suggestions.innerHTML = '';

            users.forEach(u => {
                const div = document.createElement('div');
                div.className = 'suggestion-item animate-fade';

                let avatarContent = u.id[1].toUpperCase();
                if (u.avatarImage) {
                    avatarContent = `<img src="${u.avatarImage}" style="width:35px;height:35px;border-radius:50%">`;
                }

                div.innerHTML = `
                    <div class="avatar" style="width:35px;height:35px;font-size:14px;background:${u.avatarColor}">
                        ${avatarContent}
                    </div>
                    <div>
                        <b>${u.id}</b><br>
                        <small>${u.name} ${u.surname}</small>
                    </div>
                `;

                div.onclick = () => {
                    this.openChat(u.id, 'private');
                    toggleHidden('searchSuggestions', false);
                    const searchInput = getElement('searchInput');
                    if (searchInput) searchInput.value = '';
                };

                suggestions.appendChild(div);
            });

            toggleHidden('searchSuggestions', users.length === 0);
        } catch (error) {
            console.error('Search error:', error);
        }
    },

    async viewUserProfile(userId) {
        if (!userId || userId === App.currentUser.id) return;

        try {
            const res = await fetch(`/api/user/${userId}`);
            const user = await res.json();

            const content = getElement('userProfileContent');
            if (!content) return;

            let avatarContent = user.id[1].toUpperCase();
            if (user.avatarImage) {
                avatarContent = `<img src="${user.avatarImage}" alt="">`;
            }

            content.innerHTML = `
                <div class="avatar" style="background:${user.avatarColor};width:100px;height:100px;margin:0 auto 15px;font-size:40px;">
                    ${avatarContent}
                </div>
                <h3>${user.name} ${user.surname}</h3>
                <p>${user.id} ${user.online ? '<span style="color:var(--online)">● в сети</span>' : ''}</p>
                ${user.bio ? `<div class="bio"><b>О себе:</b><br>${user.bio}</div>` : ''}
                <div style="margin-top:15px;">
                    <button class="btn-primary" onclick="ChatModule.openChat('${user.id}', 'private'); closeModal('userProfileModal')">Написать</button>
                </div>
            `;

            toggleHidden('userProfileModal', false);
        } catch (error) {
            console.error('View profile error:', error);
            showToast('Ошибка загрузки профиля');
        }
    }
};

// Export
window.ChatModule = ChatModule;

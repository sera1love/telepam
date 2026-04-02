// === MESSAGES MODULE ===
const MessagesModule = {
    replyToMessage: null,
    forwardMessage: null,

    init() {
        this.bindEvents();
    },

    bindEvents() {
        // Send button
        getElement('sendBtn')?.addEventListener('click', () => this.sendMessage());

        // Enter key to send
        getElement('messageInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Typing indicator
        getElement('messageInput')?.addEventListener('input', () => this.sendTyping());

        // File upload
        getElement('fileInputBtn')?.addEventListener('click', () => {
            getElement('fileInput')?.click();
        });

        getElement('fileInput')?.addEventListener('change', () => this.uploadFile());

        // Voice recording
        const recordBtn = getElement('recordBtn');
        if (recordBtn) {
            recordBtn.addEventListener('mousedown', () => this.startRecording());
            recordBtn.addEventListener('mouseup', () => this.stopRecording());
            recordBtn.addEventListener('touchstart', () => this.startRecording());
            recordBtn.addEventListener('touchend', () => this.stopRecording());
        }

        // Stickers & Emoji
        getElement('toggleStickersBtn')?.addEventListener('click', () => this.toggleStickers());
        getElement('toggleEmojiBtn')?.addEventListener('click', () => this.toggleEmoji());

        // Reply preview
        getElement('cancelReplyBtn')?.addEventListener('click', () => this.cancelReply());
    },

    renderMessages(messages) {
        const area = getElement('messagesArea');
        if (!area) return;

        area.innerHTML = '';

        messages.forEach((msg, index) => {
            const div = document.createElement('div');
            div.className = `message ${msg.from === App.currentUser?.id ? 'me' : 'other'} animate-fade`;

            let content = '';
            let senderInfo = '';

            // Show sender name in groups
            if (App.currentChatType !== 'private' && msg.from !== App.currentUser?.id) {
                const sender = App.allUsers.find(u => u.id === msg.from);
                senderInfo = `<div class="sender-name">${sender ? sender.name : msg.from}</div>`;
            }

            // Message content based on type
            if (msg.deleted) {
                content = '<i>Сообщение удалено</i>';
            } else if (msg.type === 'sticker') {
                content = `<div style="font-size:48px;">${msg.text}</div>`;
            } else if (msg.type === 'image') {
                content = `<img src="${msg.text}" alt="image">`;
            } else if (msg.type === 'video') {
                content = `<video src="${msg.text}" controls></video>`;
            } else if (msg.type === 'audio' || msg.type === 'voice') {
                content = window.renderVoiceMessage ? window.renderVoiceMessage(msg.text, msg.duration || '0:00') : `<audio src="${msg.text}" controls></audio>`;
            } else if (msg.type === 'file') {
                content = `<div class="message-file">📎 ${msg.fileName || 'Файл'}<br><a href="${msg.text}" download style="color:var(--accent)">Скачать</a></div>`;
            } else {
                // Decrypt if encrypted
                content = msg.text;
                if (msg.encrypted && window.CryptoModule) {
                    content = CryptoModule.simpleDecrypt(msg.text);
                }
            }

            // Reply indicator
            let replyInfo = '';
            if (msg.replyTo) {
                replyInfo = `<div class="message-reply">${msg.replyTo}</div>`;
            }

            div.innerHTML = `${senderInfo}${replyInfo}${content}<div class="message-time">${formatTime(msg.time)}</div>`;

            // Message actions
            if (!msg.deleted) {
                const actions = document.createElement('div');
                actions.className = 'message-actions';
                actions.innerHTML = `
                    <button onclick="MessagesModule.replyToMessageFunc(${index})">↩️</button>
                    <button onclick="MessagesModule.forwardMessageFunc(${index})">➡️</button>
                    <button onclick="MessagesModule.deleteMessage(${index})">🗑️</button>
                `;
                div.appendChild(actions);
            }

            area.appendChild(div);
        });

        area.scrollTop = area.scrollHeight;
    },

    sendMessage() {
        const input = getElement('messageInput');
        const text = input?.value.trim();

        if (!text || !App.currentChatId) return;

        // Encrypt message
        let encryptedText = text;
        if (window.CryptoModule) {
            encryptedText = CryptoModule.simpleEncrypt(text);
        }

        const msg = {
            chatId: App.currentChatId,
            message: {
                text: encryptedText,
                encrypted: true,
                from: App.currentUser.id,
                time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                type: 'text',
                replyTo: this.replyToMessage ? 'Ответ на сообщение' : null
            },
            sender: App.currentUser.id
        };

        socket.emit('send_message', msg);
        input.value = '';
        this.cancelReply();
    },

    sendSticker(sticker) {
        if (!App.currentChatId) return;

        const msg = {
            chatId: App.currentChatId,
            message: {
                text: sticker,
                from: App.currentUser.id,
                time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                type: 'sticker'
            },
            sender: App.currentUser.id
        };

        socket.emit('send_message', msg);
        toggleHidden('stickersPanel', false);
    },

    async deleteMessage(index) {
        if (!confirm('Удалить сообщение?')) return;

        try {
            await fetch(`/api/messages/${App.currentChatId}/${index}?userId=${App.currentUser.id}`, {
                method: 'DELETE'
            });

            socket.emit('delete_message', {
                chatId: App.currentChatId,
                index,
                userId: App.currentUser.id
            });
        } catch (error) {
            console.error('Delete message error:', error);
            showToast('Ошибка при удалении');
        }
    },

    sendTyping() {
        if (App.currentChatId) {
            socket.emit('typing', {
                chatId: App.currentChatId,
                userId: App.currentUser.id
            });
        }
    },

    async uploadFile() {
        const fileInput = getElement('fileInput');
        const file = fileInput?.files[0];

        if (!file || !App.currentChatId) return;

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            let type = 'file';
            if (file.type.startsWith('image/')) type = 'image';
            else if (file.type.startsWith('video/')) type = 'video';

            const msg = {
                chatId: App.currentChatId,
                message: {
                    text: data.url,
                    fileName: data.name,
                    from: App.currentUser.id,
                    time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                    type
                },
                sender: App.currentUser.id
            };

            socket.emit('send_message', msg);
            fileInput.value = '';
        } catch (error) {
            console.error('Upload error:', error);
            showToast('Ошибка загрузки файла');
        }
    },

    startRecording() {
        setTimeout(() => this.recordMedia(), 300);
    },

    stopRecording() {
        if (App.isRecording) {
            this.stopMediaRecording();
        }
    },

    async recordMedia() {
        App.isRecording = true;
        App.mediaChunks = [];
        App.recordingSeconds = 0;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            App.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

            App.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) App.mediaChunks.push(e.data);
            };

            App.mediaRecorder.onstop = async () => {
                if (App.mediaChunks.length === 0) return;

                const blob = new Blob(App.mediaChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('file', blob, 'voice.webm');

                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json();

                const mins = Math.floor(App.recordingSeconds / 60);
                const secs = App.recordingSeconds % 60;
                const duration = `${mins}:${secs.toString().padStart(2, '0')}`;

                const msg = {
                    chatId: App.currentChatId,
                    message: {
                        text: data.url,
                        from: App.currentUser.id,
                        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                        type: 'voice',
                        duration: duration
                    },
                    sender: App.currentUser.id
                };

                socket.emit('send_message', msg);
                stream.getTracks().forEach(track => track.stop());
            };

            App.mediaRecorder.start();
            getElement('recordBtn')?.classList.add('recording');

            const timer = document.createElement('div');
            timer.className = 'recording-timer';
            timer.id = 'recordingTimer';
            timer.textContent = '0:00';

            const btn = getElement('recordBtn');
            btn?.parentElement?.appendChild(timer);

            App.recordingTimer = setInterval(() => {
                App.recordingSeconds++;
                const mins = Math.floor(App.recordingSeconds / 60);
                const secs = App.recordingSeconds % 60;
                timer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

                if (App.recordingSeconds >= 60) this.stopMediaRecording();
            }, 1000);
        } catch (error) {
            console.error('Recording error:', error);
            showToast('Нет доступа к микрофону');
            App.isRecording = false;
        }
    },

    stopMediaRecording() {
        if (App.mediaRecorder && App.isRecording) {
            App.mediaRecorder.stop();
            App.isRecording = false;
            getElement('recordBtn')?.classList.remove('recording');

            const timer = getElement('recordingTimer');
            timer?.remove();

            if (App.recordingTimer) {
                clearInterval(App.recordingTimer);
                App.recordingTimer = null;
            }
        }
    },

    toggleStickers() {
        const panel = getElement('stickersPanel');
        const emojiPicker = getElement('emojiPicker');
        const forwardPanel = getElement('forwardPanel');

        if (panel) panel.classList.toggle('hidden');
        if (emojiPicker) emojiPicker.classList.add('hidden');
        if (forwardPanel) forwardPanel.classList.add('hidden');
    },

    toggleEmoji() {
        const panel = getElement('emojiPicker');
        const stickersPanel = getElement('stickersPanel');
        const forwardPanel = getElement('forwardPanel');

        if (panel) panel.classList.toggle('hidden');
        if (stickersPanel) stickersPanel.classList.add('hidden');
        if (forwardPanel) forwardPanel.classList.add('hidden');
    },

    replyToMessageFunc(index) {
        // Implementation for reply functionality
        showToast('Функция ответа в разработке');
    },

    cancelReply() {
        this.replyToMessage = null;
        toggleHidden('replyPreview', false);
    },

    forwardMessageFunc(index) {
        // Implementation for forward functionality
        showToast('Функция пересылки в разработке');
    }
};

// Export
window.MessagesModule = MessagesModule;

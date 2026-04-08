const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// === ИСПРАВЛЕНИЕ: Явно отдаём index.html при заходе на "/" ===
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// === ИСПРАВЛЕНИЕ: Статика из папки public ===
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// === БАЗА ДАННЫХ (файлы) ===
const DB_DIR = './database';
const UPLOAD_DIR = './uploads';
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'))
});
const upload = multer({ storage });

let onlineUsers = new Map();

function loadJSON(file, def) {
    try { return JSON.parse(fs.readFileSync(`./database/${file}`)); }
    catch { return def; }
}
function saveJSON(file, data) {
    fs.writeFileSync(`./database/${file}`, JSON.stringify(data, null, 2));
}
function getUsers() { return loadJSON('users.json', {}); }
function saveUser(user) {
    const users = getUsers();
    users[user.id] = user;
    saveJSON('users.json', users);
}
function getFriends(userId) { return loadJSON(`friends_${userId}.json`, []); }
function saveFriends(userId, friends) { saveJSON(`friends_${userId}.json`, friends); }
function getContacts(userId) { return loadJSON(`contacts_${userId}.json`, {}); }
function saveContact(userId, contactId, customName) {
    const contacts = getContacts(userId);
    contacts[contactId] = customName;
    saveJSON(`contacts_${userId}.json`, contacts);
}
function getGroups() { return loadJSON('groups.json', {}); }
function saveGroup(group) {
    const groups = getGroups();
    groups[group.id] = group;
    saveJSON('groups.json', groups);
}
function getMessages(chatId) { return loadJSON(`chat_${chatId}.json`, []); }
function saveMessage(chatId, msg) {
    const msgs = getMessages(chatId);
    msg.id = msgs.length;
    msg.status = 'sent';
    msg.readBy = [msg.from];
    msgs.push(msg);
    saveJSON(`chat_${chatId}.json`, msgs);
    return msg.id;
}
function getSettings(userId) {
    return loadJSON(`settings_${userId}.json`, {
        privacy: { showBio: true, showChannels: true, whoCanMessage: 'all' },
        blocked: [], notifications: true, sound: true,
        theme: { accentColor: '#007aff', animationSpeed: 'normal' }
    });
}
function saveSettings(userId, settings) {
    saveJSON(`settings_${userId}.json`, settings);
}
function getFolders(userId) {
    return loadJSON(`folders_${userId}.json`, [{ id: 'all', name: 'Все чаты', chats: [], icon: '💬' }]);
}
function saveFolders(userId, folders) {
    saveJSON(`folders_${userId}.json`, folders);
}

// === API ===
app.post('/api/register', (req, res) => {
    const { id, name, surname, password, avatarColor, avatarImage, bio } = req.body;
    if (!id?.startsWith('@')) return res.status(400).json({ error: 'ID должен начинаться с @' });
    const users = getUsers();
    if (users[id]) {
        if (users[id].password !== password) return res.status(401).json({ error: 'Неверный пароль' });
        return res.json({ success: true, user: users[id], action: 'login' });
    }
    const newUser = { id, name, surname, password, avatarColor: avatarColor || '#007aff', avatarImage: avatarImage || null, bio: bio || '', channels: [], status: 'offline', lastSeen: new Date().toISOString() };
    saveUser(newUser);
    saveSettings(id, { privacy: { showBio: true, showChannels: true, whoCanMessage: 'all' }, blocked: [], notifications: true, sound: true, theme: { accentColor: '#007aff', animationSpeed: 'normal' } });
    saveFriends(id, []);
    saveFolders(id, [{ id: 'all', name: 'Все чаты', chats: [], icon: '💬' }]);
    res.json({ success: true, user: newUser, action: 'register' });
});

app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const users = getUsers();
    if (!users[id]) return res.status(404).json({ error: 'Пользователь не найден' });
    if (users[id].password !== password) return res.status(401).json({ error: 'Неверный пароль' });
    res.json({ success: true, user: users[id] });
});

app.get('/api/users/search/:query', (req, res) => {
    const query = req.params.query.toLowerCase();
    const users = getUsers();
    const results = Object.values(users).filter(u => u.id.toLowerCase().includes(query) && u.id !== req.query.exclude).slice(0, 10);
    res.json(results);
});

app.get('/api/users', (req, res) => {
    const users = getUsers();
    res.json(Object.values(users).map(u => ({ id: u.id, name: u.name, surname: u.surname, avatarColor: u.avatarColor, avatarImage: u.avatarImage, online: onlineUsers.has(u.id), bio: u.bio, channels: u.channels })));
});

app.get('/api/user/:id', (req, res) => {
    const users = getUsers();
    const user = users[req.params.id];
    if (!user) return res.status(404).json({ error: 'Not found' });
    const settings = getSettings(req.params.id);
    res.json({ id: user.id, name: user.name, surname: user.surname, avatarColor: user.avatarColor, avatarImage: user.avatarImage, bio: settings.privacy.showBio ? user.bio : '', channels: settings.privacy.showChannels ? user.channels : [], online: onlineUsers.has(req.params.id) });
});

app.get('/api/friends/:userId', (req, res) => {
    const friends = getFriends(req.params.userId);
    const users = getUsers();
    res.json(friends.map(fid => ({ ...users[fid], online: onlineUsers.has(fid) })).filter(f => f.id));
});

app.post('/api/friends/:userId', (req, res) => {
    const { friendId, action } = req.body;
    const friends = getFriends(req.params.userId);
    if (action === 'add' && !friends.includes(friendId)) { friends.push(friendId); saveFriends(req.params.userId, friends); }
    else if (action === 'remove') { const idx = friends.indexOf(friendId); if (idx > -1) { friends.splice(idx, 1); saveFriends(req.params.userId, friends); } }
    res.json({ success: true, friends });
});

app.post('/api/contact/:userId', (req, res) => {
    const { contactId, customName } = req.body;
    saveContact(req.params.userId, contactId, customName);
    res.json({ success: true });
});

app.get('/api/groups', (req, res) => { res.json(Object.values(getGroups())); });

app.post('/api/groups', (req, res) => {
    const { name, members, creatorId, avatarColor, type, description } = req.body;
    const id = type === 'channel' ? '@channel_' + Date.now() : '@group_' + Date.now();
    const group = { id, name, description, members: [...members, creatorId], creatorId, avatarColor, type, admins: [creatorId] };
    saveGroup(group);
    res.json({ success: true, group });
});

app.post('/api/groups/:groupId/members', (req, res) => {
    const { userId, action } = req.body;
    const groups = getGroups();
    const group = groups[req.params.groupId];
    if (!group) return res.status(404).json({ error: 'Not found' });
    if (action === 'add' && !group.members.includes(userId)) group.members.push(userId);
    else if (action === 'remove') group.members = group.members.filter(m => m !== userId);
    saveGroup(group);
    saveJSON('groups.json', groups);
    io.emit('group_members_updated', { groupId: group.id, members: group.members });
    res.json({ success: true, group });
});

app.post('/api/groups/:groupId/name', (req, res) => {
    const { name } = req.body;
    const groups = getGroups();
    const group = groups[req.params.groupId];
    if (!group || group.creatorId !== req.query.userId) return res.status(403).json({ error: 'Only creator can rename' });
    group.name = name;
    saveGroup(group);
    saveJSON('groups.json', groups);
    res.json({ success: true, group });
});

app.post('/api/groups/:groupId/leave', (req, res) => {
    const { userId } = req.body;
    const groups = getGroups();
    const group = groups[req.params.groupId];
    if (!group) return res.status(404).json({ error: 'Not found' });
    group.members = group.members.filter(m => m !== userId);
    if (group.members.length === 0) delete groups[req.params.groupId];
    saveJSON('groups.json', groups);
    res.json({ success: true });
});

app.delete('/api/groups/:groupId', (req, res) => {
    const { userId } = req.query;
    const groups = getGroups();
    const group = groups[req.params.groupId];
    if (!group || group.creatorId !== userId) return res.status(403).json({ error: 'Only creator can delete' });
    delete groups[req.params.groupId];
    saveJSON('groups.json', groups);
    res.json({ success: true });
});

app.get('/api/chats/:userId', (req, res) => {
    const users = getUsers();
    const groups = getGroups();
    const contacts = getContacts(req.params.userId);
    const chats = [];
    for (let uid in users) {
        if (uid !== req.params.userId) {
            const chatId = [req.params.userId, uid].sort().join('_');
            const msgs = getMessages(chatId);
            if (msgs.length > 0) {
                const user = users[uid];
                chats.push({ id: uid, name: contacts[uid] || `${user.name} ${user.surname}`, displayName: user.name + ' ' + user.surname, lastMsg: msgs[msgs.length-1].text, lastTime: msgs[msgs.length-1].time, online: onlineUsers.has(uid), type: 'private', avatarColor: user.avatarColor, avatarImage: user.avatarImage, isFriend: getFriends(req.params.userId).includes(uid) });
            }
        }
    }
    for (let gid in groups) {
        if (groups[gid].members.includes(req.params.userId)) {
            const chatId = groups[gid].type === 'channel' ? gid : [req.params.userId, gid].sort().join('_');
            const msgs = getMessages(chatId);
            chats.push({ id: gid, name: groups[gid].name, lastMsg: msgs.length > 0 ? msgs[msgs.length-1].text : 'Группа создана', lastTime: msgs.length > 0 ? msgs[msgs.length-1].time : '', type: groups[gid].type, avatarColor: groups[gid].avatarColor, members: groups[gid].members.length });
        }
    }
    chats.sort((a, b) => new Date(b.lastTime || 0) - new Date(a.lastTime || 0));
    res.json(chats);
});

app.get('/api/messages/:chatId', (req, res) => { res.json(getMessages(req.params.chatId)); });

app.get('/api/chat-media/:chatId', (req, res) => {
    const msgs = getMessages(req.params.chatId);
    const media = { images: [], videos: [], links: [], files: [], audio: [] };
    msgs.forEach(msg => {
        if (msg.type === 'image') media.images.push(msg);
        else if (msg.type === 'video') media.videos.push(msg);
        else if (msg.type === 'audio') media.audio.push(msg);
        else if (msg.type === 'file') media.files.push(msg);
        else if (msg.text?.match(/https?:\/\/[^\s]+/)) msg.text.match(/https?:\/\/[^\s]+/g).forEach(l => media.links.push({ text: l, time: msg.time, from: msg.from }));
    });
    res.json(media);
});

app.delete('/api/messages/:chatId/:index', (req, res) => {
    const { chatId, index } = req.params;
    const { userId, isAdmin } = req.query;
    const msgs = getMessages(chatId);
    if (!msgs[index]) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (msgs[index].from === userId || isAdmin === 'true') {
        msgs[index].deleted = true;
        msgs[index].text = 'Сообщение удалено';
        saveJSON(`chat_${chatId}.json`, msgs);
        res.json({ success: true });
    } else {
        res.status(403).json({ error: 'Нельзя удалить чужое сообщение' });
    }
});

app.get('/api/settings/:userId', (req, res) => { res.json(getSettings(req.params.userId)); });
app.post('/api/settings/:userId', (req, res) => { const s = getSettings(req.params.userId); Object.assign(s, req.body); saveSettings(req.params.userId, s); res.json({ success: true }); });
app.post('/api/block/:userId', (req, res) => { const s = getSettings(req.params.userId); if (!s.blocked.includes(req.body.blockedId)) { s.blocked.push(req.body.blockedId); saveSettings(req.params.userId, s); } res.json({ success: true }); });
app.delete('/api/block/:userId/:blockedId', (req, res) => { const s = getSettings(req.params.userId); s.blocked = s.blocked.filter(id => id !== req.params.blockedId); saveSettings(req.params.userId, s); res.json({ success: true }); });
app.get('/api/folders/:userId', (req, res) => { res.json(getFolders(req.params.userId)); });
app.post('/api/folders/:userId', (req, res) => { saveFolders(req.params.userId, req.body); res.json({ success: true }); });
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (req.file) res.json({ url: `/uploads/${req.file.filename}`, type: req.file.mimetype, name: req.file.originalname });
    else res.status(400).json({ error: 'No file' });
});

// === SOCKET ===
io.on('connection', (socket) => {
    let userId = null;
    socket.on('user_login', (id) => {
        userId = id;
        onlineUsers.set(id, socket.id);
        const users = getUsers();
        if (users[id]) { users[id].status = 'online'; users[id].lastSeen = new Date().toISOString(); saveUser(users[id]); }
        io.emit('user_status', { id, online: true });
    });
    socket.on('join_chat', (chatId) => socket.join(chatId));
    socket.on('send_message', (data) => {
        const settings = getSettings(data.message.from);
        if (settings.blocked.includes(data.message.from)) return;
        const msgId = saveMessage(data.chatId, data.message);
        data.message.id = msgId;
        io.to(data.chatId).emit('receive_message', { chatId: data.chatId, message: data.message, senderId: data.message.from });
        const msgs = getMessages(data.chatId);
        if (msgs.length === 1) {
            const otherUser = data.chatId.replace(data.message.from + '_', '').replace('_' + data.message.from, '');
            if (otherUser && otherUser !== data.message.from) {
                const users = getUsers();
                const otherSocketId = onlineUsers.get(otherUser);
                if (otherSocketId) io.to(otherSocketId).emit('new_chat_notification', { from: data.message.from, fromName: users[data.message.from]?.name || data.message.from, message: (data.message.text || '').substring(0, 20) + '...' });
            }
        }
    });
    socket.on('message_read', (data) => {
        const msgs = getMessages(data.chatId);
        if (msgs[data.messageId] && !msgs[data.messageId].readBy?.includes(data.userId)) {
            if (!msgs[data.messageId].readBy) msgs[data.messageId].readBy = [];
            msgs[data.messageId].readBy.push(data.userId);
            saveJSON(`chat_${data.chatId}.json`, msgs);
            io.to(data.chatId).emit('message_status_updated', { messageId: data.messageId, readBy: msgs[data.messageId].readBy });
        }
    });
    socket.on('delete_message', (data) => {
        const msgs = getMessages(data.chatId);
        if (msgs[data.index] && (msgs[data.index].from === data.userId || Object.values(getGroups()).some(g => g.admins.includes(data.userId)))) {
            msgs[data.index].deleted = true;
            msgs[data.index].text = 'Сообщение удалено';
            saveJSON(`chat_${data.chatId}.json`, msgs);
            io.to(data.chatId).emit('message_deleted', { index: data.index });
        }
    });
    socket.on('typing', (data) => socket.to(data.chatId).emit('user_typing', data));
    socket.on('disconnect', () => {
        if (userId) {
            onlineUsers.delete(userId);
            const users = getUsers();
            if (users[userId]) { users[userId].status = 'offline'; users[userId].lastSeen = new Date().toISOString(); saveUser(users[userId]); }
            io.emit('user_status', { id: userId, online: false });
        }
    });
});

// Бот поддержки
if (!fs.existsSync('./database/users.json')) {
    const support = { id: '@support', name: 'Поддержка', surname: 'Telepam', password: 'support123', avatarColor: '#0088cc', avatarImage: null, bio: 'Официальная поддержка Telepam', channels: [], status: 'online', lastSeen: new Date().toISOString() };
    saveUser(support);
    saveSettings('@support', { privacy: { showBio: true, showChannels: true, whoCanMessage: 'all' }, blocked: [], notifications: true, sound: true, theme: { accentColor: '#0088cc', animationSpeed: 'normal' } });
    saveFriends('@support', []);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ SERVER ON PORT ${PORT}`);
    console.log(`🌍 Open: http://localhost:${PORT}`);
});

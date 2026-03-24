const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.static(__dirname));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const DB_DIR = './database';
const UPLOAD_DIR = './uploads';

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
destination: (req, file, cb) => cb(null, UPLOAD_DIR),
filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'))
});

const upload = multer({ 
storage,
limits: { fileSize: 100 * 1024 * 1024 }
});

let onlineUsers = new Map();
let allGroups = [];

function loadJSON(file, def) {
try { 
const data = fs.readFileSync(`./database/${file}`);
return JSON.parse(data); 
} catch { return def; }
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

function getGroups() { 
const groups = loadJSON('groups.json', {});
allGroups = Object.values(groups);
return groups;
}
function saveGroup(group) {
const groups = getGroups();
groups[group.id] = group;
saveJSON('groups.json', groups);
allGroups = Object.values(groups);
}

function getMessages(chatId) { return loadJSON(`chat_${chatId}.json`, []); }
function saveMessage(chatId, msg) {
const msgs = getMessages(chatId);
msg.id = msgs.length;
msg.status = 'sent';
msg.readBy = [msg.from];
msg.reactions = msg.reactions || [];
msgs.push(msg);
saveJSON(`chat_${chatId}.json`, msgs);
return msg.id;
}

function getSettings(userId) {
return loadJSON(`settings_${userId}.json`, {
privacy: { showBio: true, showChannels: true, whoCanMessage: 'all' },
blocked: [],
notifications: true,
sound: true
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

function getSavedMessages(userId) {
return loadJSON(`saved_${userId}.json`, []);
}

function saveSavedMessage(userId, msg) {
const saved = getSavedMessages(userId);
saved.push(msg);
saveJSON(`saved_${userId}.json`, saved);
}

// === API ===
app.post('/api/register', (req, res) => {
const { id, name, surname, password, avatarColor, avatarImage, bio } = req.body;
if (!id.startsWith('@')) return res.status(400).json({ error: 'ID должен начинаться с @' });
const users = getUsers();
if (users[id]) {
if (users[id].password !== password) return res.status(401).json({ error: 'Неверный пароль' });
return res.json({ success: true, user: users[id], action: 'login' });
}
const newUser = {
id, name, surname, password,
avatarColor: avatarColor || '#007aff',
avatarImage: avatarImage || null,
bio: bio || '',
channels: [],
status: 'offline',
lastSeen: new Date().toISOString()
};
saveUser(newUser);
saveSettings(id, { privacy: { showBio: true, showChannels: true, whoCanMessage: 'all' }, blocked: [], notifications: true, sound: true });
saveFriends(id, []);
saveFolders(id, [{ id: 'all', name: 'Все чаты', chats: [], icon: '💬' }]);
saveJSON(`saved_${id}.json`, []);
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
const results = Object.values(users).filter(u =>
u.id.toLowerCase().includes(query) && u.id !== req.query.exclude
).slice(0, 10);
res.json(results);
});

app.get('/api/users', (req, res) => {
const users = getUsers();
const userList = Object.values(users).map(u => ({
id: u.id, name: u.name, surname: u.surname,
avatarColor: u.avatarColor, avatarImage: u.avatarImage,
online: onlineUsers.has(u.id), bio: u.bio, channels: u.channels,
lastSeen: u.lastSeen
}));
res.json(userList);
});

app.get('/api/user/:id', (req, res) => {
const users = getUsers();
const user = users[req.params.id];
if (!user) return res.status(404).json({ error: 'Not found' });
const settings = getSettings(req.params.id);
const publicUser = {
id: user.id, name: user.name, surname: user.surname,
avatarColor: user.avatarColor, avatarImage: user.avatarImage,
bio: settings.privacy.showBio ? user.bio : '',
channels: settings.privacy.showChannels ? user.channels : [],
online: onlineUsers.has(req.params.id),
lastSeen: user.lastSeen
};
res.json(publicUser);
});

app.get('/api/friends/:userId', (req, res) => {
const friends = getFriends(req.params.userId);
const users = getUsers();
const friendList = friends.map(fid => ({
...users[fid], online: onlineUsers.has(fid)
})).filter(f => f.id);
res.json(friendList);
});

app.post('/api/friends/:userId', (req, res) => {
const { friendId, action } = req.body;
const friends = getFriends(req.params.userId);
if (action === 'add') {
if (!friends.includes(friendId)) {
friends.push(friendId);
saveFriends(req.params.userId, friends);
}
} else if (action === 'remove') {
const idx = friends.indexOf(friendId);
if (idx > -1) { friends.splice(idx, 1); saveFriends(req.params.userId, friends); }
}
res.json({ success: true, friends });
});

app.get('/api/groups', (req, res) => {
res.json(Object.values(getGroups()));
});

app.post('/api/groups', (req, res) => {
const { name, members, creatorId, avatarColor, type, description } = req.body;
const id = type === 'channel' ? '@channel_' + Date.now() : '@group_' + Date.now();
const group = { id, name, description, members: [...members, creatorId], creatorId, avatarColor, type, admins: [creatorId] };
saveGroup(group);
res.json({ success: true, group });
});

app.get('/api/chats/:userId', (req, res) => {
const users = getUsers();
const groups = getGroups();
const chats = [];
for (let uid in users) {
if (uid !== req.params.userId) {
const chatId = [req.params.userId, uid].sort().join('_');
const msgs = getMessages(chatId);
if (msgs.length > 0) {
const user = users[uid];
chats.push({
id: uid,
name: `${user.name} ${user.surname}`,
lastMsg: msgs[msgs.length-1].text || (msgs[msgs.length-1].attachments?.length > 0 ? '📎 Файл' : ''),
lastTime: msgs[msgs.length-1].time,
online: onlineUsers.has(uid),
type: 'private',
avatarColor: user.avatarColor,
avatarImage: user.avatarImage
});
}
}
}
for (let gid in groups) {
if (groups[gid].members.includes(req.params.userId)) {
const chatId = groups[gid].type === 'channel' ? gid : [req.params.userId, gid].sort().join('_');
const msgs = getMessages(chatId);
chats.push({
id: gid, name: groups[gid].name,
lastMsg: msgs.length > 0 ? (msgs[msgs.length-1].text || (msgs[msgs.length-1].attachments?.length > 0 ? '📎 Файл' : '')) : 'Группа создана',
lastTime: msgs.length > 0 ? msgs[msgs.length-1].time : '',
type: groups[gid].type,
avatarColor: groups[gid].avatarColor,
members: groups[gid].members.length
});
}
}
chats.sort((a, b) => new Date(b.lastTime || 0) - new Date(a.lastTime || 0));
res.json(chats);
});

app.get('/api/messages/:chatId', (req, res) => {
res.json(getMessages(req.params.chatId));
});

app.get('/api/chat-media/:chatId', (req, res) => {
const msgs = getMessages(req.params.chatId);
const media = { images: [], videos: [], files: [], audio: [] };
msgs.forEach(msg => {
if (msg.type === 'image') media.images.push(msg);
else if (msg.type === 'video') media.videos.push(msg);
else if (msg.type === 'audio' || msg.type === 'voice') media.audio.push(msg);
else if (msg.type === 'file') media.files.push(msg);
if (msg.attachments) {
msg.attachments.forEach(att => {
if (att.type.startsWith('image/')) media.images.push({ text: att.url, time: msg.time });
else if (att.type.startsWith('video/')) media.videos.push({ text: att.url, time: msg.time });
else media.files.push({ text: att.url, fileName: att.name, time: msg.time });
});
}
});
res.json(media);
});

app.delete('/api/messages/:chatId/:index', (req, res) => {
const { chatId, index } = req.params;
const { userId } = req.query;
const msgs = getMessages(chatId);
if (!msgs[index]) return res.status(404).json({ error: 'Сообщение не найдено' });
if (msgs[index].from === userId) {
msgs[index].deleted = true;
msgs[index].text = 'Сообщение удалено';
saveJSON(`chat_${chatId}.json`, msgs);
res.json({ success: true });
} else {
res.status(403).json({ error: 'Нельзя удалить чужое сообщение' });
}
});

app.get('/api/settings/:userId', (req, res) => {
res.json(getSettings(req.params.userId));
});

app.post('/api/settings/:userId', (req, res) => {
const settings = getSettings(req.params.userId);
Object.assign(settings, req.body);
saveSettings(req.params.userId, settings);
res.json({ success: true });
});

app.post('/api/block/:userId', (req, res) => {
const { blockedId } = req.body;
const settings = getSettings(req.params.userId);
if (!settings.blocked.includes(blockedId)) {
settings.blocked.push(blockedId);
saveSettings(req.params.userId, settings);
}
res.json({ success: true });
});

app.delete('/api/block/:userId/:blockedId', (req, res) => {
const settings = getSettings(req.params.userId);
settings.blocked = settings.blocked.filter(id => id !== req.params.blockedId);
saveSettings(req.params.userId, settings);
res.json({ success: true });
});

app.get('/api/folders/:userId', (req, res) => {
res.json(getFolders(req.params.userId));
});

app.post('/api/folders/:userId', (req, res) => {
saveFolders(req.params.userId, req.body);
res.json({ success: true });
});

app.get('/api/saved/:userId', (req, res) => {
res.json(getSavedMessages(req.params.userId));
});

app.post('/api/saved/:userId', (req, res) => {
saveSavedMessage(req.params.userId, req.body.msg);
res.json({ success: true });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
if (req.file) {
res.json({ 
url: `/uploads/${req.file.filename}`, 
type: req.file.mimetype, 
name: req.file.originalname,
size: req.file.size
});
} else {
res.status(400).json({ error: 'No file' });
}
});

// === SOCKET ===
io.on('connection', (socket) => {
let userId = null;

socket.on('user_login', (id) => {
userId = id;
onlineUsers.set(id, socket.id);
const users = getUsers();
if (users[id]) {
users[id].status = 'online';
users[id].lastSeen = new Date().toISOString();
saveUser(users[id]);
}
io.emit('user_status', { id, online: true });
});

socket.on('join_chat', (chatId) => {
socket.join(chatId);
});

socket.on('send_message', (data) => {
const settings = getSettings(data.message.from);
if (settings.blocked.includes(data.message.from)) return;
const msgId = saveMessage(data.chatId, data.message);
data.message.id = msgId;
io.to(data.chatId).emit('receive_message', {
chatId: data.chatId,
message: data.message,
senderId: data.message.from
});
const msgs = getMessages(data.chatId);
if (msgs.length === 1) {
const otherUser = data.chatId.replace(data.message.from + '_', '').replace('_' + data.message.from, '');
if (otherUser && otherUser !== data.message.from) {
const users = getUsers();
const sender = users[data.message.from];
const otherSocketId = onlineUsers.get(otherUser);
if (otherSocketId) {
io.to(otherSocketId).emit('new_chat_notification', {
from: data.message.from,
fromName: sender?.name || data.message.from,
message: (data.message.text || data.message.attachments?.length > 0 ? '📎 Файл' : '').substring(0, 20) + '...'
});
}
}
}
});

socket.on('message_read', (data) => {
const msgs = getMessages(data.chatId);
if (msgs[data.messageId]) {
if (!msgs[data.messageId].readBy) msgs[data.messageId].readBy = [];
if (!msgs[data.messageId].readBy.includes(data.userId)) {
msgs[data.messageId].readBy.push(data.userId);
saveJSON(`chat_${data.chatId}.json`, msgs);
io.to(data.chatId).emit('message_status_updated', {
messageId: data.messageId,
readBy: msgs[data.messageId].readBy
});
}
}
});

socket.on('delete_message', (data) => {
const msgs = getMessages(data.chatId);
if (msgs[data.index]) {
if (msgs[data.index].from === data.userId) {
msgs[data.index].deleted = true;
msgs[data.index].text = 'Сообщение удалено';
saveJSON(`chat_${data.chatId}.json`, msgs);
io.to(data.chatId).emit('message_deleted', { index: data.index });
}
}
});

socket.on('edit_message', (data) => {
const msgs = getMessages(data.chatId);
if (msgs[data.index] && msgs[data.index].from === data.userId) {
msgs[data.index].text = data.text;
msgs[data.index].edited = true;
saveJSON(`chat_${data.chatId}.json`, msgs);
io.to(data.chatId).emit('message_edited', { index: data.index, text: data.text });
}
});

socket.on('add_reaction', (data) => {
const msgs = getMessages(data.chatId);
if (msgs[data.index]) {
if (!msgs[data.index].reactions) msgs[data.index].reactions = [];
const existing = msgs[data.index].reactions.find(r => r.emoji === data.emoji && r.userId === data.userId);
if (existing) {
existing.count++;
} else {
msgs[data.index].reactions.push({ emoji: data.emoji, userId: data.userId, count: 1 });
}
saveJSON(`chat_${data.chatId}.json`, msgs);
io.to(data.chatId).emit('reaction_added', { index: data.index, reactions: msgs[data.index].reactions });
}
});

socket.on('typing', (data) => {
socket.to(data.chatId).emit('user_typing', data);
});

socket.on('disconnect', () => {
if (userId) {
onlineUsers.delete(userId);
const users = getUsers();
if (users[userId]) {
users[userId].status = 'offline';
users[userId].lastSeen = new Date().toISOString();
saveUser(users[userId]);
}
io.emit('user_status', { id: userId, online: false });
}
});
});

// Бот поддержки
if (!fs.existsSync('./database/users.json')) {
const supportUser = {
id: '@support', name: 'Поддержка', surname: 'Telepam',
password: 'support123', avatarColor: '#0088cc', avatarImage: null,
bio: 'Официальная поддержка Telepam', channels: [],
status: 'online', lastSeen: new Date().toISOString()
};
saveUser(supportUser);
saveSettings('@support', { privacy: { showBio: true, showChannels: true, whoCanMessage: 'all' }, blocked: [], notifications: true, sound: true });
saveFriends('@support', []);
saveJSON(`saved_@support.json`, []);
}

server.listen(3000, () => {
console.log('✅ TELEPAM SERVER RUNNING ON PORT 3000');
console.log('🌍 http://localhost:3000');
});
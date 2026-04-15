const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// === 1. СТАТИКА ===
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/public-key', (req, res) => {
    res.json({ publicKey: 'telepam-server-rsa-key' });
});

// === 2. PostgreSQL ===
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => console.log('✅ PostgreSQL connected'));

// === 3. ТАБЛИЦЫ ===
async function createTables() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, surname TEXT, password TEXT NOT NULL, avatar_color TEXT DEFAULT '#007aff', avatar_image TEXT, bio TEXT, public_key TEXT, channels JSONB DEFAULT '[]', status TEXT DEFAULT 'offline', last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await client.query(`CREATE TABLE IF NOT EXISTS friends (user_id TEXT NOT NULL, friend_id TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, friend_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await client.query(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, creator_id TEXT NOT NULL, avatar_color TEXT DEFAULT '#007aff', avatar_image TEXT, type TEXT DEFAULT 'group', members TEXT[] DEFAULT '{}', admins TEXT[] DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await client.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, chat_id TEXT NOT NULL, from_user_id TEXT NOT NULL, text TEXT, encrypted BOOLEAN DEFAULT false, type TEXT DEFAULT 'text', file_name TEXT, file_size INTEGER, duration TEXT, reply_to TEXT, reply_to_index INTEGER, deleted BOOLEAN DEFAULT false, edited BOOLEAN DEFAULT false, read_by TEXT[] DEFAULT '{}', reactions JSONB DEFAULT '[]', views INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await client.query(`CREATE TABLE IF NOT EXISTS settings (user_id TEXT PRIMARY KEY, privacy JSONB DEFAULT '{"showBio": true, "showChannels": true, "whoCanMessage": "all"}', blocked TEXT[] DEFAULT '{}', notifications BOOLEAN DEFAULT true, sound BOOLEAN DEFAULT true, theme JSONB DEFAULT '{"accentColor": "#007aff", "animationSpeed": "normal"}', FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        await client.query(`CREATE TABLE IF NOT EXISTS folders (user_id TEXT PRIMARY KEY, folders JSONB DEFAULT '[{"id": "all", "name": "Все чаты", "chats": [], "icon": "💬"}]', FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
        console.log('✅ Tables ready');
    } catch (err) { console.error('❌ DB Error:', err); }
    finally { client.release(); }
}

// === 4. ЗАГРУЗКА ФАЙЛОВ ===
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

let onlineUsers = new Map();

// === 5. API ROUTES ===

app.post('/api/register', async (req, res) => {
    const { id, name, surname, password, avatarColor, avatarImage, bio, publicKey } = req.body;
    if (!id?.startsWith('@')) return res.status(400).json({ error: 'ID должен начинаться с @' });
    const client = await pool.connect();
    try {
        const existing = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        if (existing.rows.length > 0) return existing.rows[0].password === password ? res.json({ success: true, user: existing.rows[0], action: 'login' }) : res.status(401).json({ error: 'Неверный пароль' });
        
        const newUser = { id, name, surname, password, avatar_color: avatarColor || '#007aff', avatar_image: avatarImage || null, bio: bio || '', public_key: publicKey || null, channels: [], status: 'offline', last_seen: new Date().toISOString() };
        await client.query(`INSERT INTO users (id, name, surname, password, avatar_color, avatar_image, bio, public_key, channels, status, last_seen) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [id, name, surname, password, newUser.avatar_color, newUser.avatar_image, newUser.bio, newUser.public_key, JSON.stringify(newUser.channels), newUser.status, newUser.last_seen]);
        await client.query(`INSERT INTO settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
        await client.query(`INSERT INTO folders (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
        res.json({ success: true, user: newUser, action: 'register' });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.post('/api/login', async (req, res) => {
    const { id, password } = req.body;
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
        if (result.rows[0].password !== password) return res.status(401).json({ error: 'Неверный пароль' });
        res.json({ success: true, user: result.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.put('/api/users/:id', async (req, res) => {
    const { avatar_image, avatar_color, bio, name, surname, public_key } = req.body;
    const client = await pool.connect();
    try {
        await client.query(`UPDATE users SET avatar_image = COALESCE($1, avatar_image), avatar_color = COALESCE($2, avatar_color), bio = COALESCE($3, bio), name = COALESCE($4, name), surname = COALESCE($5, surname), public_key = COALESCE($6, public_key) WHERE id = $7`, [avatar_image, avatar_color, bio, name, surname, public_key, req.params.id]);
        const result = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true, user: result.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.get('/api/users', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT id, name, surname, avatar_color, avatar_image, bio, channels, status, last_seen, public_key FROM users`);
        res.json(result.rows.map(u => ({ ...u, avatarColor: u.avatar_color, avatarImage: u.avatar_image, online: onlineUsers.has(u.id) })));
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.get('/api/user/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const userResult = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const user = userResult.rows[0];
        const settingsResult = await client.query('SELECT * FROM settings WHERE user_id = $1', [req.params.id]);
        const settings = settingsResult.rows[0] || {};
        res.json({ id: user.id, name: user.name, surname: user.surname, avatarColor: user.avatar_color, avatarImage: user.avatar_image, bio: settings.privacy?.showBio ? user.bio : '', publicKey: user.public_key, channels: settings.privacy?.showChannels ? user.channels : [], online: onlineUsers.has(req.params.id), lastSeen: user.last_seen });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.get('/api/friends/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT friend_id FROM friends WHERE user_id = $1 AND friend_id != user_id`, [req.params.userId]);
        const friendIds = result.rows.map(r => r.friend_id);
        if (friendIds.length === 0) return res.json([]);
        const usersResult = await client.query(`SELECT id, name, surname, avatar_color, avatar_image, bio, channels, public_key FROM users WHERE id = ANY($1)`, [friendIds]);
        res.json(usersResult.rows.map(u => ({ ...u, avatarColor: u.avatar_color, avatarImage: u.avatar_image, online: onlineUsers.has(u.id) })));
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.post('/api/friends/:userId', async (req, res) => {
    const { friendId, action } = req.body;
    const client = await pool.connect();
    try {
        if (action === 'add') await client.query(`INSERT INTO friends (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING`, [req.params.userId, friendId]);
        else if (action === 'remove') await client.query(`DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`, [req.params.userId, friendId]);
        const result = await client.query(`SELECT friend_id FROM friends WHERE user_id = $1`, [req.params.userId]);
        res.json({ success: true, friends: result.rows.map(r => r.friend_id) });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.post('/api/groups', async (req, res) => {
    const { name, members, creatorId, avatarColor, type, description } = req.body;
    const id = type === 'channel' ? '@channel_' + Date.now() : '@group_' + Date.now();
    const client = await pool.connect();
    try {
        await client.query(`INSERT INTO groups (id, name, description, creator_id, avatar_color, type, members, admins) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, name, description, creatorId, avatarColor, type, [...members, creatorId], [creatorId]]);
        res.json({ success: true, group: { id, name, description, members: [...members, creatorId], creatorId, avatarColor, type, admins: [creatorId] } });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.get('/api/chats/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        const chats = [];
        const privateChats = await client.query(`SELECT DISTINCT chat_id, MAX(created_at) as last_time FROM messages WHERE chat_id LIKE $1 OR chat_id LIKE $2 GROUP BY chat_id ORDER BY last_time DESC`, [`%_${req.params.userId}`, `${req.params.userId}_%`]);
        for (const row of privateChats.rows) {
            const otherUserId = row.chat_id.replace(`${req.params.userId}_`, '').replace(`_${req.params.userId}`, '');
            const userResult = await client.query('SELECT * FROM users WHERE id = $1', [otherUserId]);
            if (userResult.rows.length === 0) continue;
            const user = userResult.rows[0];
            const lastMsg = (await client.query(`SELECT text, type, deleted FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1`, [row.chat_id])).rows[0];
            chats.push({ id: otherUserId, name: `${user.name} ${user.surname || ''}`, lastMsg: lastMsg?.text || 'Нет сообщений', lastTime: row.last_time, online: onlineUsers.has(otherUserId), type: 'private', avatarColor: user.avatar_color, avatarImage: user.avatar_image });
        }
        const groupsResult = await client.query(`SELECT * FROM groups WHERE $1 = ANY(members)`, [req.params.userId]);
        for (const group of groupsResult.rows) {
            const lastMsg = (await client.query(`SELECT text, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1`, [group.id])).rows[0];
            chats.push({ id: group.id, name: group.name, lastMsg: lastMsg?.text || 'Группа создана', lastTime: lastMsg?.created_at || group.created_at, type: group.type, avatarColor: group.avatar_color, avatarImage: group.avatar_image, members: group.members?.length || 0 });
        }
        chats.sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
        res.json(chats);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.get('/api/messages/:chatId', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC`, [req.params.chatId]);
        res.json(result.rows.map(m => ({ ...m, from: m.from_user_id, time: m.created_at })));
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.get('/api/chat-media/:chatId', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT * FROM messages WHERE chat_id = $1 AND type IN ('image', 'video', 'audio', 'file') ORDER BY created_at DESC`, [req.params.chatId]);
        const media = { images: [], videos: [], files: [], audio: [] };
        result.rows.forEach(m => {
            if (m.type === 'image') media.images.push({ text: m.text, time: m.created_at });
            else if (m.type === 'video') media.videos.push({ text: m.text, time: m.created_at });
            else if (m.type === 'audio') media.audio.push({ text: m.text, time: m.created_at });
            else if (m.type === 'file') media.files.push({ text: m.text, fileName: m.file_name, time: m.created_at });
        });
        res.json(media);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.delete('/api/messages/:chatId/:index', async (req, res) => {
    const { chatId, index } = req.params;
    const { userId } = req.query;
    const client = await pool.connect();
    try {
        const msg = (await client.query(`SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 1 OFFSET $2`, [chatId, index])).rows[0];
        if (msg && msg.from_user_id === userId) {
            await client.query(`UPDATE messages SET deleted = true, text = 'Сообщение удалено' WHERE id = $1`, [msg.id]);
            res.json({ success: true });
        } else res.status(403).json({ error: 'Forbidden' });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.post('/api/settings/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query(`INSERT INTO settings (user_id, privacy, blocked, notifications, sound, theme) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id) DO UPDATE SET privacy = EXCLUDED.privacy, blocked = EXCLUDED.blocked, notifications = EXCLUDED.notifications, sound = EXCLUDED.sound, theme = EXCLUDED.theme`, [req.params.userId, JSON.stringify(req.body.privacy), req.body.blocked, req.body.notifications, req.body.sound, JSON.stringify(req.body.theme)]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.get('/api/folders/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        const reslt = await client.query('SELECT folders FROM folders WHERE user_id = $1', [req.params.userId]);
        res.json(reslt.rows[0]?.folders || [{ id: 'all', name: 'Все чаты', chats: [], icon: '💬' }]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
    finally { client.release(); }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (req.file) res.json({ url: `/uploads/${req.file.filename}`, type: req.file.mimetype, name: req.file.originalname, size: req.file.size });
    else res.status(400).json({ error: 'No file' });
});

// === 6. SOCKET.IO ===
io.on('connection', (socket) => {
    let userId = null;
    socket.on('user_login', async (id) => {
        userId = id;
        onlineUsers.set(id, socket.id);
        const client = await pool.connect();
        try { await client.query(`UPDATE users SET status = 'online', last_seen = NOW() WHERE id = $1`, [id]); }
        finally { client.release(); }
        io.emit('user_status', { id, online: true });
    });

    socket.on('join_chat', (chatId) => socket.join(chatId));

    socket.on('send_message', async (data) => {
        const client = await pool.connect();
        try {
            const result = await client.query(`INSERT INTO messages (chat_id, from_user_id, text, encrypted, type, file_name, file_size, duration, reply_to) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`, [data.chatId, data.message.from, data.message.text, data.message.encrypted || false, data.message.type, data.message.fileName, data.message.fileSize, data.message.duration, data.message.replyTo]);
            data.message.id = result.rows[0].id;
            data.message.time = result.rows[0].created_at;
            io.to(data.chatId).emit('receive_message', data);
        } catch (err) { console.error('Send error:', err); }
        finally { client.release(); }
    });

    socket.on('typing', (data) => socket.to(data.chatId).emit('user_typing', { chatId: data.chatId, userId: data.userId }));

    socket.on('disconnect', async () => {
        if (userId) {
            onlineUsers.delete(userId);
            const client = await pool.connect();
            try { await client.query(`UPDATE users SET status = 'offline', last_seen = NOW() WHERE id = $1`, [userId]); }
            finally { client.release(); }
            io.emit('user_status', { id: userId, online: false });
        }
    });
});

// === 7. ЗАПУСК ===
const PORT = process.env.PORT || 3000;
createTables().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on port ${PORT}`);
    });
});

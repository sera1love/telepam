const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
const NodeRSA = require('node-rsa');
const path = require('path');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Настройка Socket.IO с CORS
const io = new Server(server, { 
    cors: { 
        origin: process.env.NODE_ENV === 'production' ? false : "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Безопасные заголовки
app.use(helmet({
    contentSecurityPolicy: false, // Отключаем для разработки
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : "*",
    credentials: true
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/components', express.static(path.join(__dirname, 'components')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));

// === RSA KEY GENERATION ===
const rsaKey = new NodeRSA({ b: 512 });
const publicKey = rsaKey.exportKey('public');
const privateKey = rsaKey.exportKey('private');

// === POSTGRESQL ПОДКЛЮЧЕНИЕ ===
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://db_telemapm_user:8MAMpE6XiZRJPCyBdj2NOUa7H8CFywEg@dpg-d71gk36a2pns73f6tlag-a/db_telemapm',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

pool.on('connect', () => console.log('✅ PostgreSQL connected'));
pool.on('error', (err) => console.error('❌ PostgreSQL error:', err));

// === СОЗДАНИЕ ТАБЛИЦ ===
async function createTables() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            surname TEXT,
            password TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#007aff',
            avatar_image TEXT,
            bio TEXT,
            public_key TEXT,
            channels JSONB DEFAULT '[]',
            status TEXT DEFAULT 'offline',
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS friends (
            user_id TEXT NOT NULL,
            friend_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, friend_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            creator_id TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#007aff',
            avatar_image TEXT,
            type TEXT DEFAULT 'group',
            members TEXT[] DEFAULT '{}',
            admins TEXT[] DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
            from_user_id TEXT NOT NULL,
            text TEXT,
            encrypted BOOLEAN DEFAULT false,
            type TEXT DEFAULT 'text',
            file_name TEXT,
            file_size INTEGER,
            duration TEXT,
            reply_to TEXT,
            reply_to_index INTEGER,
            deleted BOOLEAN DEFAULT false,
            edited BOOLEAN DEFAULT false,
            read_by TEXT[] DEFAULT '{}',
            reactions JSONB DEFAULT '[]',
            views INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS settings (
            user_id TEXT PRIMARY KEY,
            privacy JSONB DEFAULT '{"showBio": true, "showChannels": true, "whoCanMessage": "all"}',
            blocked TEXT[] DEFAULT '{}',
            notifications BOOLEAN DEFAULT true,
            sound BOOLEAN DEFAULT true,
            theme JSONB DEFAULT '{"accentColor": "#007aff", "animationSpeed": "normal"}',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS folders (
            user_id TEXT PRIMARY KEY,
            folders JSONB DEFAULT '[{"id": "all", "name": "Все чаты", "chats": [], "icon": "💬"}]',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id)`);

        console.log('✅ Tables created successfully');
    } catch (err) {
        console.error('❌ Error creating tables:', err);
    } finally {
        client.release();
    }
}

// === ЗАГРУЗКА ФАЙЛОВ ===
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'))
});

const upload = multer({ 
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

// === ONLINE USERS ===
let onlineUsers = new Map();
let userPublicKeys = new Map();

// === API ROUTES ===

// Получить публичный ключ сервера
app.get('/api/public-key', (req, res) => {
    res.json({ publicKey });
});

// Регистрация
app.post('/api/register', async (req, res) => {
    const { id, name, surname, password, avatarColor, avatarImage, bio, publicKey } = req.body;
    
    if (!id || !id.startsWith('@')) {
        return res.status(400).json({ error: 'ID должен начинаться с @' });
    }

    const client = await pool.connect();
    try {
        const existing = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        
        if (existing.rows.length > 0) {
            if (existing.rows[0].password !== password) {
                return res.status(401).json({ error: 'Неверный пароль' });
            }
            return res.json({ success: true, user: existing.rows[0], action: 'login' });
        }

        const newUser = {
            id, name, surname, password,
            avatar_color: avatarColor || '#007aff',
            avatar_image: avatarImage || null,
            bio: bio || '',
            public_key: publicKey || null,
            channels: [],
            status: 'offline',
            last_seen: new Date().toISOString()
        };

        await client.query(`
            INSERT INTO users (id, name, surname, password, avatar_color, avatar_image, bio, public_key, channels, status, last_seen)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [id, name, surname, password, newUser.avatar_color, newUser.avatar_image, newUser.bio, 
            newUser.public_key, JSON.stringify(newUser.channels), newUser.status, newUser.last_seen]);

        await client.query(`
            INSERT INTO settings (user_id, privacy, blocked, notifications, sound, theme)
            VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id) DO NOTHING
        `, [id, JSON.stringify({ showBio: true, showChannels: true, whoCanMessage: 'all' }), [], true, true, 
            JSON.stringify({ accentColor: '#007aff', animationSpeed: 'normal' })]);

        await client.query(`
            INSERT INTO folders (user_id, folders) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING
        `, [id, JSON.stringify([{ id: 'all', name: 'Все чаты', chats: [], icon: '💬' }])]);

        res.json({ success: true, user: newUser, action: 'register' });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Логин
app.post('/api/login', async (req, res) => {
    const { id, password } = req.body;
    
    if (!id || !password) {
        return res.status(400).json({ error: 'Введите ID и пароль' });
    }

    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        if (result.rows[0].password !== password) {
            return res.status(401).json({ error: 'Неверный пароль' });
        }
        
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Обновление профиля
app.put('/api/users/:id', async (req, res) => {
    const { avatar_image, avatar_color, bio, name, surname, public_key } = req.body;
    const client = await pool.connect();
    try {
        await client.query(`
            UPDATE users SET avatar_image = COALESCE($1, avatar_image), 
                avatar_color = COALESCE($2, avatar_color),
                bio = COALESCE($3, bio),
                name = COALESCE($4, name),
                surname = COALESCE($5, surname),
                public_key = COALESCE($6, public_key)
            WHERE id = $7
        `, [avatar_image, avatar_color, bio, name, surname, public_key, req.params.id]);
        
        const result = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Поиск пользователей
app.get('/api/users/search/:query', async (req, res) => {
    const query = req.params.query.toLowerCase();
    const exclude = req.query.exclude;
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT id, name, surname, avatar_color, avatar_image, bio, channels, public_key
            FROM users WHERE (LOWER(id) LIKE $1 OR LOWER(name) LIKE $1) AND id != $2 LIMIT 10
        `, [`%${query}%`, exclude]);
        res.json(result.rows.map(u => ({ ...u, avatarColor: u.avatar_color, avatarImage: u.avatar_image, online: onlineUsers.has(u.id) })));
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Все пользователи
app.get('/api/users', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT id, name, surname, avatar_color, avatar_image, bio, channels, status, last_seen, public_key FROM users`);
        res.json(result.rows.map(u => ({ ...u, avatarColor: u.avatar_color, avatarImage: u.avatar_image, online: onlineUsers.has(u.id) })));
    } catch (err) {
        console.error('Users error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Профиль пользователя
app.get('/api/user/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const userResult = await client.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const user = userResult.rows[0];
        const settingsResult = await client.query('SELECT * FROM settings WHERE user_id = $1', [req.params.id]);
        const settings = settingsResult.rows[0] || {};
        res.json({
            id: user.id, name: user.name, surname: user.surname,
            avatarColor: user.avatar_color, avatarImage: user.avatar_image,
            bio: settings.privacy?.showBio ? user.bio : '',
            publicKey: user.public_key,
            channels: settings.privacy?.showChannels ? user.channels : [],
            online: onlineUsers.has(req.params.id),
            lastSeen: user.last_seen
        });
    } catch (err) {
        console.error('User profile error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Друзья
app.get('/api/friends/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT friend_id FROM friends WHERE user_id = $1 AND friend_id != user_id`, [req.params.userId]);
        const friendIds = result.rows.map(r => r.friend_id);
        if (friendIds.length === 0) return res.json([]);
        const usersResult = await client.query(`SELECT id, name, surname, avatar_color, avatar_image, bio, channels, public_key FROM users WHERE id = ANY($1)`, [friendIds]);
        res.json(usersResult.rows.map(u => ({ ...u, avatarColor: u.avatar_color, avatarImage: u.avatar_image, online: onlineUsers.has(u.id) })));
    } catch (err) {
        console.error('Friends error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Добавить/удалить друга
app.post('/api/friends/:userId', async (req, res) => {
    const { friendId, action } = req.body;
    const client = await pool.connect();
    try {
        if (action === 'add') {
            await client.query(`INSERT INTO friends (user_id, friend_id) VALUES ($1, $2), ($2, $1) ON CONFLICT (user_id, friend_id) DO NOTHING`, [req.params.userId, friendId]);
        } else if (action === 'remove') {
            await client.query(`DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`, [req.params.userId, friendId]);
        }
        const result = await client.query(`SELECT friend_id FROM friends WHERE user_id = $1 AND friend_id != user_id`, [req.params.userId]);
        res.json({ success: true, friends: result.rows.map(r => r.friend_id) });
    } catch (err) {
        console.error('Friends update error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Группы
app.get('/api/groups', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM groups');
        res.json(result.rows);
    } catch (err) {
        console.error('Groups error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Создать группу
app.post('/api/groups', async (req, res) => {
    const { name, members, creatorId, avatarColor, type, description } = req.body;
    const id = type === 'channel' ? '@channel_' + Date.now() : '@group_' + Date.now();
    const client = await pool.connect();
    try {
        await client.query(`INSERT INTO groups (id, name, description, creator_id, avatar_color, type, members, admins) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
            [id, name, description, creatorId, avatarColor, type, [...members, creatorId], [creatorId]]);
        res.json({ success: true, group: { id, name, description, members: [...members, creatorId], creatorId, avatarColor, type, admins: [creatorId] } });
    } catch (err) {
        console.error('Create group error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Чаты пользователя
app.get('/api/chats/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        const chats = [];
        const privateChats = await client.query(`SELECT DISTINCT chat_id, MAX(created_at) as last_time FROM messages WHERE chat_id LIKE '%_${req.params.userId}_%' OR chat_id LIKE '${req.params.userId}_%' OR chat_id LIKE '%_${req.params.userId}' GROUP BY chat_id ORDER BY last_time DESC`);
        
        for (const row of privateChats.rows) {
            const chatId = row.chat_id;
            const otherUserId = chatId.replace(`${req.params.userId}_`, '').replace(`_${req.params.userId}`, '');
            const userResult = await client.query('SELECT * FROM users WHERE id = $1', [otherUserId]);
            if (userResult.rows.length === 0) continue;
            const user = userResult.rows[0];
            const lastMsgResult = await client.query(`SELECT text, type, file_name, deleted FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1`, [chatId]);
            const lastMsg = lastMsgResult.rows[0];
            let lastMsgText = lastMsg?.text || 'Нет сообщений';
            if (lastMsg?.deleted) lastMsgText = '📝 Сообщение удалено';
            else if (lastMsg?.type === 'file') lastMsgText = '📎 Файл';
            else if (lastMsg?.type === 'image') lastMsgText = '📷 Фото';
            else if (lastMsg?.type === 'video') lastMsgText = '🎬 Видео';
            else if (lastMsg?.type === 'voice') lastMsgText = '🎤 Голосовое';
            chats.push({ id: otherUserId, name: `${user.name} ${user.surname}`, lastMsg: lastMsgText, lastTime: row.last_time, online: onlineUsers.has(otherUserId), type: 'private', avatarColor: user.avatar_color, avatarImage: user.avatar_image });
        }
        
        const groupsResult = await client.query(`SELECT * FROM groups WHERE $1 = ANY(members)`, [req.params.userId]);
        for (const group of groupsResult.rows) {
            const lastMsgResult = await client.query(`SELECT text, type, file_name, created_at, deleted FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1`, [group.id]);
            const lastMsg = lastMsgResult.rows[0];
            let lastMsgText = lastMsg?.text || 'Группа создана';
            if (lastMsg?.deleted) lastMsgText = '📝 Сообщение удалено';
            else if (lastMsg?.type === 'file') lastMsgText = '📎 Файл';
            else if (lastMsg?.type === 'image') lastMsgText = '📷 Фото';
            chats.push({ id: group.id, name: group.name, lastMsg: lastMsgText, lastTime: lastMsg?.created_at || group.created_at, type: group.type, avatarColor: group.avatar_color, avatarImage: group.avatar_image, members: group.members?.length || 0 });
        }
        
        chats.sort((a, b) => new Date(b.lastTime || 0) - new Date(a.lastTime || 0));
        res.json(chats);
    } catch (err) {
        console.error('Chats error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Сообщения чата
app.get('/api/messages/:chatId', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC`, [req.params.chatId]);
        res.json(result.rows.map(m => ({ ...m, readBy: m.read_by, replyTo: m.reply_to, replyToIndex: m.reply_to_index, fileName: m.file_name, fileSize: m.file_size, from: m.from_user_id })));
    } catch (err) {
        console.error('Messages error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Медиа чата
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
    } catch (err) {
        console.error('Media error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Удалить сообщение
app.delete('/api/messages/:chatId/:index', async (req, res) => {
    const { chatId, index } = req.params;
    const { userId } = req.query;
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 1 OFFSET $2`, [chatId, parseInt(index)]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Сообщение не найдено' });
        const msg = result.rows[0];
        if (msg.from_user_id === userId) {
            await client.query(`UPDATE messages SET deleted = true, text = 'Сообщение удалено' WHERE chat_id = $1 AND id = $2`, [chatId, msg.id]);
            res.json({ success: true });
        } else {
            res.status(403).json({ error: 'Нельзя удалить чужое сообщение' });
        }
    } catch (err) {
        console.error('Delete message error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Настройки
app.get('/api/settings/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM settings WHERE user_id = $1', [req.params.userId]);
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error('Settings error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.post('/api/settings/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query(`INSERT INTO settings (user_id, privacy, blocked, notifications, sound, theme) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id) DO UPDATE SET privacy = EXCLUDED.privacy, blocked = EXCLUDED.blocked, notifications = EXCLUDED.notifications, sound = EXCLUDED.sound, theme = EXCLUDED.theme`, 
            [req.params.userId, JSON.stringify(req.body.privacy || {}), req.body.blocked || [], req.body.notifications ?? true, req.body.sound ?? true, JSON.stringify(req.body.theme || {})]);
        res.json({ success: true });
    } catch (err) {
        console.error('Settings update error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Блокировка
app.post('/api/block/:userId', async (req, res) => {
    const { blockedId } = req.body;
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT blocked FROM settings WHERE user_id = $1', [req.params.userId]);
        const blocked = result.rows[0]?.blocked || [];
        if (!blocked.includes(blockedId)) {
            blocked.push(blockedId);
            await client.query('UPDATE settings SET blocked = $2 WHERE user_id = $1', [req.params.userId, blocked]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Block error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.delete('/api/block/:userId/:blockedId', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT blocked FROM settings WHERE user_id = $1', [req.params.userId]);
        const blocked = (result.rows[0]?.blocked || []).filter(id => id !== req.params.blockedId);
        await client.query('UPDATE settings SET blocked = $2 WHERE user_id = $1', [req.params.userId, blocked]);
        res.json({ success: true });
    } catch (err) {
        console.error('Unblock error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Папки
app.get('/api/folders/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT folders FROM folders WHERE user_id = $1', [req.params.userId]);
        res.json(result.rows[0]?.folders || [{ id: 'all', name: 'Все чаты', chats: [], icon: '💬' }]);
    } catch (err) {
        console.error('Folders error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

app.post('/api/folders/:userId', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query(`INSERT INTO folders (user_id, folders) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET folders = EXCLUDED.folders`, [req.params.userId, JSON.stringify(req.body)]);
        res.json({ success: true });
    } catch (err) {
        console.error('Folders update error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
});

// Загрузка файлов
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (req.file) {
        res.json({ url: `/uploads/${req.file.filename}`, type: req.file.mimetype, name: req.file.originalname, size: req.file.size });
    } else {
        res.status(400).json({ error: 'No file' });
    }
});

// === SOCKET ===
io.on('connection', (socket) => {
    let userId = null;

    socket.on('user_login', async (id) => {
        userId = id;
        onlineUsers.set(id, socket.id);
        const client = await pool.connect();
        try {
            await client.query(`UPDATE users SET status = 'online', last_seen = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
            const userResult = await client.query('SELECT public_key FROM users WHERE id = $1', [id]);
            if (userResult.rows[0]?.public_key) {
                userPublicKeys.set(id, userResult.rows[0].public_key);
            }
        } catch (err) {
            console.error('User login error:', err);
        } finally {
            client.release();
        }
        io.emit('user_status', { id, online: true });
    });

    socket.on('join_chat', (chatId) => {
        socket.join(chatId);
    });

    socket.on('send_message', async (data) => {
        const client = await pool.connect();
        try {
            const settingsResult = await client.query('SELECT blocked FROM settings WHERE user_id = $1', [data.message.from]);
            const settings = settingsResult.rows[0];
            if (settings?.blocked?.includes(data.message.from)) return;

            const result = await client.query(`INSERT INTO messages (chat_id, from_user_id, text, encrypted, type, file_name, file_size, duration, reply_to, reply_to_index, read_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, created_at`, 
                [data.chatId, data.message.from, data.message.text, data.message.encrypted ?? false, data.message.type, data.message.fileName, data.message.fileSize, data.message.duration, data.message.replyTo, data.message.replyToIndex, [data.message.from]]);

            data.message.id = result.rows[0].id;
            data.message.time = result.rows[0].created_at;

            io.to(data.chatId).emit('receive_message', {
                chatId: data.chatId,
                message: data.message,
                senderId: data.message.from
            });

            const msgsResult = await client.query('SELECT COUNT(*) FROM messages WHERE chat_id = $1', [data.chatId]);
            if (parseInt(msgsResult.rows[0].count) === 1) {
                const otherUser = data.chatId.replace(data.message.from + '_', '').replace('_' + data.message.from, '');
                if (otherUser && otherUser !== data.message.from) {
                    const otherSocketId = onlineUsers.get(otherUser);
                    if (otherSocketId) {
                        io.to(otherSocketId).emit('new_chat_notification', {
                            from: data.message.from,
                            fromName: data.message.from,
                            message: (data.message.text || '').substring(0, 20) + '...'
                        });
                    }
                }
            }
        } catch (err) {
            console.error('Send message error:', err);
        } finally {
            client.release();
        }
    });

    socket.on('message_read', async (data) => {
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT read_by FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 1 OFFSET $2`, [data.chatId, data.messageId]);
            if (result.rows.length > 0) {
                const readBy = result.rows[0].read_by || [];
                if (!readBy.includes(data.userId)) {
                    readBy.push(data.userId);
                    await client.query(`UPDATE messages SET read_by = $3 WHERE chat_id = $1 AND id = (SELECT id FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 1 OFFSET $2)`, [data.chatId, data.messageId, readBy]);
                    io.to(data.chatId).emit('message_status_updated', { messageId: data.messageId, readBy: readBy });
                }
            }
        } catch (err) {
            console.error('Message read error:', err);
        } finally {
            client.release();
        }
    });

    socket.on('delete_message', async (data) => {
        const client = await pool.connect();
        try {
            const result = await client.query(`SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 1 OFFSET $2`, [data.chatId, data.index]);
            if (result.rows.length > 0 && result.rows[0].from_user_id === data.userId) {
                await client.query(`UPDATE messages SET deleted = true, text = 'Сообщение удалено' WHERE chat_id = $1 AND id = $2`, [data.chatId, result.rows[0].id]);
                io.to(data.chatId).emit('message_deleted', { index: data.index });
            }
        } catch (err) {
            console.error('Delete message error:', err);
        } finally {
            client.release();
        }
    });

    socket.on('typing', (data) => {
        socket.to(data.chatId).emit('user_typing', data);
    });

    socket.on('disconnect', async () => {
        if (userId) {
            onlineUsers.delete(userId);
            userPublicKeys.delete(userId);
            const client = await pool.connect();
            try {
                await client.query(`UPDATE users SET status = 'offline', last_seen = CURRENT_TIMESTAMP WHERE id = $1`, [userId]);
            } catch (err) {
                console.error('Disconnect error:', err);
            } finally {
                client.release();
            }
            io.emit('user_status', { id: userId, online: false });
        }
    });
});

// === ИНИЦИАЛИЗАЦИЯ ===
createTables().then(() => {
    (async () => {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM users WHERE id = $1', ['@support']);
            if (result.rows.length === 0) {
                await client.query(`INSERT INTO users (id, name, surname, password, avatar_color, avatar_image, bio, status) VALUES ('@support', 'Поддержка', 'Telepam', 'support123', '#0088cc', NULL, 'Официальная поддержка Telepam', 'online')`);
                await client.query(`INSERT INTO settings (user_id, privacy, blocked, notifications, sound) VALUES ('@support', '{"showBio": true, "showChannels": true, "whoCanMessage": "all"}', '{}', true, true)`);
                console.log('✅ Support bot created');
            }
        } catch (err) {
            console.error('Support bot error:', err);
        } finally {
            client.release();
        }
    })();

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ SERVER RUNNING ON PORT ${PORT}`);
        console.log(`🌍 Local: http://localhost:${PORT}`);
        console.log(`🔐 RSA Public Key: ${publicKey.substring(0, 50)}...`);
    });
}).catch(err => {
    console.error('❌ Failed to initialize:', err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await pool.end();
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

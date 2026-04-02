// === RSA CRYPTO MODULE ===
const CryptoModule = {
    serverPublicKey: null,
    privateKey: null,

    // Инициализация - получение публичного ключа сервера
    async init() {
        try {
            const response = await fetch('/api/public-key');
            const data = await response.json();
            this.serverPublicKey = data.publicKey;
            console.log('✅ RSA initialized');
        } catch (error) {
            console.error('❌ RSA init error:', error);
        }
    },

    // Шифрование сообщения публичным ключом
    encrypt(text) {
        if (!text || !this.serverPublicKey) return text;
        try {
            const key = new NodeRSA(this.serverPublicKey);
            const encrypted = key.encrypt(text, 'base64');
            return encrypted;
        } catch (error) {
            console.error('Encrypt error:', error);
            return text;
        }
    },

    // Дешифрование сообщения (для локального использования)
    decrypt(encrypted) {
        if (!encrypted || !this.privateKey) return encrypted;
        try {
            const key = new NodeRSA(this.privateKey);
            const decrypted = key.decrypt(encrypted, 'utf8');
            return decrypted;
        } catch (error) {
            console.error('Decrypt error:', error);
            return encrypted;
        }
    },

    // Простое шифрование для совместимости (если RSA не доступен)
    simpleEncrypt(text) {
        if (!text) return '';
        const key = 'telepam_secret_key_2024';
        const encoder = new TextEncoder();
        const encoded = encoder.encode(text);
        let result = [];
        for (let i = 0; i < encoded.length; i++) {
            result.push(encoded[i] ^ key.charCodeAt(i % key.length));
        }
        return btoa(String.fromCharCode(...result));
    },

    // Простое дешифрование
    simpleDecrypt(encrypted) {
        try {
            if (!encrypted) return '';
            const key = 'telepam_secret_key_2024';
            const decoded = atob(encrypted);
            const bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) {
                bytes[i] = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            }
            const decoder = new TextDecoder();
            return decoder.decode(bytes);
        } catch {
            return encrypted;
        }
    }
};

// Экспорт для использования в других модулях
window.CryptoModule = CryptoModule;

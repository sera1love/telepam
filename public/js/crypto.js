const CryptoModule = {
    keyPair: null,
    publicKeyBase64: null,

    async init() {
        try {
            // Генерируем RSA-OAEP 2048 ключи
            this.keyPair = await crypto.subtle.generateKey(
                { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
                true, ["encrypt", "decrypt"]
            );
            // Экспортируем публичный ключ в Base64 для отправки на сервер
            const exported = await crypto.subtle.exportKey("spki", this.keyPair.publicKey);
            this.publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
            console.log('✅ RSA Keys Generated');
        } catch (e) {
            console.error('❌ RSA init error:', e);
        }
    },

    async encrypt(text, recipientPublicKeyBase64) {
        if (!text || !recipientPublicKeyBase64) return text;
        try {
            const binary = atob(recipientPublicKeyBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            
            const pubKey = await crypto.subtle.importKey("spki", bytes.buffer, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
            const encoded = new TextEncoder().encode(text);
            const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, encoded);
            return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
        } catch (e) {
            console.error('Encrypt error:', e);
            return text; // Fallback
        }
    },

    async decrypt(encryptedBase64) {
        if (!encryptedBase64 || !this.keyPair) return encryptedBase64;
        try {
            const binary = atob(encryptedBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            
            const decrypted = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, this.keyPair.privateKey, bytes.buffer);
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error('Decrypt error:', e);
            return encryptedBase64; // Fallback
        }
    }
};

window.Crypto = CryptoModule;

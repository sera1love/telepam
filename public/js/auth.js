async function handleLogin() {
    try {
        const id = document.getElementById('loginId').value.trim();
        const pass = document.getElementById('loginPass').value;
        if (!id.startsWith('@')) return showToast('ID должен начинаться с @');
        
        const res = await fetch('/api/login', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id, password: pass })
        });
        const data = await res.json();
        
        if (data.success) {
            App.currentUser = data.user;
            localStorage.setItem('mm_user', JSON.stringify(App.currentUser));
            socket.emit('user_login', App.currentUser.id);
            
            // Отправляем RSA публичный ключ
            if (Crypto.publicKeyBase64) {
                await fetch(`/api/users/${App.currentUser.id}`, {
                    method: 'PUT', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({publicKey: Crypto.publicKeyBase64})
                });
            }
            
            document.getElementById('authModal').classList.add('hidden');
            App.showApp();
        } else {
            showToast(data.error || 'Ошибка входа');
        }
    } catch (e) {
        console.error('Login error:', e);
        showToast('Ошибка сети');
    }
}

async function handleRegister() {
    try {
        const id = document.getElementById('authId').value.trim();
        const name = document.getElementById('authName').value.trim();
        const surname = document.getElementById('authSurname').value.trim();
        const pass = document.getElementById('authPass').value;
        const color = document.getElementById('authColor').value;
        const bio = document.getElementById('authBio').value;
        const avatarFile = document.getElementById('authAvatar').files[0];
        
        if (!id.startsWith('@')) return showToast('ID должен начинаться с @');
        if (!name) return showToast('Введите имя');
        
        let avatarUrl = null;
        if (avatarFile) {
            const formData = new FormData();
            formData.append('file', avatarFile);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            avatarUrl = data.url;
        }
        
        const res = await fetch('/api/register', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ id, name, surname, password: pass, avatarColor: color, avatarImage: avatarUrl, bio, publicKey: Crypto.publicKeyBase64 })
        });
        const data = await res.json();
        
        if (data.success) {
            App.currentUser = data.user;
            localStorage.setItem('mm_user', JSON.stringify(App.currentUser));
            socket.emit('user_login', App.currentUser.id);
            document.getElementById('authModal').classList.add('hidden');
            App.showApp();
        } else {
            showToast(data.error || 'Ошибка регистрации');
        }
    } catch (e) {
        console.error('Register error:', e);
        showToast('Ошибка сети');
    }
}

function logout() {
    localStorage.removeItem('mm_user');
    location.reload();
}

// Переключение табов
function switchAuthTab(tab) {
    document.getElementById('loginTab').classList.toggle('active', tab === 'login');
    document.getElementById('registerTab').classList.toggle('active', tab === 'register');
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
}

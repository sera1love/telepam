// === UTILITY FUNCTIONS ===

// Безопасное получение элемента
function getElement(id) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`Element #${id} not found`);
    }
    return el;
}

// Безопасная установка текста
function setTextContent(id, text) {
    const el = getElement(id);
    if (el) el.textContent = text || '';
}

// Безопасная установка HTML
function setInnerHTML(id, html) {
    const el = getElement(id);
    if (el) el.innerHTML = html || '';
}

// Показать/скрыть элемент
function toggleHidden(id, show = false) {
    const el = getElement(id);
    if (el) {
        el.classList.toggle('hidden', !show);
    }
}

// Показать уведомление
function showToast(message, duration = 3000) {
    const container = getElement('notificationContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'notification-toast animate-slide';
    toast.innerHTML = `
        <div class="notification-content">
            <div class="notification-message">${message}</div>
        </div>
        <button class="notification-close">×</button>
    `;

    toast.querySelector('.notification-close').onclick = () => toast.remove();
    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, duration);
}

// Воспроизведение звука
function playNotificationSound() {
    const audio = getElement('notificationSound');
    if (audio) {
        audio.volume = 0.5;
        audio.play().catch(() => {});
    }
}

// Форматирование времени
function formatTime(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Генерация ID
function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Проверка на мобильное устройство
function isMobile() {
    return window.innerWidth <= 768;
}

// Экспорт
window.Utils = {
    getElement,
    setTextContent,
    setInnerHTML,
    toggleHidden,
    showToast,
    playNotificationSound,
    formatTime,
    generateId,
    isMobile
};

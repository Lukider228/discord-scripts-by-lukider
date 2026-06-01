// ==UserScript==
// @name          Discord Social Copilot (AI-Powered)
// @description   Анализирует переписку в ЛС Discord с помощью ИИ, оценивает вайб отношений и предоставляет живой интерактивный чат-консультант по тактике общения.
// @namespace     https://github.com/lukider/discordsocialcopilot
// @version       2.0
// @match         https://discord.com/*
// @grant         none
// @license       MIT
// ==/UserScript==

(function() {
    'use strict';

    // Константы и настройки
    const GEMINI_KEY_STORAGE = 'social_copilot_gemini_key';
    const GEMINI_MODEL = 'gemini-2.5-flash';

    let myUserId = '';
    let isAnalyzing = false;
    let isChatLoading = false;
    
    // История живого диалога с Copilot (содержит объекты { role: 'user'|'model', parts: [{ text: '' }] })
    let copilotChatHistory = [];

    // Вспомогательная функция для вставки CSS
    const insertCss = (css) => {
        const style = document.createElement('style');
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
        return style;
    };

    // Вспомогательная функция для создания DOM элементов из HTML
    const createElm = (html) => {
        const temp = document.createElement('div');
        temp.innerHTML = html.trim();
        return temp.firstElementChild;
    };

    // Попытка получить ID текущего пользователя через внутренний Webpack Discord
    function fetchMyUserId() {
        if (myUserId) return;
        try {
            window.webpackChunkdiscord_app.push([
                [Math.random()],
                {},
                (r) => {
                    for (const m of Object.keys(r.c)) {
                        try {
                            const mod = r.c[m].exports;
                            if (mod?.default?.getUsers || mod?.getUsers) {
                                const users = (mod.default || mod).getUsers();
                                const user = Object.values(users).find(u => u.email);
                                if (user) {
                                    myUserId = user.id;
                                    console.log('[Social Copilot] Успешно получен свой ID:', myUserId);
                                    return;
                                }
                            }
                        } catch (e) {}
                    }
                }
            ]);
        } catch (err) {
            console.warn('[Social Copilot] Не удалось получить ID пользователя через Webpack:', err);
        }
    }

    // Извлечение токена авторизации с помощью хака через iframe
    function getAuthToken() {
        try {
            const iframe = document.createElement('iframe');
            document.body.appendChild(iframe);
            const token = JSON.parse(iframe.contentWindow.localStorage.token);
            iframe.remove();
            return token;
        } catch (err) {
            console.error('[Social Copilot] Ошибка извлечения токена Discord:', err);
            return null;
        }
    }

    // Инициализация стилей премиального UI с эффектом Glassmorphism и плавными анимациями
    function initStyles() {
        insertCss(`
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');

            /* Кнопка в тулбаре Discord */
            .sc-ai-toolbar-btn {
                position: relative;
                height: 24px;
                width: auto;
                margin: 0 8px;
                cursor: pointer;
                color: var(--interactive-normal);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: color 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .sc-ai-toolbar-btn:hover {
                color: #a855f7;
                transform: scale(1.1) rotate(15deg);
            }
            .sc-ai-toolbar-btn.active {
                color: #a855f7;
            }

            /* Основная боковая панель с эффектом матового стекла */
            .sc-ai-panel {
                font-family: 'Outfit', 'Inter', 'Whitney', sans-serif;
                position: fixed;
                top: 0;
                right: -390px;
                height: 100vh;
                width: 390px;
                z-index: 10001;
                color: #f1f5f9;
                background: rgba(15, 18, 22, 0.82);
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                border-left: 1px solid rgba(255, 255, 255, 0.08);
                box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.05), -10px 0 40px rgba(0, 0, 0, 0.6);
                display: flex;
                flex-direction: column;
                transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                overflow: hidden;
            }
            .sc-ai-panel.open {
                right: 0;
            }

            /* Эмбиент светящиеся неоновые сферы на фоне */
            .sc-ai-glow-purple {
                position: absolute;
                top: -80px;
                right: -80px;
                width: 250px;
                height: 250px;
                background: radial-gradient(circle, rgba(168, 85, 247, 0.16) 0%, rgba(99, 102, 241, 0) 70%);
                filter: blur(40px);
                pointer-events: none;
                z-index: -1;
            }
            .sc-ai-glow-blue {
                position: absolute;
                bottom: -80px;
                left: -80px;
                width: 250px;
                height: 250px;
                background: radial-gradient(circle, rgba(59, 130, 246, 0.12) 0%, rgba(99, 102, 241, 0) 70%);
                filter: blur(40px);
                pointer-events: none;
                z-index: -1;
            }

            /* Шапка панели */
            .sc-ai-header {
                padding: 20px 24px;
                background: rgba(30, 31, 34, 0.3);
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .sc-ai-title {
                font-size: 17px;
                font-weight: 700;
                background: linear-gradient(135deg, #c084fc 0%, #818cf8 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .sc-ai-close {
                cursor: pointer;
                color: #64748b;
                transition: color 0.2s, transform 0.2s;
            }
            .sc-ai-close:hover {
                color: #fff;
                transform: scale(1.1) rotate(90deg);
            }

            /* Вкладки (Навигация) */
            .sc-ai-tabs {
                display: flex;
                padding: 10px 16px;
                background: rgba(22, 24, 28, 0.15);
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                gap: 6px;
            }
            .sc-ai-tab {
                flex: 1;
                padding: 8px 2px;
                font-size: 11px;
                font-weight: 600;
                text-align: center;
                cursor: pointer;
                color: #94a3b8;
                border-radius: 6px;
                transition: background 0.25s cubic-bezier(0.16, 1, 0.3, 1), color 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .sc-ai-tab:hover {
                background: rgba(255, 255, 255, 0.04);
                color: #fff;
            }
            .sc-ai-tab.active {
                background: rgba(129, 140, 248, 0.14);
                color: #a5b4fc;
                box-shadow: inset 0 0 10px rgba(129, 140, 248, 0.05);
            }

            /* Контент вкладок */
            .sc-ai-content {
                flex-grow: 1;
                overflow-y: auto;
                padding: 20px;
                display: flex;
                flex-direction: column;
                gap: 16px;
                position: relative;
            }
            .sc-ai-content::-webkit-scrollbar {
                width: 4px;
            }
            .sc-ai-content::-webkit-scrollbar-track {
                background: transparent;
            }
            .sc-ai-content::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.08);
                border-radius: 2px;
            }
            .sc-ai-content::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.18);
            }

            .sc-ai-section {
                display: none;
                flex-direction: column;
                gap: 16px;
                animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            .sc-ai-section.active {
                display: flex;
            }

            /* Новое анимационное заполнение для списков и карточек */
            @keyframes fadeInUp {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }

            /* Стили для Кард-компонентов */
            .sc-ai-card {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 12px;
                padding: 16px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), border-color 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            }
            .sc-ai-card:hover {
                border-color: rgba(129, 140, 248, 0.25);
                transform: translateY(-2px);
            }

            /* Вайб-чекер круговой / прогресс индикатор */
            .sc-ai-vibe-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                gap: 12px;
                padding: 24px 16px;
                background: linear-gradient(180deg, rgba(168, 85, 247, 0.05) 0%, rgba(99, 102, 241, 0.01) 100%);
            }
            .sc-ai-vibe-meter {
                position: relative;
                width: 110px;
                height: 110px;
                border-radius: 50%;
                background: conic-gradient(#818cf8 0%, #c084fc var(--score-val, 0%), rgba(255,255,255,0.04) var(--score-val, 0%));
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 0 20px rgba(129, 140, 248, 0.15);
                transition: background 0.6s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .sc-ai-vibe-meter::after {
                content: '';
                position: absolute;
                width: 96px;
                height: 96px;
                border-radius: 50%;
                background: #121316;
            }
            .sc-ai-vibe-text {
                position: relative;
                z-index: 2;
                font-size: 26px;
                font-weight: 700;
                color: #fff;
                letter-spacing: -0.5px;
            }
            .sc-ai-vibe-label {
                font-size: 13px;
                color: #94a3b8;
                line-height: 1.55;
            }

            /* Таблицы с метриками */
            .sc-ai-metrics {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }
            .sc-ai-metric-item {
                background: rgba(255, 255, 255, 0.01);
                border: 1px solid rgba(255, 255, 255, 0.04);
                border-radius: 8px;
                padding: 12px;
                text-align: center;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            .sc-ai-metric-title {
                font-size: 10px;
                color: #64748b;
                text-transform: uppercase;
                margin-bottom: 4px;
                font-weight: 600;
                letter-spacing: 0.5px;
            }
            .sc-ai-metric-value {
                font-size: 13px;
                font-weight: 600;
                color: #cbd5e1;
            }

            /* Теги качеств характера */
            .sc-ai-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
            }
            .sc-ai-tag {
                background: rgba(168, 85, 247, 0.1);
                border: 1px solid rgba(168, 85, 247, 0.2);
                color: #e9d5ff;
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 500;
            }

            /* Умные варианты ответов */
            .sc-ai-reply-card {
                position: relative;
                cursor: pointer;
                margin-bottom: 4px;
            }
            .sc-ai-reply-label {
                font-size: 11px;
                font-weight: 700;
                color: #a5b4fc;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .sc-ai-reply-content {
                font-size: 13px;
                line-height: 1.5;
                color: #f1f5f9;
                font-style: italic;
                background: rgba(0,0,0,0.15);
                padding: 8px 12px;
                border-radius: 6px;
                border-left: 2px solid #818cf8;
            }
            .sc-ai-reply-action-hint {
                font-size: 9px;
                color: #64748b;
                text-align: right;
                margin-top: 8px;
            }

            /* Кнопка запуска анализа */
            .sc-ai-action-btn {
                background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%);
                color: #fff;
                font-weight: 600;
                border: 0;
                border-radius: 8px;
                padding: 12px;
                cursor: pointer;
                transition: opacity 0.2s, transform 0.2s, box-shadow 0.2s;
                text-align: center;
                box-shadow: 0 4px 12px rgba(168, 85, 247, 0.25);
                font-size: 13px;
            }
            .sc-ai-action-btn:hover {
                opacity: 0.95;
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(168, 85, 247, 0.35);
            }
            .sc-ai-action-btn:active {
                transform: translateY(1px);
            }
            .sc-ai-action-btn:disabled {
                background: #334155;
                box-shadow: none;
                cursor: not-allowed;
                opacity: 0.5;
            }

            /* Раздел настроек */
            .sc-ai-form-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .sc-ai-label {
                font-size: 12px;
                font-weight: 600;
                color: #94a3b8;
            }
            .sc-ai-input {
                background: #1e1f22;
                color: #fff;
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 6px;
                padding: 8px 12px;
                font-size: 13px;
                transition: border-color 0.2s;
            }
            .sc-ai-input:focus {
                outline: none;
                border-color: #818cf8;
            }
            .sc-ai-link {
                color: #818cf8;
                text-decoration: none;
                font-size: 11px;
            }
            .sc-ai-link:hover {
                text-decoration: underline;
            }

            /* Анимация загрузки (AI пульсация) */
            .sc-ai-loader-container {
                display: none;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 40px 20px;
                gap: 16px;
                text-align: center;
                animation: fadeIn 0.3s ease-out;
            }
            .sc-ai-loader {
                width: 64px;
                height: 64px;
                position: relative;
            }
            .sc-ai-loader-ring {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                border-radius: 50%;
                border: 2px solid transparent;
                border-top-color: #a855f7;
                border-bottom-color: #6366f1;
                animation: spin 1.5s linear infinite;
            }
            .sc-ai-loader-core {
                position: absolute;
                top: 12px;
                left: 12px;
                width: 40px;
                height: 40px;
                background: radial-gradient(circle, #818cf8 0%, rgba(168, 85, 247, 0.4) 100%);
                border-radius: 50%;
                animation: pulse 1.5s ease-in-out infinite alternate;
            }
            .sc-ai-loading-text {
                font-size: 14px;
                color: #a5b4fc;
                font-weight: 600;
            }
            .sc-ai-loading-sub {
                font-size: 11px;
                color: #64748b;
                line-height: 1.4;
            }

            /* ------------------------------------------------------------- */
            /* ИНТЕРФЕЙС ИНТЕРАКТИВНОГО ЧАТА С ИИ */
            .sc-ai-chat-history {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                gap: 12px;
                overflow-y: auto;
                padding: 10px 4px;
                max-height: calc(100vh - 220px);
                min-height: 250px;
            }
            .sc-ai-chat-history::-webkit-scrollbar {
                width: 3px;
            }
            .sc-ai-chat-history::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.08);
                border-radius: 1.5px;
            }
            .sc-ai-chat-message {
                max-width: 85%;
                padding: 10px 14px;
                border-radius: 14px;
                font-size: 13px;
                line-height: 1.5;
                animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
                word-break: break-word;
            }
            .sc-ai-chat-message.ai {
                align-self: flex-start;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                color: #e2e8f0;
                border-bottom-left-radius: 3px;
            }
            .sc-ai-chat-message.user {
                align-self: flex-end;
                background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
                color: #fff;
                border-bottom-right-radius: 3px;
                box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2);
            }
            
            /* Чат-ввод */
            .sc-ai-chat-input-area {
                display: flex;
                gap: 8px;
                background: rgba(30, 31, 34, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 8px;
                padding: 10px 12px;
                align-items: flex-end;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                transition: border-color 0.2s;
            }
            .sc-ai-chat-input-area:focus-within {
                border-color: rgba(129, 140, 248, 0.4);
            }
            .sc-ai-chat-input {
                flex-grow: 1;
                background: transparent;
                border: 0;
                color: #fff;
                font-family: inherit;
                font-size: 13px;
                resize: none;
                max-height: 80px;
                height: 18px;
                outline: none;
                line-height: 1.4;
            }
            .sc-ai-chat-send-btn {
                background: transparent;
                border: 0;
                color: #818cf8;
                cursor: pointer;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: color 0.2s, transform 0.2s;
            }
            .sc-ai-chat-send-btn:hover {
                color: #c084fc;
                transform: scale(1.1);
            }
            .sc-ai-chat-send-btn:disabled {
                color: #475569;
                cursor: not-allowed;
            }

            /* Пульсирующий индикатор печати ИИ */
            .sc-ai-typing-indicator {
                display: none;
                align-self: flex-start;
                align-items: center;
                gap: 4px;
                padding: 10px 14px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 14px;
                border-bottom-left-radius: 3px;
                animation: fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            .sc-ai-dot {
                width: 6px;
                height: 6px;
                background: #94a3b8;
                border-radius: 50%;
                animation: typingBounce 1.4s infinite ease-in-out both;
            }
            .sc-ai-dot:nth-child(1) { animation-delay: -0.32s; }
            .sc-ai-dot:nth-child(2) { animation-delay: -0.16s; }

            @keyframes typingBounce {
                0%, 80%, 100% { transform: scale(0); }
                40% { transform: scale(1.0); }
            }

            /* Форматирование внутри сообщений ИИ */
            .sc-ai-chat-message p {
                margin: 6px 0;
            }
            .sc-ai-chat-message strong {
                font-weight: 600;
                color: #fff;
            }
            /* ------------------------------------------------------------- */

            /* Системные анимации */
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            @keyframes pulse {
                from { transform: scale(0.85); opacity: 0.6; box-shadow: 0 0 10px rgba(129, 140, 248, 0.15); }
                to { transform: scale(1.05); opacity: 1; box-shadow: 0 0 25px rgba(168, 85, 247, 0.5); }
            }

            /* Всплывашка об успешном копировании */
            .sc-ai-toast {
                position: fixed;
                bottom: 24px;
                right: 24px;
                background: rgba(16, 185, 129, 0.95);
                color: #fff;
                padding: 10px 18px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 600;
                z-index: 10002;
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                animation: toastIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            @keyframes toastIn {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `);
    }

    // Всплывающее уведомление
    function showToast(text, isError = false) {
        const toast = createElm(`<div class="sc-ai-toast">${text}</div>`);
        if (isError) {
            toast.style.background = 'rgba(239, 68, 68, 0.95)';
            toast.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.3)';
        }
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.transition = 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, 2200);
    }

    // Форматирование Markdown в HTML для сообщений ИИ
    function formatMarkdown(text) {
        if (!text) return '';
        let html = text.trim();
        // Преобразование **жирного** текста
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Преобразование *курсива*
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // Обработка списков
        html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li style="margin-left: 14px; margin-top: 4px; list-style-type: disc;">$1</li>');
        // Разбиение на абзацы по переносам
        html = html.split('\n').map(line => {
            if (line.trim().startsWith('<li')) return line;
            return line.trim() ? `<p>${line}</p>` : '';
        }).join('');
        return html;
    }

    // Шаблон боковой панели
    function createPanel() {
        const key = localStorage.getItem(GEMINI_KEY_STORAGE) || '';

        const panelHtml = `
            <div id="sc-ai-copilot-panel" class="sc-ai-panel">
                <div class="sc-ai-glow-purple"></div>
                <div class="sc-ai-glow-blue"></div>
                
                <div class="sc-ai-header">
                    <div class="sc-ai-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                            <circle cx="12" cy="12" r="4"/>
                        </svg>
                        Social Copilot v2.0
                    </div>
                    <div class="sc-ai-close" id="sc-ai-close-btn">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </div>
                </div>

                <div class="sc-ai-tabs">
                    <div class="sc-ai-tab active" data-tab="vibe">Вайб</div>
                    <div class="sc-ai-tab" data-tab="character">Портрет</div>
                    <div class="sc-ai-tab" data-tab="chat">Чат с ИИ</div>
                    <div class="sc-ai-tab" data-tab="settings">Настройки</div>
                </div>

                <!-- Содержимое вкладок -->
                <div class="sc-ai-content" id="sc-ai-main-content">
                    
                    <!-- Общий экран загрузки для Vibe Check -->
                    <div class="sc-ai-loader-container" id="sc-ai-loading-screen">
                        <div class="sc-ai-loader">
                            <div class="sc-ai-loader-ring"></div>
                            <div class="sc-ai-loader-core"></div>
                        </div>
                        <div class="sc-ai-loading-text">Анализируем диалог...</div>
                        <div class="sc-ai-loading-sub">Изучаем баланс сил, скрытые эмоции собеседника и тактику разговора</div>
                    </div>

                    <!-- Вкладка 1: Вайб отношений -->
                    <div class="sc-ai-section active" id="sc-tab-vibe">
                        <button class="sc-ai-action-btn" id="sc-btn-analyze-vibe">Запустить Vibe Check</button>
                        
                        <div id="sc-vibe-result-container" style="display:none; flex-direction:column; gap:16px;">
                            <div class="sc-ai-card sc-ai-vibe-container">
                                <div class="sc-ai-vibe-meter" id="sc-vibe-meter-circle">
                                    <span class="sc-ai-vibe-text" id="sc-vibe-score-val">0%</span>
                                </div>
                                <div class="sc-ai-vibe-label" id="sc-vibe-description">Нажмите кнопку анализа выше, чтобы оценить динамику отношений.</div>
                            </div>
                            
                            <div class="sc-ai-metrics">
                                <div class="sc-ai-metric-item">
                                    <div class="sc-ai-metric-title">Интерес</div>
                                    <div class="sc-ai-metric-value" id="sc-metric-interest">-</div>
                                </div>
                                <div class="sc-ai-metric-item">
                                    <div class="sc-ai-metric-title">Общий Тон</div>
                                    <div class="sc-ai-metric-value" id="sc-metric-tone">-</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Вкладка 2: Характер / Портрет -->
                    <div class="sc-ai-section" id="sc-tab-character">
                        <div id="sc-character-placeholder" style="text-align:center; padding: 40px 10px; color:#64748b; font-size:13px;">
                            Запустите «Vibe Check» для создания психологического портрета.
                        </div>
                        <div id="sc-character-result" style="display:none; flex-direction:column; gap:16px;">
                            <div class="sc-ai-card">
                                <h3 style="margin-top:0; font-size:13px; color:#fff; font-weight:600;">Тип привязанности</h3>
                                <div style="font-size:13px; margin-top:6px; font-weight: 600; color:#a5b4fc;" id="sc-character-attachment">-</div>
                            </div>
                            <div class="sc-ai-card">
                                <h3 style="margin-top:0; font-size:13px; color:#fff; font-weight:600;">Характер собеседника</h3>
                                <p style="font-size:13px; line-height:1.55; color:#cbd5e1; margin: 8px 0 0 0;" id="sc-character-summary"></p>
                            </div>
                            <div class="sc-ai-card">
                                <h3 style="margin-top:0; font-size:13px; color:#fff; font-weight:600;">Черты переписки</h3>
                                <div class="sc-ai-tags" id="sc-character-tags"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Вкладка 3: Живой Чат с ИИ (Новая супер-фича) -->
                    <div class="sc-ai-section" id="sc-tab-chat">
                        <div class="sc-ai-chat-history" id="sc-chat-history">
                            <div class="sc-ai-chat-message ai">
                                Привет! Я твой **Social Copilot**. 🌟<br><br>
                                Я готов проконсультировать тебя по этому диалогу. Задай мне любой вопрос, попроси написать точечный ответ в определенном стиле или спроси, нет ли здесь скрытого подтекста!
                            </div>
                        </div>
                        
                        <!-- Индикатор печатания ИИ -->
                        <div class="sc-ai-typing-indicator" id="sc-chat-typing">
                            <div class="sc-ai-dot"></div>
                            <div class="sc-ai-dot"></div>
                            <div class="sc-ai-dot"></div>
                        </div>

                        <div class="sc-ai-chat-input-area">
                            <textarea class="sc-ai-chat-input" id="sc-chat-input-field" placeholder="Задать вопрос ассистенту..."></textarea>
                            <button class="sc-ai-chat-send-btn" id="sc-chat-send-button" title="Отправить сообщение">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <line x1="22" y1="2" x2="11" y2="13"></line>
                                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Вкладка 4: Настройки -->
                    <div class="sc-ai-section" id="sc-tab-settings">
                        <div class="sc-ai-card" style="display:flex; flex-direction:column; gap:14px;">
                            <div class="sc-ai-form-group">
                                <label class="sc-ai-label">Бесплатный API Ключ Gemini</label>
                                <input type="password" class="sc-ai-input" id="sc-input-gemini-key" placeholder="AIzaSy..." value="${key}">
                                <a href="https://aistudio.google.com/" target="_blank" class="sc-ai-link">Получить API Ключ бесплатно (AI Studio) ↗</a>
                            </div>
                            <button class="sc-ai-action-btn" id="sc-btn-save-settings">Сохранить Настройки</button>
                        </div>
                        
                        <div style="font-size:11px; color:#475569; text-align:center; margin-top:20px; line-height:1.45;">
                            Ключ находится в полной безопасности. Он хранится локально в вашем Tampermonkey и передается только напрямую на сервера Google API.
                        </div>
                    </div>

                </div>
            </div>
        `;
        const panel = createElm(panelHtml);
        document.body.appendChild(panel);

        // Привязка событий переключения вкладок
        const tabs = panel.querySelectorAll('.sc-ai-tab');
        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const targetTab = tab.getAttribute('data-tab');
                panel.querySelectorAll('.sc-ai-section').forEach(sec => sec.classList.remove('active'));
                panel.querySelector(`#sc-tab-${targetTab}`).classList.add('active');
                
                // Прокрутка чата вниз при открытии
                if (targetTab === 'chat') {
                    scrollChatToBottom();
                }
            };
        });

        // Закрытие панели
        panel.querySelector('#sc-ai-close-btn').onclick = () => {
            panel.classList.remove('open');
        };

        // Сохранение настроек
        panel.querySelector('#sc-btn-save-settings').onclick = () => {
            const val = panel.querySelector('#sc-input-gemini-key').value.trim();
            if (!val) {
                showToast('Ключ API не может быть пустым!', true);
                return;
            }
            localStorage.setItem(GEMINI_KEY_STORAGE, val);
            showToast('Ключ API успешно сохранен!');
        };

        // Кнопка Vibe Check
        panel.querySelector('#sc-btn-analyze-vibe').onclick = () => {
            triggerVibeAnalysis();
        };

        // Логика автовысоты поля ввода чата
        const chatInput = panel.querySelector('#sc-chat-input-field');
        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            const nextHeight = Math.min(this.scrollHeight - 4, 80);
            this.style.height = nextHeight + 'px';
        });

        // Отправка сообщений в Чат по кнопке
        const sendBtn = panel.querySelector('#sc-chat-send-button');
        sendBtn.onclick = () => {
            triggerChatTurn();
        };

        // Отправка сообщений в Чат по Enter (но Shift+Enter делает перенос строки)
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                triggerChatTurn();
            }
        });
    }

    // Функция прокрутки чата к самому концу
    function scrollChatToBottom() {
        const historyEl = document.getElementById('sc-chat-history');
        if (historyEl) {
            setTimeout(() => {
                historyEl.scrollTop = historyEl.scrollHeight;
            }, 50);
        }
    }

    // Включение/выключение панели
    function togglePanel() {
        const panel = document.getElementById('sc-ai-copilot-panel');
        if (!panel) return;
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) {
            fetchMyUserId();
        }
    }

    // Создание кнопки в тулбаре Discord
    let copilotBtn;
    function createToolbarBtn() {
        if (document.getElementById('sc-ai-copilot-btn')) return;

        copilotBtn = createElm(`
            <div id="sc-ai-copilot-btn" class="sc-ai-toolbar-btn" tabindex="0" role="button" aria-label="Social Copilot AI" title="Social Copilot AI (Анализ отношений)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    <circle cx="12" cy="12" r="4"/>
                </svg>
            </div>
        `);

        copilotBtn.onclick = () => {
            togglePanel();
        };
    }

    // Внедрение кнопки
    function mountBtn() {
        const toolbar = document.querySelector('[class*="toolbar"]');
        if (toolbar && !document.getElementById('sc-ai-copilot-btn')) {
            createToolbarBtn();
            toolbar.appendChild(copilotBtn);
        }
    }

    // Наблюдение за изменениями DOM Discord
    function initDOMObserver() {
        const observer = new MutationObserver((mutations) => {
            mountBtn();
        });
        observer.observe(document.body, { attributes: false, childList: true, subtree: true });
        mountBtn();
    }

    // Загрузка сообщений из текущего открытого канала
    async function loadCurrentChannelHistory() {
        const match = window.location.href.match(/channels\/([\w@]+)\/(\d+)/);
        if (!match) {
            showToast('Пожалуйста, откройте чат или ЛС для проведения анализа.', true);
            return null;
        }

        const channelId = match[2];
        const token = getAuthToken();

        if (!token) {
            showToast('Не удалось извлечь токен авторизации Discord.', true);
            return null;
        }

        try {
            const resp = await fetch(`https://discord.com/api/v9/channels/${channelId}/messages?limit=50`, {
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json'
                }
            });

            if (!resp.ok) {
                if (resp.status === 429) {
                    showToast('Превышен лимит запросов Discord. Подождите немного.', true);
                } else {
                    showToast(`Ошибка Discord API: ${resp.status}`, true);
                }
                return null;
            }

            const messages = await resp.json();
            return {
                channelId,
                messages: messages.reverse() // в хронологический порядок
            };
        } catch (err) {
            console.error('[Social Copilot] Ошибка сети при запросе истории:', err);
            showToast('Сетевая ошибка при загрузке переписки.', true);
            return null;
        }
    }

    // Форматирование истории сообщений под ваш кастомный промпт
    function formatMessages(messages) {
        if (!messages || messages.length === 0) return '';
        
        let formatted = '';
        messages.forEach((msg) => {
            const authorId = msg.author.id;
            const authorName = msg.author.global_name || msg.author.username;
            
            let role = authorName;
            if (authorId === myUserId || authorName === 'lukider') {
                role = 'lukider (Я)';
            }

            const time = new Date(msg.timestamp).toLocaleString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit', 
                day: '2-digit', 
                month: '2-digit' 
            });
            
            const content = msg.content ? msg.content : '[Вложение или системное сообщение]';
            formatted += `[${time}] ${role}: ${content}\n`;
        });
        
        return formatted;
    }

    // Генерация системного промпта на основе вашей детальной инструкции
    function getSystemInstruction(messages) {
        // Подсчитаем количество уникальных авторов сообщений
        const authors = new Set(messages.map(m => m.author.id));
        const isGroupChannel = authors.size > 2;

        let dynamicRoleContext = '';
        if (isGroupChannel) {
            dynamicRoleContext = `
            ВНИМАНИЕ: Это групповой чат/текстовый канал сервера (участников переписки > 2). 
            Твоя цель смещается с анализа парных отношений 1-на-1 на анализ **групповой динамики**.
            Выяви лидеров обсуждения, общую эмоциональную атмосферу чата, выдели ключевые коалиции или назревающие конфликты.
            Варианты ответов строй так, чтобы они органично вписывались в групповое обсуждение.
            `;
        } else {
            dynamicRoleContext = `
            ВНИМАНИЕ: Это личная переписка 1-на-1 (ЛС). 
            Сделай упор на глубокий психологический анализ, тип привязанности собеседника, искренность и баланс взаимного интереса.
            `;
        }

        return `
        Ты — Social Copilot, мой персональный ИИ-ассистент по анализу коммуникации, цифровой социолингвистике и психологии отношений.
        Твоя цель — помогать мне разбираться в нюансах общения с людьми на основе логов переписки из Discord, составлять их портреты и давать точечные, практичные советы по коммуникации.
        
        Мой никнейм по умолчанию во всех логах — lukider. Когда ты видишь сообщения от lukider (или "lukider (Я)"), это мои реплики.
        
        ${dynamicRoleContext}

        ПРАВИЛА И ПРИНЦИПЫ:
        - Читать между строк: Анализируй не только слова, но и скорость ответов (по таймстампам), длину фраз, инициативу в диалоге (кто чаще начинает диалог, кто больше пишет).
        - Будь честным другом: Если косячу я (lukider) — например, душу, спамлю, веду себя навязчиво, безразлично или токсично, — мягко, но прямо скажи мне об этом в анализе. Мне нужен объективный взгляд.
        - Конфиденциальность: Не упоминай сторонние темы, держи фокус только на контексте беседы.
        - Никакой воды: Твои формулировки должны быть лаконичными, глубокими и максимально практическими. Избегай банальностей типа "просто поговорите честно". Давай точечные тактические подсказки.
        `;
    }

    // Вызов API Gemini
    async function requestGeminiAPI(apiKey, chatLog, systemInstruction, userQuestion = null, isJson = true) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
        
        let contents = [];
        
        if (isJson) {
            // Режим Vibe Check (одноразовый запрос структурированного JSON)
            const finalInstruction = systemInstruction + `
            Выдай ответ СТРОГО в виде валидного JSON-объекта на русском языке. 
            НЕ используй разметку markdown типа \`\`\`json или \`\`\`. Не пиши ничего до или после JSON.
            
            JSON должен строго соответствовать следующей структуре:
            {
              "vibe": {
                "score": <число от 0 до 100, где 100 - идеальные гармоничные отношения, а 0 - конфликт/холодность>,
                "description": "<краткий психологический анализ вайба отношений, динамики разговора на русском, около 3 предложений>",
                "metrics": {
                  "mutual_interest": "<уровень взаимного интереса, например: 'Высокий', 'Асимметричный (ты проявляешь больше)', 'Слабый'>",
                  "tone": "<общий преобладающий тон общения на русском, например: 'Теплый', 'Сухой/Формальный', 'Пассивно-агрессивный'>"
                }
              },
              "personality": {
                "summary": "<краткий психологический портрет собеседника (Partner) на основе его сообщений, около 3 предложений>",
                "traits": ["<черта 1>", "<черта 2>", "<черта 3>"],
                "attachment_style": "<предположительный тип привязанности собеседника с кратким обоснованием на русском>"
              }
            }
            
            Вот история переписки для анализа:
            ${chatLog}
            `;
            
            contents = [
                {
                    role: 'user',
                    parts: [{ text: finalInstruction }]
                }
            ];
        } else {
            // Режим Живого Чата (передача полной истории диалога с ассистентом)
            contents = [
                {
                    role: 'user',
                    parts: [{ 
                        text: `Привет! Ты — мой Social Copilot. 
                        Вот история переписки в Discord (последние 50 сообщений), которую мы будем с тобой обсуждать:
                        
                        ${chatLog}
                        
                        Пожалуйста, впитай эти данные. Я готов задавать вопросы.` 
                    }]
                },
                {
                    role: 'model',
                    parts: [{ 
                        text: `Привет! Я впитал историю твоей переписки. Я готов к консультации! Отвечать буду строго по правилам: коротко, честно, между строк, и давать тактические советы. Задавай свой первый вопрос.` 
                    }]
                },
                ...copilotChatHistory
            ];
        }

        const requestBody = {
            contents: contents,
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            generationConfig: {
                responseMimeType: isJson ? 'application/json' : 'text/plain',
                temperature: isJson ? 0.3 : 0.7
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `Статус API ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
            throw new Error('Модель вернула пустой результат.');
        }

        return isJson ? JSON.parse(rawText.trim()) : rawText.trim();
    }

    // Отображение данных Vibe Check
    function renderVibeResult(data) {
        const panel = document.getElementById('sc-ai-copilot-panel');
        if (!panel) return;

        // Вкладка "Вайб"
        const scoreCircle = panel.querySelector('#sc-vibe-meter-circle');
        const scoreValText = panel.querySelector('#sc-vibe-score-val');
        const vibeDesc = panel.querySelector('#sc-vibe-description');
        
        scoreCircle.style.setProperty('--score-val', `${data.vibe.score}%`);
        scoreValText.textContent = `${data.vibe.score}%`;
        vibeDesc.textContent = data.vibe.description;

        panel.querySelector('#sc-metric-interest').textContent = data.vibe.metrics.mutual_interest;
        panel.querySelector('#sc-metric-tone').textContent = data.vibe.metrics.tone;
        panel.querySelector('#sc-vibe-result-container').style.display = 'flex';

        // Вкладка "Портрет"
        panel.querySelector('#sc-character-placeholder').style.display = 'none';
        panel.querySelector('#sc-character-attachment').textContent = data.personality.attachment_style;
        panel.querySelector('#sc-character-summary').textContent = data.personality.summary;

        const tagsContainer = panel.querySelector('#sc-character-tags');
        tagsContainer.innerHTML = '';
        data.personality.traits.forEach(trait => {
            tagsContainer.appendChild(createElm(`<span class="sc-ai-tag">${trait}</span>`));
        });
        panel.querySelector('#sc-character-result').style.display = 'flex';
    }

    // Запуск процесса Vibe Check
    async function triggerVibeAnalysis() {
        if (isAnalyzing) return;

        const apiKey = localStorage.getItem(GEMINI_KEY_STORAGE);
        if (!apiKey) {
            showToast('Укажите ваш API Ключ во вкладке «Настройки».', true);
            const settingsTab = document.querySelector('[data-tab="settings"]');
            if (settingsTab) settingsTab.click();
            return;
        }

        const loader = document.getElementById('sc-ai-loading-screen');
        const vibeContainer = document.getElementById('sc-vibe-result-container');
        const analyzeBtn = document.getElementById('sc-btn-analyze-vibe');

        isAnalyzing = true;
        analyzeBtn.disabled = true;
        loader.style.display = 'flex';
        vibeContainer.style.display = 'none';

        try {
            const history = await loadCurrentChannelHistory();
            if (!history) throw new Error('Не удалось загрузить историю диалога.');

            const chatLog = formatMessages(history.messages);
            if (!chatLog) throw new Error('История переписки пуста.');

            const systemInstruction = getSystemInstruction(history.messages);

            console.log('[Social Copilot] Запуск Vibe Check через Gemini...');
            const aiResponse = await requestGeminiAPI(apiKey, chatLog, systemInstruction, null, true);
            
            renderVibeResult(aiResponse);
            showToast('Анализ вайба успешно завершен!');

        } catch (err) {
            console.error('[Social Copilot] Ошибка Vibe Check:', err);
            showToast(err.message || 'Ошибка проведения Vibe Check.', true);
        } finally {
            isAnalyzing = false;
            analyzeBtn.disabled = false;
            loader.style.display = 'none';
        }
    }

    // -----------------------------------------------------------------
    // ЛОГИКА ЖИВОГО ДИАЛОГА В ЧАТЕ (ЧАТ-КОНСУЛЬТАНТ)
    async function triggerChatTurn() {
        if (isChatLoading) return;

        const apiKey = localStorage.getItem(GEMINI_KEY_STORAGE);
        if (!apiKey) {
            showToast('Укажите ваш API Ключ во вкладке «Настройки».', true);
            return;
        }

        const inputField = document.getElementById('sc-chat-input-field');
        const sendBtn = document.getElementById('sc-chat-send-button');
        const chatHistoryEl = document.getElementById('sc-chat-history');
        const typingIndicator = document.getElementById('sc-chat-typing');

        const question = inputField.value.trim();
        if (!question) return;

        // Блокировка ввода и очистка поля
        inputField.value = '';
        inputField.style.height = '18px'; // Возврат стандартной высоты
        inputField.disabled = true;
        sendBtn.disabled = true;
        isChatLoading = true;

        // Рендерим сообщение пользователя в UI чата
        const userMsgEl = createElm(`<div class="sc-ai-chat-message user">${question}</div>`);
        chatHistoryEl.appendChild(userMsgEl);
        scrollChatToBottom();

        // Показываем индикатор печатания ИИ
        typingIndicator.style.display = 'flex';
        scrollChatToBottom();

        try {
            // Подгружаем свежую историю для контекста
            const history = await loadCurrentChannelHistory();
            if (!history) throw new Error('Не удалось получить свежую историю сообщений.');

            const chatLog = formatMessages(history.messages);
            const systemInstruction = getSystemInstruction(history.messages);

            // Добавляем реплику пользователя в локальный стек диалога
            copilotChatHistory.push({
                role: 'user',
                parts: [{ text: question }]
            });

            // Отправляем запрос на Gemini API
            const aiResponseText = await requestGeminiAPI(apiKey, chatLog, systemInstruction, question, false);

            // Добавляем ответ ИИ в локальный стек диалога
            copilotChatHistory.push({
                role: 'model',
                parts: [{ text: aiResponseText }]
            });

            // Убираем индикатор печатания
            typingIndicator.style.display = 'none';

            // Рендерим ответ ИИ в чате с поддержкой форматирования Markdown
            const formattedHtml = formatMarkdown(aiResponseText);
            const aiMsgEl = createElm(`<div class="sc-ai-chat-message ai">${formattedHtml}</div>`);
            chatHistoryEl.appendChild(aiMsgEl);

        } catch (err) {
            console.error('[Social Copilot] Ошибка чата:', err);
            typingIndicator.style.display = 'none';
            
            const errorMsgEl = createElm(`
                <div class="sc-ai-chat-message ai" style="border-color: rgba(239, 68, 68, 0.2); color: #fca5a5;">
                    Упс, произошла ошибка при получении ответа от ИИ: ${err.message || 'Неизвестная ошибка'}. Пожалуйста, попробуйте отправить запрос еще раз.
                </div>
            `);
            chatHistoryEl.appendChild(errorMsgEl);
        } finally {
            // Разблокировка ввода
            inputField.disabled = false;
            sendBtn.disabled = false;
            isChatLoading = false;
            inputField.focus();
            scrollChatToBottom();
        }
    }
    // -----------------------------------------------------------------

    // Точка входа в скрипт
    function init() {
        console.log('[Social Copilot v2.0] Инициализация скрипта...');
        initStyles();
        createPanel();
        initDOMObserver();
        fetchMyUserId();
    }

    // Запуск инициализации при готовности DOM
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 1500);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
    }

})();

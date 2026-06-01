// ==UserScript==
// @name          Discord Mass Deleter
// @description   Премиальный редизайн, оптимизация и полный перевод на русский v2.1 популярного англоязычного скрипта удаления сообщений (на базе Undiscord от victornpb). Добавлены симуляция (Dry Run), закрепленный футер, устранены утечки памяти и лаги. Автор редизайна и перевода: Lukider.
// @namespace     https://github.com/lukider/deletediscordmessages
// @version       2.1
// @match         https://discord.com/*
// @grant         none
// @license       MIT
// ==/UserScript==

/**
 * Удалить все сообщения в канале Discord или ЛС
 * @param {string} authToken Ваш токен авторизации
 * @param {string} authorId Автор сообщений, которые вы хотите удалить
 * @param {string} guildId Сервер, где находятся сообщения
 * @param {string} channelId Канал, где находятся сообщения
 * @param {string} minId Удалять сообщения только после этого, оставьте пустым для удаления всех
 * @param {string} maxId Удалять сообщения только до этого, оставьте пустым для удаления всех
 * @param {string} content Фильтровать сообщения, содержащие этот текст
 * @param {boolean} hasLink Фильтровать сообщения, содержащие ссылку
 * @param {boolean} hasFile Фильтровать сообщения, содержащие файл
 * @param {boolean} includeNsfw Искать в NSFW каналах
 * @param {function(string, Array)} extLogger Функция для логирования
 * @param {function} stopHndl Функция для остановки
 * @see https://github.com/lukider/deletediscordmessages
 */
async function deleteMessages(authToken, authorId, guildId, channelId, minId, maxId, content, hasLink, hasFile, includeNsfw, includePinned, dryRun, extLogger, stopHndl, onProgress) {
    const start = new Date();
    const ArchivedThreads = new Set();
    let deleteDefault = Math.floor(Math.random() * (2000 - 1000 + 1) + 1000);
    let deleteDelay = deleteDefault;
    let randomizeDelay = true;
    let searchDelay = Math.floor(Math.random() * (2000 - 1000 + 1) + 1000);
    let delCount = 0;
    let archivedSkipCount = 0;
    let failCount = 0;
    let avgPing;
    let lastPing;
    let grandTotal;
    let throttledCount = 0;
    let throttledTotalTime = 0;
    let offset = 0;
    let iterations = -1;
    let ended = false;
    let failInRow = 0;
    let successInRow = 0;

    const wait = async ms => new Promise(done => setTimeout(done, ms));
    const msToHMS = s => `${s / 3.6e6 | 0}ч ${(s % 3.6e6) / 6e4 | 0}м ${(s % 6e4) / 1000 | 0}с`;
    const escapeHTML = html => html.replace(/[&<"']/g, m => ({'&': '&amp;', '<': '&lt;', '"': '&quot;', '\'': '&#039;'})[m]);
    const redact = str => `<span class="priv">${escapeHTML(str)}</span><span class="mask">СКРЫТО</span>`;
    const queryString = params => params.filter(p => p[1] !== undefined).map(p => p[0] + '=' + encodeURIComponent(p[1])).join('&');
    const ask = async msg => new Promise(resolve => setTimeout(() => resolve(window.confirm(msg)), 10));
    const printDelayStats = () => log.verb(`Задержка удаления: ${deleteDelay}мс, Задержка поиска: ${searchDelay}мс`, `Последний пинг: ${lastPing}мс, Средний пинг: ${avgPing | 0}мс`);
    const toSnowflake = (date) => /:/.test(date) ? ((new Date(date).getTime() - 1420070400000) * Math.pow(2, 22)) : date;
    const formatAttachments = (attachments) => {
        if (!attachments || attachments.length === 0) return '';
        return attachments.map(att => {
            const sizeMB = att.size ? ` (${(att.size / (1024 * 1024)).toFixed(1)} МБ)` : '';
            return ` <span style="color:#b39ddb;">[📎 ${redact(att.filename)}${sizeMB}]</span>`;
        }).join(' ');
    };

    const log = {
        debug() {extLogger ? extLogger('debug', arguments) : console.debug.apply(console, arguments);},
        info() {extLogger ? extLogger('info', arguments) : console.info.apply(console, arguments);},
        verb() {extLogger ? extLogger('verb', arguments) : console.log.apply(console, arguments);},
        warn() {extLogger ? extLogger('warn', arguments) : console.warn.apply(console, arguments);},
        error() {extLogger ? extLogger('error', arguments) : console.error.apply(console, arguments);},
        success() {extLogger ? extLogger('success', arguments) : console.info.apply(console, arguments);},
    };

    async function recurse() {
        let API_SEARCH_URL;
        if (guildId === '@me') {
            API_SEARCH_URL = `https://discord.com/api/v6/channels/${channelId}/messages/`; // DMs
        }
        else {
            API_SEARCH_URL = `https://discord.com/api/v6/guilds/${guildId}/messages/`; // Server
        }

        const headers = {
            'Authorization': authToken
        };

        let resp;
        try {
            const s = Date.now();
            resp = await fetch(API_SEARCH_URL + 'search?' + queryString([
                ['author_id', authorId || undefined],
                ['channel_id', (guildId !== '@me' ? channelId : undefined) || undefined],
                                                                        ['min_id', minId ? toSnowflake(minId) : undefined],
                                                                        ['max_id', maxId ? toSnowflake(maxId) : undefined],
                                                                        ['sort_by', 'timestamp'],
                                                                        ['sort_order', 'desc'],
                                                                        ['offset', offset],
                                                                        ['has', hasLink ? 'link' : undefined],
                                                                        ['has', hasFile ? 'file' : undefined],
                                                                        ['content', content || undefined],
                                                                        ['include_nsfw', includeNsfw ? true : undefined],
            ]), {headers});
            lastPing = (Date.now() - s);
            avgPing = avgPing > 0 ? (avgPing * 0.9) + (lastPing * 0.1) : lastPing;
        } catch (err) {
            return log.error('Ошибка поискового запроса:', err);
        }

        // Not indexed yet
        if (resp.status === 202) {
            const w = (await resp.json()).retry_after;
            throttledCount++;
            throttledTotalTime += w;
            log.warn(`Этот канал еще не проиндексирован, ожидание ${w}мс для индексации Discord...`);
            await wait(w);
            return await recurse();
        }

        if (!resp.ok) {
            // Searching messages too fast
            if (resp.status === 429) {
                const w = (await resp.json()).retry_after;
                throttledCount++;
                throttledTotalTime += w;
                searchDelay = w * 1.1; // set delay
                log.warn(`Discord просит подождать ${w}мс перед следующим поиском!`);
                printDelayStats();

                //this seems like a bug in the original script
                //await wait(w * 2);
                await wait(searchDelay);
                return await recurse();
            } else {
                return log.error(`Ошибка при поиске сообщений, API ответил со статусом ${resp.status}!\n`, await resp.json());
            }
        }

        const data = await resp.json();
        const total = data.total_results;
        if (!grandTotal) grandTotal = total;
        const discoveredMessages = data.messages.map(convo => convo.find(message => message.hit === true));
        // filter out system messages and optionally pinned ones
        let messagesToDelete = discoveredMessages.filter(msg => {
            return msg.type === 0 || msg.type === 6 || (msg.pinned && includePinned);
        });
        // skip message if in archived thread
        messagesToDelete = messagesToDelete.filter(msg => {
            if (ArchivedThreads.has(msg.channel_id)) {
                log.verb(`Пропуск сообщения в архивной ветке ${msg.channel_id}`);
                return false;
            }
            return true;
        });
        const skippedMessages = discoveredMessages.filter(msg => !messagesToDelete.find(m => m.id === msg.id));
        // count skipped messages as not deleted
        failCount += skippedMessages.length;
        const archivedCount = skippedMessages.filter(msg => ArchivedThreads.has(msg.channel_id)).length;
        const systemCount = skippedMessages.length - archivedCount;
        archivedSkipCount += archivedCount;
        // signal progress UI that undeletable messages were found
        if (skippedMessages.length > 0) {
            try {if (onProgress) onProgress(delCount, grandTotal || 1, true);} catch (e) { }
        }

        const end = () => {
            if (ended)
                return;
            log.success(`Завершено в ${new Date().toLocaleString()}! Общее время: ${msToHMS(Date.now() - start.getTime())}`);
            // unnecessary
            // printDelayStats();
            log.verb(`Ограничение скорости (Rate Limit): ${throttledCount} раз. Общее время ожидания: ${msToHMS(throttledTotalTime)}.`);
            log.debug(`Удалено ${delCount} сообщений, ${failCount} с ошибкой.\n`);
            ended = true;
        }

        const isRunComplete = () => (delCount + failCount) >= grandTotal;

        const deletableMessages = grandTotal - archivedSkipCount;
        const etr = msToHMS((searchDelay * Math.round(deletableMessages / 25)) + ((deleteDelay + avgPing) * deletableMessages));
        // systemCount already computed above when updating counters
        log.info(`Всего найдено сообщений: ${data.total_results}`,
                 `(Найдено: ${data.messages.length}, К удалению: ${messagesToDelete.length}, Пропущено: ${skippedMessages.length} (системных ${systemCount}))`,
                 `смещение: ${offset}`);
        printDelayStats();
        log.verb(`Примерное оставшееся время: ${etr}`)

        if (messagesToDelete.length > 0) {

            if (++iterations < 1) {
                log.verb(`Ожидание вашего подтверждения...`);
                const previewMessages = messagesToDelete; // [...messagesToDelete].reverse(); (use if you want the preview to match discords ui)
                const confirmMsg = dryRun 
                    ? `[ХОЛОСТОЙ ЗАПУСК] Вы хотите запустить симуляцию удаления ~${total} сообщений?\n\n---- Предпросмотр ----\n` + previewMessages.map(m => `${m.author.username}#${m.author.discriminator}: ${m.attachments.length ? '[ВЛОЖЕНИЯ]' : m.content}`).join('\n')
                    : `Вы хотите удалить ~${total} сообщений?\nПримерное время: ${etr}\n\n---- Предпросмотр ----\n` + previewMessages.map(m => `${m.author.username}#${m.author.discriminator}: ${m.attachments.length ? '[ВЛОЖЕНИЯ]' : m.content}`).join('\n');
                if (!await ask(confirmMsg))
                    return end(log.error('Отменено вами!'));
                log.verb(`OK`);
            }

            for (let i = 0; i < messagesToDelete.length; i++) {
                const message = messagesToDelete[i];
                // if already marked, skip
                if (ArchivedThreads.has(message.channel_id)) {
                    log.verb(`Пропуск сообщения в архивной ветке ${message.channel_id}`);
                    continue;
                }
                if (stopHndl && stopHndl() === false) return end(log.error('Остановлено вами!'));

                // Too big to read, too much information to be useful to end user
                // if you care about individual IDs being deleted or your username, there ya go:
                //log.debug(`${((delCount + 1) / grandTotal * 100).toFixed(2)}% (${delCount + 1}/${grandTotal})` + `Delete ID:${redact(message.id)} <b>${redact(message.author.username + '#' + message.author.discriminator)} <small>(${redact(new Date(message.timestamp).toLocaleString())})</small>:</b> <i>${redact(message.content).replace(/\n/g, '↵')}</i>`, message.attachments.length ? redact(JSON.stringify(message.attachments)) : '');
                const processed = delCount + failCount;
                const attsStr = formatAttachments(message.attachments);
                if (dryRun) {
                    log.debug(`${((processed + 1) / grandTotal * 100).toFixed(2)}% (${processed + 1}/${grandTotal})` + ` | <b style="color:#a855f7;">[ТЕСТ]</b> <small>(${redact(new Date(message.timestamp).toLocaleDateString() + " - " + new Date(message.timestamp).toLocaleTimeString())})</small>: ${redact(message.content).replace(/\n/g, '↵')}${attsStr ? ' ' + attsStr : ''}`);
                    delCount++;
                    try {if (onProgress) onProgress(delCount, grandTotal || 1);} catch (e) { }
                    if (i < messagesToDelete.length - 1) {
                        await wait(100);
                    }
                    continue;
                }

                log.debug(`${((processed + 1) / grandTotal * 100).toFixed(2)}% (${processed + 1}/${grandTotal})` + ` | <b>УДАЛ</b> <small>(${redact(new Date(message.timestamp).toLocaleDateString() + " - " + new Date(message.timestamp).toLocaleTimeString())})</small>: ${redact(message.content).replace(/\n/g, '↵')}${attsStr ? ' ' + attsStr : ''}`);

                let resp;
                try {
                    const s = Date.now();
                    const API_DELETE_URL = `https://discord.com/api/v6/channels/${message.channel_id}/messages/${message.id}`;
                    resp = await fetch(API_DELETE_URL, {
                        headers,
                        method: 'DELETE'
                    });
                    lastPing = (Date.now() - s);
                    avgPing = (avgPing * 0.9) + (lastPing * 0.1);
                } catch (err) {
                    log.error('Ошибка запроса на удаление:', err); // Too long to be read in the console
                    log.verb('Связанный объект:', redact(JSON.stringify(message))); // Too long to be read in the console
                    failCount++;
                    if (i < messagesToDelete.length - 1) {
                        await wait(deleteDelay);
                    }
                    continue;
                }

                if (!resp.ok) {
                    // failed
                    let err;
                    try {err = await resp.json();} catch {err = null;}

                    failInRow++;
                    successInRow = 0;
                    randomizeDelay = false;

                    // Thread archived or can't be opened due to missing permissions or rate limits (Program can't discern between the two)
                    if ((resp.status === 400 && err?.code === 50083) ||
                        (resp.status === 403 && err?.message && /archiv/i.test(err.message)) ||
                        (resp.status === 404 && err?.message && /archiv/i.test(err.message))) {
                        log.warn(`Обнаружена архивная ветка (статус ${resp.status}${err?.code ? ', код ' + err.code : ''}), помечаем канал ${message.channel_id} как архивный`);
                    ArchivedThreads.add(message.channel_id);
                    continue;
                        }

                        // deleting messages too fast
                        else if (resp.status === 429) {
                            const w = err?.retry_after;
                            log.warn(`Не удалось удалить - Discord просит подождать ${w}мс!`);

                            throttledCount++;
                            throttledTotalTime += w;

                            var multi = 1.632;
                            //increase delay if deleteDelay is less
                            if (w * 1.532 > deleteDelay)
                                deleteDelay = w * multi;
                            else {
                                // we would get caught in a loop
                                deleteDelay = deleteDelay * 0.94812;
                                if (deleteDelay < w)
                                    deleteDelay = w * multi;
                                log.warn("Задержка удаления уже больше времени ожидания. Уменьшаем.");
                            }

                            printDelayStats();

                            await wait(deleteDelay);
                            i--; // retry
                        }
                        //nonspecific error handler
                        else {
                            log.error(`Ошибка удаления сообщения, API ответил со статусом ${resp.status}!`, err);
                            log.verb('Связанный объект:', redact(JSON.stringify(message)));
                            failCount++;
                        }
                }
                else {
                    // success
                    failInRow = 0;
                    successInRow++;
                    delCount++;
                    // update progress after a successful delete
                    try {if (onProgress) onProgress(delCount, grandTotal || 1);} catch (e) { }
                    if (randomizeDelay) {
                        deleteDefault = Math.floor(Math.random() * (2000 - 1000 + 1) + 1000);
                        deleteDelay = deleteDefault;
                    }
                    // make sure we eventually speed back up
                    if (successInRow > 4 && deleteDelay > deleteDefault && !randomizeDelay) {
                        deleteDelay = deleteDelay * 0.94812;
                        log.verb(`Снижение задержки до ${deleteDelay}мс`);
                    }
                    else if (deleteDelay < deleteDefault) {
                        deleteDefault = Math.floor(Math.random() * (2000 - 1000 + 1) + 1000);
                        deleteDelay = deleteDefault;
                        randomizeDelay = true;
                        log.verb(`Задержка по умолчанию, ${deleteDefault}.`);
                    }
                }

                if (i < messagesToDelete.length - 1) {
                    await wait(deleteDelay);
                }
            }

            if (skippedMessages.length > 0) {
                /*grandTotal -= skippedMessages.length;*/
                offset += skippedMessages.length;
                log.verb(`Найдены ${skippedMessages.length} системных сообщений! Увеличиваем смещение до ${offset}.`);
            }

            if (isRunComplete()) {
                return end();
            }

            log.verb(`Поиск следующих сообщений через ${searchDelay}мс...`, (offset ? `(смещение: ${offset})` : ''));

            deleteDefault = Math.floor(Math.random() * (2000 - 1000 + 1) + 1000);
            deleteDelay = deleteDefault;
            searchDelay = Math.floor(Math.random() * (2000 - 1000 + 1) + 1000);
            // Turn back on randomize since we are searching next page anyway
            randomizeDelay = true;

            await wait(searchDelay);
            logArea.innerHTML = '';

            if (stopHndl && stopHndl() === false) return end(log.error('Отменено вами!'));

            return await recurse();
        } else {
            // Nothing on this page could be deleted (either system or archived)
            if (skippedMessages.length > 0) {
                const archivedCount = skippedMessages.filter(msg => ArchivedThreads.has(msg.channel_id)).length;
                const systemCount = skippedMessages.length - archivedCount;
                log.verb(`На этой странице нет сообщений для удаления (${systemCount} системных, ${archivedCount} архивных). Продвигаем смещение на ${skippedMessages.length}.`);
                offset += skippedMessages.length;
                if (isRunComplete()) {
                    return end();
                }
                if (offset >= total) {
                    return end();
                }
                log.verb(`Поиск следующих сообщений через ${searchDelay}мс...`, `(смещение: ${offset})`);
                await wait(searchDelay);
                return await recurse();
            }
            if (total - offset > 0) {
                log.warn('API вернул пустую страницу. Ищем на следующей.');
                offset += 25;
                log.verb(`Поиск следующих сообщений через ${searchDelay}мс...`, `(смещение: ${offset})`);
                await wait(searchDelay);
                await recurse();
                return end();
            } else {
                log.warn("(Total - offset) < 0, завершение.");
                return end();
            }
        }
    }

    log.success(`\nНачато в ${start.toLocaleString()}`);
    log.debug(`authorId="${redact(authorId)}" guildId="${redact(guildId)}" channelId="${redact(channelId)}" minId="${redact(minId)}" maxId="${redact(maxId)}" hasLink=${!!hasLink} hasFile=${!!hasFile}`);
    ended = false;
    try {if (onProgress) onProgress(0, 1);} catch (e) { }
    return await recurse();
}

//---- User interface ----//

let popover;
let btn;
let stop;
let logArea;
let version = "2.1";

function initUI() {

    const insertCss = (css) => {
        const style = document.createElement('style');
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
        return style;
    }

    const createElm = (html) => {
        const temp = document.createElement('div');
        temp.innerHTML = html.trim();
        return temp.removeChild(temp.firstElementChild);
    }

    insertCss(`
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');

    /* Разрешить выделение текста во всей боковой панели */
    #undiscord, #undiscord * {
        user-select: text !important;
        -webkit-user-select: text !important;
    }

    /* Выделение поля ID Автора */
    #undiscord #authorId {
        border-color: rgba(139, 92, 246, 0.35) !important;
        background: rgba(139, 92, 246, 0.04) !important;
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2) !important;
    }
    #undiscord #authorId:focus {
        border-color: #8b5cf6 !important;
        box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.25) !important;
    }

    /* Кнопка в тулбаре Discord */
    #undicord-btn {
        position: relative;
        height: 24px;
        width: auto;
        margin: 0 8px;
        cursor: pointer;
        color: var(--interactive-normal);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: color 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #undicord-btn:hover {
        color: #f43f5e;
        transform: scale(1.1) rotate(15deg);
    }
    #undicord-btn.active {
        color: #f43f5e;
    }

    /* Основная боковая стеклянная панель */
    #undiscord {
        font-family: 'Outfit', 'Inter', 'Whitney', sans-serif;
        position: fixed;
        top: 0;
        right: -500px;
        height: 100vh;
        width: 500px;
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
    #undiscord.open {
        right: 0;
    }

    /* Неоновые фоновые сферы */
    .md-glow-rose {
        position: absolute;
        top: -80px;
        right: -80px;
        width: 250px;
        height: 250px;
        background: radial-gradient(circle, rgba(244, 63, 94, 0.16) 0%, rgba(99, 102, 241, 0) 70%);
        filter: blur(40px);
        pointer-events: none;
        z-index: -1;
    }
    .md-glow-violet {
        position: absolute;
        bottom: -80px;
        left: -80px;
        width: 250px;
        height: 250px;
        background: radial-gradient(circle, rgba(139, 92, 246, 0.12) 0%, rgba(99, 102, 241, 0) 70%);
        filter: blur(40px);
        pointer-events: none;
        z-index: -1;
    }

    /* Шапка */
    .md-header {
        padding: 20px 24px;
        background: rgba(30, 31, 34, 0.3);
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .md-title {
        font-size: 17px;
        font-weight: 700;
        background: linear-gradient(135deg, #f43f5e 0%, #8b5cf6 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .md-close {
        cursor: pointer;
        color: #64748b;
        transition: color 0.2s, transform 0.2s;
    }
    .md-close:hover {
        color: #fff;
        transform: scale(1.1) rotate(90deg);
    }

    /* Навигация (Вкладки) */
    .md-tabs {
        display: flex;
        padding: 10px 16px;
        background: rgba(22, 24, 28, 0.15);
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        gap: 6px;
    }
    .md-tab {
        flex: 1;
        padding: 8px 2px;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        cursor: pointer;
        color: #94a3b8;
        border-radius: 6px;
        transition: background 0.25s cubic-bezier(0.16, 1, 0.3, 1), color 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .md-tab:hover {
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
    }
    .md-tab.active {
        background: rgba(244, 63, 94, 0.12);
        color: #fca5a5;
        box-shadow: inset 0 0 10px rgba(244, 63, 94, 0.03);
    }

    /* Содержимое вкладок */
    .md-content {
        flex-grow: 1;
        padding: 20px;
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: hidden; /* Individual sections handle their own inner scroll */
    }

    .md-section {
        display: none;
        flex-direction: column;
        gap: 16px;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
        overflow: hidden;
        animation: mdFadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .md-section.active {
        display: flex;
    }

    #md-tab-params {
        display: none;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }
    #md-tab-params.active {
        display: flex;
    }
    .md-params-scroll-area {
        flex-grow: 1;
        overflow-y: auto;
        padding-right: 4px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .md-params-scroll-area::-webkit-scrollbar {
        width: 4px;
    }
    .md-params-scroll-area::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.08);
        border-radius: 2px;
    }
    .md-params-footer {
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: transparent;
        flex-shrink: 0;
    }

    #md-tab-help {
        overflow-y: auto;
        padding-right: 4px;
    }
    #md-tab-help::-webkit-scrollbar {
        width: 4px;
    }
    #md-tab-help::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.08);
        border-radius: 2px;
    }

    #md-tab-log {
        overflow: hidden;
    }
    .md-section#md-tab-log.active {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        height: 100%;
    }

    @keyframes mdFadeInUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
    }

    /* Карточки-контейнеры */
    .md-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        transition: border-color 0.3s, transform 0.3s;
        position: relative;
    }
    .md-card:hover {
        border-color: rgba(244, 63, 94, 0.2);
        transform: translateY(-1px);
    }
    .md-card-title {
        font-size: 11px;
        font-weight: 700;
        color: #fca5a5;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 12px;
    }

    /* Формы и поля */
    .md-form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .md-label {
        font-size: 10px;
        font-weight: 600;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .md-input {
        background: #1e1f22 !important;
        color: #f1f5f9 !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 6px !important;
        padding: 8px 12px !important;
        font-size: 13px !important;
        height: auto !important;
        width: 100% !important;
        box-sizing: border-box !important;
        transition: border-color 0.2s, box-shadow 0.2s !important;
    }
    .md-input:focus {
        outline: none !important;
        border-color: #f43f5e !important;
        box-shadow: 0 0 0 2px rgba(244, 63, 94, 0.15) !important;
    }
    
    .md-input-with-button {
        display: flex;
        gap: 8px;
    }
    .md-input-with-button input {
        flex-grow: 1;
    }
    .md-input-row {
        display: flex;
        gap: 8px;
    }
    .md-input-row input {
        flex: 1;
        min-width: 0;
    }

    /* Кнопки */
    .md-mini-btn {
        background: rgba(244, 63, 94, 0.1) !important;
        border: 1px solid rgba(244, 63, 94, 0.2) !important;
        color: #fca5a5 !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 6px 12px !important;
        border-radius: 6px !important;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
    }
    .md-mini-btn:hover {
        background: rgba(244, 63, 94, 0.2) !important;
        border-color: rgba(244, 63, 94, 0.4) !important;
        color: #fff !important;
    }
    .md-mini-btn:active {
        transform: scale(0.95);
    }

    .md-action-btn {
        display: block;
        width: 100%;
        color: #fff !important;
        font-weight: 600 !important;
        border: 0 !important;
        border-radius: 8px !important;
        padding: 12px !important;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
        font-size: 13px !important;
        box-sizing: border-box;
    }
    .md-action-btn:disabled {
        background: #334155 !important;
        box-shadow: none !important;
        cursor: not-allowed !important;
        opacity: 0.5 !important;
        display: none; /* keep the old hide-when-disabled behaviour where it is expected, or keep visible */
    }
    #undiscord button:disabled {
        display: none !important;
    }
    .md-action-btn.primary {
        background: linear-gradient(135deg, #f43f5e 0%, #8b5cf6 100%) !important;
        box-shadow: 0 4px 12px rgba(244, 63, 94, 0.2);
    }
    .md-action-btn.primary:hover:not(:disabled) {
        opacity: 0.95;
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(244, 63, 94, 0.3);
    }
    .md-action-btn.danger {
        background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%) !important;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
    }
    .md-action-btn.danger:hover:not(:disabled) {
        opacity: 0.95;
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(239, 68, 68, 0.3);
    }
    .md-action-btn.secondary {
        background: rgba(255, 255, 255, 0.05) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .md-action-btn.secondary:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08) !important;
        border-color: rgba(255, 255, 255, 0.12) !important;
        transform: translateY(-1px);
    }
    .md-action-btn:active:not(:disabled) {
        transform: translateY(1px) !important;
    }

    /* Чекбоксы */
    .md-checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-size: 12px;
        color: #cbd5e1;
        user-select: none;
    }
    .md-checkbox-label input[type="checkbox"] {
        accent-color: #f43f5e;
        width: 15px;
        height: 15px;
        cursor: pointer;
    }
    .md-checkbox-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }

    /* Импорт файла */
    .md-file-btn {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: #cbd5e1;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    }
    .md-file-btn:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.12);
        color: #fff;
    }

    /* Прогресс-бар */
    .md-progress-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }
    .md-progress-title {
        font-size: 12px;
        font-weight: 600;
        color: #94a3b8;
    }
    .md-progress-percent-val {
        font-size: 14px;
        font-weight: 700;
        color: #fca5a5;
    }
    #undiscord progress {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
        accent-color: #818cf8;
        transition: accent-color 0.3s ease;
    }
    #undiscord progress::-webkit-progress-bar {
        background: transparent;
    }
    #undiscord progress::-webkit-progress-value {
        background: linear-gradient(90deg, #f43f5e 0%, #8b5cf6 100%);
        border-radius: 4px;
        box-shadow: 0 0 10px rgba(244, 63, 94, 0.5);
    }
    .md-progress-sub {
        font-size: 10px;
        color: #64748b;
        margin-top: 6px;
        line-height: 1.4;
    }
    
    #undicord-btn progress {
        -webkit-appearance: none;
        appearance: none;
        width: 24px;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
    }
    #undicord-btn progress::-webkit-progress-value {
        background: #f43f5e;
    }

    /* Управление в логах */
    .md-log-controls {
        display: flex;
        gap: 10px;
        margin-top: 10px;
    }
    .md-log-controls button {
        flex: 1;
    }
    
    #undiscord .logarea {
        overflow-y: auto;
        font-size: 12.5px;
        font-family: 'Consolas', 'Courier New', monospace;
        flex-grow: 1;
        padding: 12px;
        margin-top: 16px;
        background: rgba(10, 12, 16, 0.6);
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        color: #f1f5f9;
        scrollbar-width: thin;
        line-height: 1.55;
        word-break: break-word;
        white-space: pre-wrap;
    }
    #undiscord .logarea::-webkit-scrollbar {
        width: 4px;
    }
    #undiscord .logarea::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.12);
        border-radius: 2px;
    }
    .md-log-placeholder {
        color: #475569;
        text-align: center;
        margin-top: 40px;
        font-style: italic;
    }

    /* Скрытие секретной информации */
    #undiscord.redact .priv { display: none !important; }
    #undiscord:not(.redact) .mask { display: none !important; }
    #undiscord.redact [priv] { -webkit-text-security: disc !important; }

    /* Справка */
    .md-help-p {
        font-size: 12px;
        line-height: 1.55;
        color: #cbd5e1;
        margin: 8px 0;
    }
    .md-help-link {
        display: inline-block;
        margin-top: 8px;
        font-size: 11px;
        font-weight: 600;
        color: #fca5a5;
        text-decoration: none;
        transition: color 0.2s;
    }
    .md-help-link:hover {
        color: #fff;
        text-decoration: underline;
    }
    `);

    popover = createElm(`
    <div id="undiscord">
        <div class="md-glow-rose"></div>
        <div class="md-glow-violet"></div>
        
        <div class="md-header">
            <div class="md-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;">
                    <path d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15Z" fill="currentColor"></path>
                    <path d="M5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z" fill="currentColor"></path>
                </svg>
                Массовое удаление v${version}
            </div>
            <div class="md-close" id="md-close-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
        </div>
        
        <div class="md-tabs">
            <div class="md-tab active" data-tab="params">Параметры</div>
            <div class="md-tab" data-tab="log">Лог работы</div>
            <div class="md-tab" data-tab="help">Справка</div>
        </div>
        
        <div class="md-content">
            <!-- TAB 1: PARAMETERS -->
            <div class="md-section active" id="md-tab-params">
                <div class="md-params-scroll-area">
                    <!-- Card 1: Authorization -->
                    <div class="md-card">
                        <div class="md-card-title">Авторизация</div>
                        <div class="md-form-group">
                            <label class="md-label">Токен авторизации</label>
                            <div class="md-input-with-button">
                                <input type="password" id="authToken" placeholder="Токен авторизации" autocomplete="off" class="md-input" priv>
                                <button class="md-mini-btn" id="getToken">получить</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Card 2: Server & Channel -->
                    <div class="md-card">
                        <div class="md-card-title">Место поиска</div>
                        <div class="md-form-group">
                            <label class="md-label" style="color: #a78bfa; display: flex; align-items: center; gap: 6px;">
                                ID Автора сообщений
                                <span style="font-size: 8px; background: rgba(139, 92, 246, 0.2); color: #c084fc; padding: 1px 5px; border-radius: 4px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Важно</span>
                            </label>
                            <input id="authorId" type="text" placeholder="ID Пользователя (оставьте пустым для удаления всех)" class="md-input" priv>
                        </div>
                        <div class="md-form-group" style="margin-top: 10px;">
                            <label class="md-label">Сервер / Канал</label>
                            <div class="md-input-with-button">
                                <input id="guildId" type="text" placeholder="ID Сервера" class="md-input" priv>
                                <input id="channelId" type="text" placeholder="ID Канала(ов)" class="md-input" priv>
                                <button class="md-mini-btn" id="getGuildAndChannel">получить</button>
                            </div>
                        </div>
                        <div class="md-form-group" style="margin-top: 10px; display: flex; align-items: center; justify-content: space-between;">
                            <label class="md-checkbox-label">
                                <input id="includeNsfw" type="checkbox">
                                <span>NSFW Канал</span>
                            </label>
                            <label class="md-file-btn" for="file">
                                Импорт каналов
                                <input id="file" type="file" accept="application/json,.json" style="display:none;">
                            </label>
                        </div>
                    </div>
                    
                    <!-- Card 3: Date / Range -->
                    <div class="md-card">
                        <div class="md-card-title">Диапазон сообщений</div>
                        <div class="md-form-group">
                            <label class="md-label">Временной интервал</label>
                            <div class="md-input-row">
                                <input id="minDate" type="datetime-local" title="После" class="md-input">
                                <input id="maxDate" type="datetime-local" title="До" class="md-input">
                            </div>
                        </div>
                        <div class="md-form-group" style="margin-top: 10px;">
                            <label class="md-label">ID сообщений (Snowflake)</label>
                            <div class="md-input-row">
                                <input id="minId" type="text" placeholder="После ID" class="md-input" priv>
                                <input id="maxId" type="text" placeholder="До ID" class="md-input" priv>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Card 4: Search Filters -->
                    <div class="md-card">
                        <div class="md-card-title">Поиск и фильтры</div>
                        <div class="md-form-group">
                            <label class="md-label">Содержимое</label>
                            <input id="content" type="text" placeholder="Текст сообщения" class="md-input" priv>
                        </div>
                        <div class="md-checkbox-grid" style="margin-top: 10px;">
                            <label class="md-checkbox-label">
                                <input id="hasLink" type="checkbox">
                                <span>Содержит ссылку</span>
                            </label>
                            <label class="md-checkbox-label">
                                <input id="hasFile" type="checkbox">
                                <span>Содержит файл</span>
                            </label>
                            <label class="md-checkbox-label">
                                <input id="includePinned" type="checkbox">
                                <span>Закрепленные</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="md-params-footer">
                    <!-- Launch options -->
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <label class="md-checkbox-label" title="Только сканирование сообщений без их фактического удаления">
                            <input id="dryRun" type="checkbox">
                            <span style="font-weight: 500; color: #cbd5e1;">Холостой запуск (симуляция)</span>
                        </label>
                    </div>
                    
                    <!-- Start button -->
                    <div style="margin-bottom: 8px;">
                        <button class="md-action-btn primary" id="start">Запустить удаление</button>
                    </div>
                </div>
            </div>
            
            <!-- TAB 2: WORK LOG & PROGRESS -->
            <div class="md-section" id="md-tab-log">
                <!-- Progress Bar Card -->
                <div class="md-card" style="padding: 14px;">
                    <div class="md-progress-header">
                        <span class="md-progress-title">Прогресс удаления</span>
                        <span class="md-progress-percent-val percent">0%</span>
                    </div>
                    <progress id="progress" style="display:none;"></progress>
                    <div class="md-progress-sub">
                        Удалено сообщений. Системные и архивные пропускаются автоматически.
                    </div>
                </div>
                
                <!-- Control Actions -->
                <div class="md-log-controls">
                    <button class="md-action-btn danger" id="stop" disabled>Стоп</button>
                    <button class="md-action-btn secondary" id="clear">Очистить лог</button>
                </div>
                
                <!-- Extra Options -->
                <div class="md-card md-log-options" style="padding: 10px 14px; margin-top: 10px; display: flex; flex-direction: row; gap: 16px; justify-content: space-between;">
                    <label class="md-checkbox-label">
                        <input id="autoScroll" type="checkbox" checked>
                        <span>Автопрокрутка</span>
                    </label>
                    <label class="md-checkbox-label" title="Скрыть конфиденциальную информацию для скриншотов">
                        <input id="redact" type="checkbox">
                        <span>Режим скриншота</span>
                    </label>
                </div>
                
                <!-- Log Area (Directly, no wrapper or header!) -->
                <pre class="logarea"><div class="md-log-placeholder">Готов к работе. Улучшено Lukider 🌹</div></pre>
            </div>
            
            <!-- TAB 3: HELP -->
            <div class="md-section" id="md-tab-help">
                <div class="md-card">
                    <div class="md-card-title">Как получить токен авторизации?</div>
                    <p class="md-help-p">Токен авторизации необходим скрипту для выполнения запросов от вашего имени.</p>
                    <p class="md-help-p">1. Нажмите кнопку <strong>«получить»</strong> в блоке авторизации.</p>
                    <p class="md-help-p">2. Токен автоматически извлечется из локального хранилища Discord и подставится в поле.</p>
                    <a href="https://github.com/victornpb/deleteDiscordMessages/blob/master/help/authToken.md" target="_blank" class="md-help-link">Подробная инструкция по токену ↗</a>
                </div>
                
                <div class="md-card" style="margin-top: 14px;">
                    <div class="md-card-title">Как получить ID автора и канала?</div>
                    <p class="md-help-p">Вы можете легко получить ID текущего открытого канала и сервера:</p>
                    <p class="md-help-p">1. Перейдите в нужный канал или ЛС в Discord.</p>
                    <p class="md-help-p">2. Нажмите кнопку <strong>«получить»</strong> в блоке сервера/канала или ID автора.</p>
                    <p class="md-help-p">3. Скрипт проанализирует контекст Discord и автоматически заполнит поля.</p>
                    <a href="https://github.com/victornpb/deleteDiscordMessages/blob/master/help/channelId.md" target="_blank" class="md-help-link">Справка по извлечению ID ↗</a>
                </div>
                
                <div class="md-card" style="margin-top: 14px;">
                    <div class="md-card-title">Фильтры и поиск</div>
                    <p class="md-help-p">Вы можете тонко настраивать удаление сообщений:</p>
                    <p class="md-help-p">- <strong>Содержит текст</strong>: удалит только сообщения с конкретной фразой.</p>
                    <p class="md-help-p">- <strong>Диапазон времени</strong>: удалит сообщения за выбранный промежуток.</p>
                    <a href="https://github.com/victornpb/deleteDiscordMessages/blob/master/help/filters.md" target="_blank" class="md-help-link">Справка по фильтрам поиска ↗</a>
                </div>
            </div>
        </div>
    </div>
    `);

    document.body.appendChild(popover);

    btn = createElm(`<div id="undicord-btn" tabindex="0" role="button" aria-label="Удалить Сообщения" title="Удалить Сообщения">
    <svg aria-hidden="false" width="24" height="24" viewBox="0 0 24 24" style="display: block; margin: 0 auto;">
    <path fill="currentColor" d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15Z"></path>
    <path fill="currentColor" d="M5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z"></path>
    </svg>
    <progress style="display:none; width:24px; margin-top:2px;"></progress>
    </div>`);

    btn.onclick = function togglePopover() {
        if (popover.classList.contains('open')) {
            popover.classList.remove('open');
            btn.style.color = 'var(--interactive-normal)';
            btn.classList.remove('active');
        }
        else {
            popover.classList.add('open');
            btn.style.color = '#f43f5e';
            btn.classList.add('active');

            // Получаем ID гильдии и канала при открытии
            const m = location.href.match(/channels\/([\w@]+)\/(\d+)/);
            if (m) {
                $('input#guildId').value = m[1];
                $('input#channelId').value = m[2];
            }

            // Получаем токен только если поле пустое, чтобы избежать лишних зависаний
            if (!$('input#authToken').value.trim()) {
                try {
                    window.dispatchEvent(new Event('beforeunload'));
                    const iframe = document.createElement('iframe');
                    document.body.appendChild(iframe);
                    const tokenVal = iframe.contentWindow.localStorage.token;
                    if (tokenVal) {
                        $('input#authToken').value = JSON.parse(tokenVal);
                    }
                    iframe.remove();
                } catch (e) {
                    console.error("Не удалось получить токен автоматически:", e);
                }
            }
        };
    }

    function mountBtn() {
        const toolbar = document.querySelector('[class*="toolbar"]');
        if (toolbar)
            toolbar.appendChild(btn);
    }

    // Вместо тяжелого MutationObserver на весь document.body используем легкий setInterval.
    // Это исключает лаги и просадки FPS при любых изменениях интерфейса Discord.
    setInterval(() => {
        if (!document.body.contains(btn)) mountBtn();
    }, 1000);

    mountBtn();

        const $ = s => popover.querySelector(s);
        logArea = $('pre');
        const startBtn = $('button#start');
        const stopBtn = $('button#stop');
        const autoScroll = $('#autoScroll');

        // Обработка кнопки закрытия панели
        $('#md-close-btn').onclick = () => {
            popover.classList.remove('open');
            btn.style.color = 'var(--interactive-normal)';
            btn.classList.remove('active');
        };

        // Обработка переключения вкладок
        const tabs = popover.querySelectorAll('.md-tab');
        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const targetTab = tab.getAttribute('data-tab');
                popover.querySelectorAll('.md-section').forEach(sec => sec.classList.remove('active'));
                popover.querySelector(`#md-tab-${targetTab}`).classList.add('active');
            };
        });

        startBtn.onclick = async e => {
            const authToken = $('input#authToken').value.trim();
            const authorId = $('input#authorId').value.trim();
            const guildId = $('input#guildId').value.trim();
            const channelIds = $('input#channelId').value.trim().split(/\s*,\s*/);
            const minId = $('input#minId').value.trim();
            const maxId = $('input#maxId').value.trim();
            const minDate = $('input#minDate').value.trim();
            const maxDate = $('input#maxDate').value.trim();
            const content = $('input#content').value.trim();
            const hasLink = $('input#hasLink').checked;
            const hasFile = $('input#hasFile').checked;
            const includeNsfw = $('input#includeNsfw').checked;
            const includePinned = $('input#includePinned').checked;
            const dryRun = $('#dryRun') ? $('#dryRun').checked : false;
            const progress = $('#progress');
            const progress2 = btn.querySelector('progress');
            const percent = $('.percent');

            // Автоматическое переключение на вкладку Лог
            const logTab = popover.querySelector('.md-tab[data-tab="log"]');
            if (logTab) logTab.click();

            const fileSelection = $("input#file");
            fileSelection.addEventListener("change", () => {
                const files = fileSelection.files;
                const channelIdField = $('input#channelId');
                if (files.length > 0) {
                    const file = files[0];
                    file.text().then(text => {
                        let json = JSON.parse(text);
                        let channels = Object.keys(json);
                        channelIdField.value = channels.join(",");
                    });
                }
            }, false);

            const stopHndl = () => !(stop === true);

            let hasUndeletable = false;
            const onProg = (value, max, markUndeletable = false) => {
                if (markUndeletable) hasUndeletable = true;
                if (value && max && value > max) max = value;
                progress.setAttribute('max', max);
                progress.value = value;
                // always keep the progress visible so the final red/green state can be seen
                progress.style.display = '';
                progress2.setAttribute('max', max);
                progress2.value = value;
                progress2.style.display = '';
                // show percentage even when value is 0 (0 is falsy), but only when both numbers are provided
                if (typeof value === 'number' && typeof max === 'number' && max > 0) {
                    percent.innerHTML = Math.round(value / max * 100) + '%';
                }

                // blue by default, red if any undeletable was seen, green only when fully complete with no undeletables
                if (hasUndeletable) {
                    progress.style.accentColor = '#f04747';  // red
                    progress2.style.accentColor = '#f04747';
                } else if (max && value >= max) {
                    // all deleted - show green
                    progress.style.accentColor = '#43b581';  // green
                    progress2.style.accentColor = '#43b581';
                } else if (max) {
                    // pending/in-progress with no undeletables
                    progress.style.accentColor = '#5865f2';  // blue
                    progress2.style.accentColor = '#5865f2';
                } else {
                    // reset to default
                    progress.style.accentColor = '';
                    progress2.style.accentColor = '';
                }
            };


            stop = stopBtn.disabled = !(startBtn.disabled = true);
            // pre-reset progress bar so it starts blue immediately
            progress.setAttribute('max', 1);
            progress.value = 0;
            progress.style.accentColor = '#5865f2';
            progress2.setAttribute('max', 1);
            progress2.value = 0;
            progress2.style.accentColor = '#5865f2';
            percent.innerHTML = '0%';
            for (let i = 0; i < channelIds.length; i++) {
                await deleteMessages(authToken, authorId, guildId, channelIds[i], minId || minDate, maxId || maxDate, content, hasLink, hasFile, includeNsfw, includePinned, dryRun, logger, stopHndl, onProg);
                stop = stopBtn.disabled = !(startBtn.disabled = false);
            }
        };
        stopBtn.onclick = e => stop = stopBtn.disabled = !(startBtn.disabled = false);
        $('button#clear').onclick = e => {
            logArea.innerHTML = '';

            const progress = $('#progress');
            const progress2 = btn.querySelector('progress');
            const percent = $('.percent');

            progress.style.display = 'none';
            progress2.style.display = 'none';
            progress.removeAttribute('max');
            progress2.removeAttribute('max');
            progress.value = 0;
            progress2.value = 0;
            progress.style.accentColor = '';
            progress2.style.accentColor = '';
            percent.textContent = '';
        };
        $('button#getToken').onclick = e => {
            try {
                window.dispatchEvent(new Event('beforeunload'));
                const iframe = document.createElement('iframe');
                document.body.appendChild(iframe);
                const tokenVal = iframe.contentWindow.localStorage.token;
                if (tokenVal) {
                    $('input#authToken').value = JSON.parse(tokenVal);
                } else {
                    alert("Токен не найден в localStorage. Возможно, вам нужно ввести его вручную.");
                }
                iframe.remove();
            } catch (err) {
                console.error(err);
                alert("Не удалось извлечь токен автоматически. Пожалуйста, введите его вручную.");
            }
        };
        // button was removed as manual insertion is preferred
        $('button#getGuildAndChannel').onclick = e => {
            //TODO: function?
            const m = location.href.match(/channels\/([\w@]+)\/(\d+)/);
            $('input#guildId').value = m[1];
            $('input#channelId').value = m[2];
        };
        $('#redact').onchange = e => {
            popover.classList.toggle('redact') &&
            window.alert('Это попытается скрыть личную информацию, но убедитесь в этом перед тем, как делиться скриншотами.');
        };

        const logger = (type = '', args) => {
            const style = {'': '', info: 'color:#00b0f4;', verb: 'color:#72767d;', warn: 'color:#faa61a;', error: 'color:#f04747;', success: 'color:#43b581;'}[type];
            logArea.insertAdjacentHTML('beforeend', `<div style="${style}">${Array.from(args).map(o => typeof o === 'object' ? JSON.stringify(o, o instanceof Error && Object.getOwnPropertyNames(o)) : o).join('\t')}</div>`);
            if (autoScroll.checked) logArea.querySelector('div:last-child').scrollIntoView(false);
        };

            // fixLocalStorage
            window.localStorage = document.body.appendChild(document.createElement('iframe')).contentWindow.localStorage;

}

initUI();

// src/textUtils.ts

/**
 * Нормализует и очищает текст от комментариев и лишних пробелов
 * для упрощенного текстового сравнения кода.
 * Поддерживает удаление комментариев для разных языков.
 *
 * @param {string} text Исходный текст кода.
 * @param {string} languageId Идентификатор языка VS Code (e.g., 'css', 'javascript', 'html').
 * @returns {string} Очищенный и нормализованный текст.
 */
export function normalizeAndCleanText(text: string, languageId: string): string {
    let cleaned = text;

    // 1. Удаление комментариев в зависимости от языка
    // TODO: Расширить поддержку языков или использовать более надежные парсеры комментариев
    switch (languageId) {
        case 'css':
        case 'less':
        case 'scss':
        case 'javascript': // Удаляет и // и /* */
        case 'javascriptreact':
        case 'typescript':
        case 'typescriptreact':
        case 'jsonc': // JSON с комментариями
            cleaned = cleaned.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
            break;
        case 'json': // Стандартный JSON не поддерживает комментарии, но на всякий случай удалим /* */
            cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
            break;
        case 'html':
        case 'xml':
        case 'vue': // Vue <template> использует HTML-комментарии
            cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
            // TODO: Рассмотреть удаление комментариев из <script> и <style> в .vue файлах отдельно
            break;
        case 'python':
        case 'ruby':
        case 'shellscript':
        case 'perl': // Добавим Perl
        case 'r': // Добавим R
            cleaned = cleaned.replace(/#.*/g, ''); // Удаляем комментарии от # до конца строки
            break;
        // Можно добавить другие языки по мере необходимости
        // case 'lua':
        //     cleaned = cleaned.replace(/--\[\[[\s\S]*?]]|--.*/g, ''); // Многострочные и однострочные Lua
        //     break;
        default:
            // Для неподдерживаемых языков комментарии не удаляются
            console.warn(`[CodeReplacerTS TextUtils] Comment removal not implemented for language: ${languageId}`);
            break;
    }

    // 2. Нормализация пробельных символов
    // Заменяем все последовательности пробельных символов (включая переводы строк) на один пробел
    cleaned = cleaned.replace(/\s+/g, ' ');

    // 3. Обрезка пробелов по краям
    cleaned = cleaned.trim();

    return cleaned;
}

/**
 * Базовая нормализация текста: заменяет переносы строк CRLF и CR на LF
 * и опционально обрезает пробелы по краям.
 * Полезна для сравнения текста, где важны только сами переносы строк, а не их тип.
 *
 * @param {string} text Исходный текст.
 * @param {boolean} [trimEdges=true] Обрезать ли пробелы в начале и конце строки.
 * @returns {string} Нормализованный текст.
 */
export function normalizeText(text: string, trimEdges: boolean = true): string {
    // Заменяем Windows (CRLF) и старый Mac (CR) на Unix (LF)
    let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Обрезаем пробелы по краям, если требуется
    if (trimEdges) {
        normalized = normalized.trim();
    }

    return normalized;
}
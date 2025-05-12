// src/state.ts
import * as vscode from 'vscode';

/**
 * Тип декоратора для подсветки найденных совпадений в редакторе.
 */
let findDecorationType: vscode.TextEditorDecorationType | undefined;

/**
 * Массив для хранения найденных совпадений (диапазоны и режим поиска).
 */
let matchedResults: { range: vscode.Range, mode: 'ast' | 'text' }[] = [];

/**
 * Инициализирует тип декоратора. Вызывается при активации расширения.
 */
export function initializeDecoration(): void {
    if (!findDecorationType) {
        findDecorationType = vscode.window.createTextEditorDecorationType({
            // Используем стандартный цвет подсветки поиска VS Code для консистентности
            // или можно вернуть желтый: 'rgba(255, 255, 0, 0.3)'
            overviewRulerColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            // Добавим рамку для лучшей видимости
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: new vscode.ThemeColor('editor.findMatchHighlightBorder'),
            isWholeLine: false,
        });
         console.log('[CodeReplacerTS State] Decoration type initialized.');
    }
}

/**
 * Возвращает инициализированный тип декоратора.
 * @throws Error если декоратор не был инициализирован.
 * @returns {vscode.TextEditorDecorationType} Тип декоратора.
 */
export function getDecorationType(): vscode.TextEditorDecorationType {
    if (!findDecorationType) {
        // Эта ошибка не должна возникать при правильном жизненном цикле,
        // но добавим проверку для надежности.
        console.error('[CodeReplacerTS State] Attempted to get decoration type before initialization.');
        throw new Error('Find decoration type has not been initialized.');
    }
    return findDecorationType;
}

/**
 * Возвращает текущий список найденных совпадений.
 * @returns {{ range: vscode.Range, mode: 'ast' | 'text' }[]} Копия массива совпадений.
 */
export function getMatchedResults(): { range: vscode.Range, mode: 'ast' | 'text' }[] {
    // Возвращаем копию, чтобы избежать случайных мутаций извне
    return [...matchedResults];
}

/**
 * Устанавливает новый список найденных совпадений.
 * @param { { range: vscode.Range, mode: 'ast' | 'text' }[]} newResults Новый массив совпадений.
 */
export function setMatchedResults(newResults: { range: vscode.Range, mode: 'ast' | 'text' }[]): void {
    matchedResults = newResults;
    console.log(`[CodeReplacerTS State] Stored ${matchedResults.length} matched results.`);
}

/**
 * Очищает список найденных совпадений.
 */
export function clearMatchedResults(): void {
    if (matchedResults.length > 0) {
        console.log('[CodeReplacerTS State] Clearing stored matched results.');
        matchedResults = [];
    }
}

/**
 * Освобождает ресурсы, связанные с типом декоратора. Вызывается при деактивации.
 */
export function disposeDecoration(): void {
    if (findDecorationType) {
        findDecorationType.dispose();
        findDecorationType = undefined;
        console.log('[CodeReplacerTS State] Decoration type disposed.');
    }
}

/**
 * Полностью очищает состояние (результаты и декоратор).
 * Вызывается при деактивации.
 */
export function clearState(): void {
    clearMatchedResults();
    disposeDecoration(); // Декоратор тоже очищаем при деактивации
}
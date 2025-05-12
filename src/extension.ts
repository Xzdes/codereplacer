// src/extension.ts
import * as vscode from 'vscode';
import { CodeReplacerViewProvider } from './webviewProvider'; // Импорт нашего провайдера Webview
import { initializeDecoration, clearState } from './state'; // Импорт функций управления состоянием
import { clearHighlights } from './editorActions'; // Импорт функции очистки подсветки

/**
 * Активирует расширение CodeReplacerTS.
 * Вызывается VS Code при первом запуске команды расширения или при старте, если указано в package.json.
 * Регистрирует провайдер Webview и инициализирует необходимые ресурсы.
 *
 * @param {vscode.ExtensionContext} context Контекст расширения, предоставляемый VS Code. Содержит утилиты и информацию о расширении.
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('[CodeReplacerTS] Activating extension "codereplacer-ts"...');

    // 1. Инициализация ресурсов состояния (например, создание типа декоратора)
    try {
        initializeDecoration();
        console.log('[CodeReplacerTS] State initialized (Decoration Type).');
    } catch (error: any) {
        console.error('[CodeReplacerTS] Failed to initialize state:', error);
        // Показываем ошибку пользователю, так как без декоратора расширение бесполезно
        vscode.window.showErrorMessage(`Failed to initialize CodeReplacerTS: ${error.message || 'Unknown error'}`);
        return; // Прерываем активацию
    }

    // 2. Создание экземпляра провайдера Webview
    // Передаем URI расширения для доступа к ресурсам (media/)
    const provider = new CodeReplacerViewProvider(context.extensionUri);
    console.log('[CodeReplacerTS] Webview provider instance created.');

    // 3. Регистрация провайдера Webview
    // VS Code будет использовать этот провайдер для отображения View с ID 'codereplacer.view'
    const providerRegistration = vscode.window.registerWebviewViewProvider(
        CodeReplacerViewProvider.viewType,
        provider,
        {
            // Опция retainContextWhenHidden: true позволяет сохранять состояние Webview (DOM, скрипты),
            // когда панель не видна. Это удобно, чтобы не терять введенный текст.
            webviewOptions: { retainContextWhenHidden: true }
        }
    );

    // Добавляем регистрацию провайдера в подписки контекста.
    // VS Code автоматически вызовет dispose() для зарегистрированных элементов при деактивации расширения.
    context.subscriptions.push(providerRegistration);
    console.log('[CodeReplacerTS] Webview provider registered.');

    // 4. Добавление слушателя на смену активного редактора
    // Очищаем подсветку при переключении между файлами или при закрытии активного редактора.
    // Это предотвращает отображение неактуальной подсветки в новом редакторе.
    const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
        // editor может быть undefined, если фокус ушел из текстового редактора
        console.log(`[CodeReplacerTS] Active text editor changed. New editor: ${editor ? editor.document.fileName : 'none'}. Clearing highlights.`);
        // Вызываем clearHighlights без аргумента, она сама разберется с активным/видимыми редакторами
        // и очистит состояние (matchedResults)
        clearHighlights(undefined);
    });

    // Добавляем слушателя в подписки для автоматического удаления при деактивации.
    context.subscriptions.push(editorChangeListener);
    console.log('[CodeReplacerTS] Active editor change listener added.');

    console.log('[CodeReplacerTS] Extension "codereplacer-ts" is now active!');
}

/**
 * Деактивирует расширение.
 * Вызывается VS Code при выключении или перезагрузке окна, или при удалении/отключении расширения.
 * Освобождает все ресурсы, созданные в `activate`.
 */
export function deactivate(): void {
    console.log('[CodeReplacerTS] Deactivating extension...');
    // Очищаем все состояние и освобождаем ресурсы (включая dispose для DecorationType)
    clearState();
    console.log('[CodeReplacerTS] Extension deactivated and state cleared.');
}
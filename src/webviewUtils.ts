// src/webviewUtils.ts
import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Генерирует криптографически стойкий nonce (случайную строку).
 * Используется для политики безопасности контента (CSP) в Webview,
 * чтобы разрешить выполнение только доверенных скриптов.
 *
 * @returns {string} Строка nonce в кодировке base64.
 */
export function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

/**
 * Генерирует полную HTML-разметку для Webview.
 * Включает ссылки на CSS, основной скрипт webview.js,
 * устанавливает политику безопасности контента (CSP) и базовую структуру HTML.
 *
 * @param {vscode.Webview} webview Экземпляр Webview, для которого генерируется HTML.
 * @param {vscode.Uri} extensionUri URI расширения, необходим для создания правильных путей к ресурсам (CSS, JS).
 * @returns {string} Строка с полным HTML-кодом для Webview.
 */
export function generateWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    // 1. Генерация Nonce для CSP
    const nonce = getNonce();

    // 2. Получение URI для локальных ресурсов (CSS, JS)
    // Используем webview.asWebviewUri для получения специальных URI,
    // доступных внутри Webview.
    const stylesPath = vscode.Uri.joinPath(extensionUri, 'media', 'webview.css');
    const scriptPath = vscode.Uri.joinPath(extensionUri, 'media', 'webview.js');
    const stylesUri = webview.asWebviewUri(stylesPath);
    const scriptUri = webview.asWebviewUri(scriptPath);

    // 3. Формирование строки HTML
    // Используем шаблонные строки для удобства вставки переменных.
    // Устанавливаем Content Security Policy (CSP):
    // - default-src 'none': Запрещает всё по умолчанию.
    // - style-src ${webview.cspSource} 'unsafe-inline': Разрешает стили из источников VS Code и инлайн-стили (если нужны, но лучше избегать).
    // - script-src 'nonce-${nonce}': Разрешает выполнение скриптов с указанным nonce.
    // - img-src ${webview.cspSource} https: : Разрешает изображения из источников VS Code и по HTTPS.
    // - connect-src 'self': Разрешает Webview отправлять запросы к самому себе (например, через postMessage).
   return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
        img-src ${webview.cspSource} https: data:;
        font-src ${webview.cspSource};
        connect-src 'self';
    ">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Code Replacer TS</title>
</head>
<body>
    <div class="container">

        <!-- Блок для "Code to Find" -->
        <div class="input-group">
            <h2>Code to Find:</h2>
            <textarea id="findText" placeholder="Paste code snippet..." rows="8"></textarea>
            <small>Uses AST for TS/JS, text compare for others.</small>
            <div class="options-container">
                <label for="ignoreIdentifiersCheckbox">
                    <input type="checkbox" id="ignoreIdentifiersCheckbox" name="ignoreIdentifiers">
                    Ignore variable/function names (AST mode)
                </label>
            </div>
        </div>

        <!-- Блок для "Replacement Code" (ВОССТАНОВЛЕН/ПРОВЕРЕН) -->
        <div class="input-group">
            <h2>Replacement Code:</h2>
            <textarea id="replaceText" placeholder="Paste replacement code..." rows="8"></textarea>
            <small>Leave empty to delete found code.</small>
        </div>
        <!-- Конец блока для "Replacement Code" -->

    </div>

    <div class="button-container">
        <button id="applyButton">Replace Found Matches</button>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
// src/webviewProvider.ts
import * as vscode from 'vscode';
import { generateWebviewHtml } from './webviewUtils'; // Утилита для генерации HTML
import { highlightTextInEditor, replaceFoundMatches, clearHighlights } from './editorActions'; // Основные действия с редактором

/**
 * Предоставляет и управляет Webview для инструмента поиска и замены кода.
 * Отображает UI (поля ввода, кнопка) и обрабатывает взаимодействие пользователя,
 * делегируя основные операции модулю editorActions.
 */
export class CodeReplacerViewProvider implements vscode.WebviewViewProvider {

    /**
     * Идентификатор типа для этого Webview View. Должен совпадать с `id` в `package.json`.
     */
    public static readonly viewType = 'codereplacer.view';

    private _view?: vscode.WebviewView; // Ссылка на текущий экземпляр WebviewView
    private readonly _extensionUri: vscode.Uri; // URI расширения для доступа к ресурсам

    // Последние полученные значения из полей ввода Webview (для передачи в highlight)
    private _lastFindText: string = '';
    private _lastReplaceText: string = '';


    /**
     * Создает экземпляр провайдера.
     * @param {vscode.Uri} extensionUriValue URI корневой папки расширения.
     */
    constructor(private readonly extensionUriValue: vscode.Uri) {
        this._extensionUri = extensionUriValue;
         console.log('[CodeReplacerTS Provider] Instance created.');
    }

    /**
     * Вызывается VS Code, когда необходимо отобразить или восстановить Webview.
     * Настраивает Webview, устанавливает его HTML-содержимое и настраивает обработчики сообщений.
     *
     * @param {vscode.WebviewView} webviewView Экземпляр WebviewView.
     * @param {vscode.WebviewViewResolveContext} context Контекст разрешения.
     * @param {vscode.CancellationToken} _token Токен отмены.
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        console.log('[CodeReplacerTS Provider] Resolving webview view.');
        this._view = webviewView;

        // Настройка параметров Webview
        webviewView.webview.options = {
            // Разрешить выполнение скриптов в Webview
            enableScripts: true,
            // Ограничить доступ Webview к локальным ресурсам только папкой 'media'
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
        };

        // Установка HTML-контента для Webview
        // Используем утилиту для генерации HTML
        webviewView.webview.html = generateWebviewHtml(webviewView.webview, this._extensionUri);
        console.log('[CodeReplacerTS Provider] HTML content set for WebviewView.');

        // Обработка сообщений, полученных от Webview (из webview.js)
        webviewView.webview.onDidReceiveMessage(
            async (message: { command: string; text?: string; findText?: string; replaceText?: string }) => {
                console.log('[CodeReplacerTS Provider] Received message from webview:', message.command, message); // Логируем всё сообщение для отладки

                switch (message.command) {
                    // Сообщение приходит при изменении текста в поле "Code to Find" (с дебаунсом)
                    case 'findText':
                        if (typeof message.text === 'string') {
                            this._lastFindText = message.text; // Сохраняем последнее значение
                             // Запускаем подсветку, передавая оба значения для предпросмотра в hover
                            highlightTextInEditor(this._lastFindText, this._lastReplaceText);
                        } else {
                             console.warn('[CodeReplacerTS Provider] "findText" command received without text.');
                        }
                        break;

                    // Сообщение приходит при изменении текста в поле "Replacement Code"
                    // ДОБАВЛЕНО: Новый обработчик для обновления предпросмотра при изменении текста замены
                    case 'updateReplaceText': // Предполагаем, что webview.js будет отправлять это сообщение
                        if (typeof message.text === 'string') {
                            this._lastReplaceText = message.text; // Сохраняем последнее значение
                            // Если в поле поиска уже что-то есть, обновляем подсветку (и hover messages)
                            if (this._lastFindText.trim()) {
                                highlightTextInEditor(this._lastFindText, this._lastReplaceText);
                            }
                        } else {
                             console.warn('[CodeReplacerTS Provider] "updateReplaceText" command received without text.');
                        }
                        break;

                    // Сообщение приходит при нажатии кнопки "Replace Found Matches"
                    case 'applyReplace':
                        // Используем текст замены из сообщения, если он есть, иначе последний сохраненный
                        const replaceText = typeof message.replaceText === 'string' ? message.replaceText : this._lastReplaceText;
                        // Обновляем сохраненные значения на всякий случай
                        if (typeof message.findText === 'string') this._lastFindText = message.findText;
                        this._lastReplaceText = replaceText;

                         // Выполняем замену
                        await replaceFoundMatches(replaceText);
                        break;

                    // Сообщение для отображения простого информационного окна
                    case 'alert':
                        if (typeof message.text === 'string') {
                            vscode.window.showInformationMessage(message.text);
                        }
                        break;

                    // Неизвестная команда
                    default:
                        console.warn(`[CodeReplacerTS Provider] Received unknown command from webview: ${message.command}`);
                }
            }
        );

        // Обработка события уничтожения Webview (например, при закрытии панели)
        webviewView.onDidDispose(() => {
            console.log('[CodeReplacerTS Provider] WebviewView disposed.');
            // Очищаем подсветку во всех редакторах при закрытии панели
            clearHighlights(undefined); // Передаем undefined для очистки во всех видимых редакторах
            this._view = undefined; // Сбрасываем ссылку на Webview
            this._lastFindText = ''; // Сбрасываем сохраненные значения
            this._lastReplaceText = '';
        }, null /* thisArg */); // Добавляем null для thisArg, если не используется

        // --- Добавлено: Очистка подсветки при показе View ---
        // Если View становится видимым (например, пользователь переключился на вкладку расширения),
        // очистим подсветку, так как пользователь, вероятно, хочет начать новый поиск.
        // webviewView.onDidChangeVisibility(() => {
        //     if (webviewView.visible) {
        //         console.log('[CodeReplacerTS Provider] Webview became visible, clearing highlights.');
        //         clearHighlights(undefined);
        //         // Можно также очистить поля ввода в webview, отправив сообщение
        //         // this._view?.webview.postMessage({ command: 'clearInputs' });
        //     }
        // });

         console.log('[CodeReplacerTS Provider] Webview event listeners configured.');
    }

     // --- Методы, которые были перемещены в editorActions или другие утилиты, УДАЛЕНЫ ---
     // private areNodesBasicallyEqual(...) { /* ... */ }
     // private compareNodeArrays(...) { /* ... */ }
     // private compareModifiers(...) { /* ... */ }
     // private isTriviaNode(...) { /* ... */ }
     // private highlightTextInEditor(...) { /* ... */ }
     // private replaceFoundMatches(...) { /* ... */ }
     // public clearHighlights(...) { /* ... */ }
     // private _getHtmlForWebview(...) { /* ... */ }
}
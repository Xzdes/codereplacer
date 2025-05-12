// src/webviewProvider.ts
import * as vscode from 'vscode';
import { generateWebviewHtml } from './webviewUtils';
import { highlightTextInEditor, replaceFoundMatches, clearHighlights } from './editorActions';

export class CodeReplacerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codereplacer.view';

    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    // --- Сохраненные состояния из Webview ---
    private _currentFindText: string = '';
    private _currentReplaceText: string = '';
    private _currentIgnoreIdentifiers: boolean = false;

    constructor(private readonly extensionUriValue: vscode.Uri) {
        this._extensionUri = extensionUriValue;
        console.log('[CodeReplacerTS Provider] Instance created.');
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        console.log('[CodeReplacerTS Provider] Resolving webview view.');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };

        webviewView.webview.html = generateWebviewHtml(webviewView.webview, this._extensionUri);
        console.log('[CodeReplacerTS Provider] HTML content set for WebviewView.');

        webviewView.webview.onDidReceiveMessage(
            async (message: {
                command: string;
                text?: string;
                findText?: string;
                replaceText?: string;
                ignoreIdentifiers?: boolean;
            }) => {
                console.log('[CodeReplacerTS Provider] Received message from webview:', message.command, JSON.stringify(message));

                // 1. Обновляем внутреннее состояние на основе пришедшего сообщения.
                if (message.command === 'findText' && typeof message.text === 'string') {
                    this._currentFindText = message.text;
                }
                if (message.command === 'updateReplaceText' && typeof message.text === 'string') {
                    this._currentReplaceText = message.text;
                }
                if (typeof message.ignoreIdentifiers === 'boolean') { // Обновляем всегда, если пришло
                    this._currentIgnoreIdentifiers = message.ignoreIdentifiers;
                }

                // Для команды applyReplace, тексты могут приходить в отдельных полях findText и replaceText.
                if (message.command === 'applyReplace') {
                    if (typeof message.findText === 'string') {
                        this._currentFindText = message.findText; // Хотя findText не используется в replaceFoundMatches, сохраняем для консистентности
                    }
                    if (typeof message.replaceText === 'string') {
                        this._currentReplaceText = message.replaceText;
                    }
                }

                // 2. Выполняем действия в зависимости от команды
                switch (message.command) {
                    case 'findText':
                    case 'updateReplaceText':
                        // Для этих команд всегда используем актуальные _currentFindText, _currentReplaceText, _currentIgnoreIdentifiers
                        // Для updateReplaceText, подсветка имеет смысл только если есть текст для поиска.
                        if (this._currentFindText.trim() || message.command === 'findText') {
                            console.log(`[CodeReplacerTS Provider] Calling highlightTextInEditor with find: "${this._currentFindText.substring(0,30)}...", replace: "${this._currentReplaceText.substring(0,30)}...", ignoreIdentifiers: ${this._currentIgnoreIdentifiers}`);
                            await highlightTextInEditor(
                                this._currentFindText,
                                this._currentReplaceText,
                                this._currentIgnoreIdentifiers
                            );
                        } else if (!this._currentFindText.trim() && message.command === 'updateReplaceText') {
                            console.log('[CodeReplacerTS Provider] updateReplaceText received, but find text is empty. No highlight update.');
                        }
                        break;

                    case 'applyReplace':
                        // Функция replaceFoundMatches ожидает ОДИН аргумент: текст для замены.
                        // Используем this._currentReplaceText, которое было обновлено из message.replaceText
                        // (если оно присутствовало в сообщении) на шаге 1.
                        console.log(`[CodeReplacerTS Provider] Calling replaceFoundMatches with replace text: "${this._currentReplaceText.substring(0,30)}..."`);
                        await replaceFoundMatches(this._currentReplaceText); // Только один аргумент!
                        
                        // Опционально: после замены можно очистить поля ввода в webview
                        // this._view?.webview.postMessage({ command: 'clearInputs' });
                        // И сбросить внутренние состояния (хотя clearHighlights уже очищает matchedResults)
                        // this._currentFindText = '';
                        // this._currentReplaceText = '';
                        // this._currentIgnoreIdentifiers = false;
                        break;

                    case 'alert':
                        if (typeof message.text === 'string') {
                            vscode.window.showInformationMessage(message.text);
                        }
                        break;

                    default:
                        console.warn(`[CodeReplacerTS Provider] Received unknown command from webview: ${message.command}`);
                }
            }
        );

        webviewView.onDidDispose(() => {
            console.log('[CodeReplacerTS Provider] WebviewView disposed.');
            clearHighlights(undefined);
            this._view = undefined;
            this._currentFindText = '';
            this._currentReplaceText = '';
            this._currentIgnoreIdentifiers = false;
        }, null);

        console.log('[CodeReplacerTS Provider] Webview event listeners configured.');
    }
}
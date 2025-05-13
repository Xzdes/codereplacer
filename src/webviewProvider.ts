// src/webviewProvider.ts
import * as vscode from 'vscode';
import { generateWebviewHtml } from './webviewUtils';
// import fetch from 'node-fetch'; // Удаляем статический импорт
import { highlightTextInEditor, replaceFoundMatches, clearHighlights } from './editorActions';

// --- Интерфейсы для ответа Gemini API ---
interface GeminiPart {
    text: string;
    // Могут быть и другие поля, например, inlineData, functionCall
}

interface GeminiContent {
    parts: GeminiPart[];
    role?: string; // 'user' или 'model'
}

interface GeminiCandidate {
    content: GeminiContent;
    finishReason?: string;
    index?: number;
    safetyRatings?: unknown[]; // Можно детализировать, если нужно
    // citationMetadata, tokenCount и т.д.
}

interface GeminiApiResponse {
    candidates?: GeminiCandidate[];
    promptFeedback?: unknown; // Можно детализировать
    // usageMetadata и т.д.
}

interface GeminiApiErrorDetail {
    code: number;
    message: string;
    status: string;
}

interface GeminiApiErrorResponse {
    error?: GeminiApiErrorDetail;
}


export class CodeReplacerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codereplacer.view';

    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext; // Контекст расширения для доступа к Secrets API

    // --- Сохраненные состояния из Webview ---
    private _currentFindText: string = '';
    private _currentReplaceText: string = '';
    private _currentIgnoreIdentifiers: boolean = false;
    private _apiKey: string | undefined;
    
    private readonly _apiKeyStorageKey = 'codereplacer.apiKey';

    // Переменная для хранения динамически импортированной функции fetch
    private _fetchFunction?: (...args: any[]) => Promise<any>;


    constructor(extensionUriValue: vscode.Uri, context: vscode.ExtensionContext) { // Принимаем ExtensionContext
        this._extensionUri = extensionUriValue;
        this._context = context; // Сохраняем ExtensionContext
        console.log('[CodeReplacerTS Provider] Instance created.');
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _webviewResolveContext: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        console.log('[CodeReplacerTS Provider] Resolving webview view.');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
        };

        webviewView.webview.html = generateWebviewHtml(webviewView.webview, this._extensionUri);
        console.log('[CodeReplacerTS Provider] HTML content set for WebviewView.');

        this._restoreApiKey(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async (message: {
                command: string;
                text?: string;
                findText?: string;
                replaceText?: string;
                ignoreIdentifiers?: boolean;
            }) => {
                console.log('[CodeReplacerTS Provider] Received message from webview:', message.command, JSON.stringify(message));

                if (message.command === 'setApiKey' && typeof message.text === 'string') {
                    await this._storeApiKey(message.text, webviewView.webview);
                    return;
                }

                if (message.command === 'findText') {
                    if (typeof message.text === 'string') this._currentFindText = message.text;
                    if (typeof message.ignoreIdentifiers === 'boolean') this._currentIgnoreIdentifiers = message.ignoreIdentifiers;
                } else if (message.command === 'updateReplaceText') {
                    if (typeof message.text === 'string') this._currentReplaceText = message.text;
                    if (typeof message.ignoreIdentifiers === 'boolean') this._currentIgnoreIdentifiers = message.ignoreIdentifiers;
                } else if (message.command === 'applyReplace') {
                    if (typeof message.findText === 'string') this._currentFindText = message.findText;
                    if (typeof message.replaceText === 'string') this._currentReplaceText = message.replaceText;
                    if (typeof message.ignoreIdentifiers === 'boolean') this._currentIgnoreIdentifiers = message.ignoreIdentifiers;
                }

                switch (message.command) {
                    case 'findText':
                    case 'updateReplaceText':
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
                        console.log(`[CodeReplacerTS Provider] Calling replaceFoundMatches with replace text: "${this._currentReplaceText.substring(0,30)}..."`);
                        await replaceFoundMatches(this._currentReplaceText);
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

    public async promptAndStoreApiKey() {
        const apiKeyInput = await vscode.window.showInputBox({
            prompt: 'Enter your Gemini API key:',
            placeHolder: 'API key',
            ignoreFocusOut: true,
        });

        if (apiKeyInput) {
            await this._storeApiKey(apiKeyInput, this._view?.webview);
        } else {
            vscode.window.showInformationMessage('API key input was cancelled or left empty.');
        }
    }

    private async _storeApiKey(apiKey: string, webview?: vscode.Webview) {
        this._apiKey = apiKey;
        await this._context.secrets.store(this._apiKeyStorageKey, apiKey);
        console.log('[CodeReplacerTS Provider] API key stored securely.');
        const messageTarget = webview || { postMessage: (msg: any) => vscode.window.showInformationMessage(msg.text) };
        messageTarget.postMessage({ command: 'showInfo', text: 'API key saved securely.' });
    }

    private async _restoreApiKey(webview: vscode.Webview) {
        this._apiKey = await this._context.secrets.get(this._apiKeyStorageKey);
        if (this._apiKey) {
            console.log('[CodeReplacerTS Provider] API key restored from secure storage.');
            webview.postMessage({ command: 'showInfo', text: 'API key restored from secure storage.' });
        } else {
            console.log('[CodeReplacerTS Provider] No API key found in secure storage.');
            webview.postMessage({ command: 'showInfo', text: 'No API key found. Use "Code Replacer: Set API Key" command.' });
        }
    }
    
    /**
     * Динамически импортирует и кэширует функцию fetch.
     */
    private async _getFetch(): Promise<(...args: any[]) => Promise<any>> {
        if (!this._fetchFunction) {
            try {
                const nodeFetch = await import('node-fetch');
                this._fetchFunction = nodeFetch.default || nodeFetch; // node-fetch v3+ экспортирует default
            } catch (error) {
                console.error('[CodeReplacerTS Provider] Failed to dynamically import node-fetch:', error);
                throw new Error('Failed to load network library (node-fetch).');
            }
        }
        if (!this._fetchFunction) { // Дополнительная проверка на случай если импорт не удался, но не кинул ошибку
             throw new Error('Network library (node-fetch) is not available.');
        }
        return this._fetchFunction;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private async _callGeminiAPI(prompt: string): Promise<string | undefined> {
        if (!this._apiKey) {
            vscode.window.showErrorMessage('API key is not set. Use "Code Replacer: Set API Key" command.');
            this.promptAndStoreApiKey();
            return undefined;
        }

        const fetch = await this._getFetch();

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this._apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                }),
            });

            if (!response.ok) {
                let errorMessage = response.statusText;
                try {
                    // Пытаемся распарсить тело ошибки, если оно есть
                    const errorData = await response.json() as GeminiApiErrorResponse | { message?: string }; // Типизируем возможные форматы ошибки
                    
                    if (errorData && typeof errorData === 'object' && errorData !== null) {
                        if ('error' in errorData && errorData.error && typeof errorData.error.message === 'string') {
                            errorMessage = errorData.error.message;
                        } else if ('message' in errorData && typeof errorData.message === 'string') {
                             errorMessage = errorData.message;
                        }
                    }
                } catch (e) {
                    // Если тело ошибки не JSON или парсинг не удался, используем statusText
                    console.warn('[CodeReplacerTS Provider] Could not parse error response body:', e);
                }
                console.error('[CodeReplacerTS Provider] Gemini API Error:', errorMessage);
                throw new Error(`API request failed with status ${response.status}: ${errorMessage}`);
            }

            const data = await response.json() as GeminiApiResponse; // Применяем интерфейс к ответу
            
            if (data && data.candidates && data.candidates.length > 0 &&
                data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0 &&
                typeof data.candidates[0].content.parts[0].text === 'string'
            ) {
                return data.candidates[0].content.parts[0].text;
            } else {
                console.error('[CodeReplacerTS Provider] Unexpected Gemini API response format:', data);
                throw new Error('Unexpected API response format. No valid text found in candidates.');
            }
        } catch (error: any) {
            console.error('[CodeReplacerTS Provider] Gemini API call failed:', error);
            vscode.window.showErrorMessage(`Gemini API call failed: ${error.message || 'Unknown error'}`);
            return undefined;
        }
    }
}
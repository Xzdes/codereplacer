import * as vscode from 'vscode';

// Глобальная переменная для типа декорации, используемой для подсветки найденного текста
let findDecorationType: vscode.TextEditorDecorationType;

/**
 * Нормализует текст:
 * 1. Заменяет все варианты символов новой строки (CRLF, CR) на LF (\n).
 * 2. Опционально удаляет пробелы по краям.
 * @param text Исходный текст.
 * @param trimEdges Удалять ли пробелы по краям (по умолчанию true).
 * @returns Нормализованный текст.
 */
function normalizeText(text: string, trimEdges: boolean = true): string {
    let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (trimEdges) {
        normalized = normalized.trim();
    }
    return normalized;
}


export function activate(context: vscode.ExtensionContext) {
    console.log('[CodeReplacerTS] Extension "codereplacer" is now active!');

    findDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 255, 0, 0.3)',
        border: '1px solid yellow',
    });
    context.subscriptions.push(findDecorationType);

    const provider = new CodeReplacerViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CodeReplacerViewProvider.viewType, provider)
    );

    console.log('[CodeReplacerTS] CodeReplacerViewProvider registered.');
}

class CodeReplacerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codereplacer.view';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;

    constructor(private readonly extensionUriValue: vscode.Uri) { // Переименовал для ясности
        this._extensionUri = extensionUriValue;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        console.log('[CodeReplacerTS] HTML content set for WebviewView.');

        webviewView.webview.onDidReceiveMessage(async (message: { command: string; text?: string; findText?: string; replaceText?: string }) => {
            console.log('[CodeReplacerTS] Provider received message from webview:', message.command, 'data length (text/findText):', message.text?.length || message.findText?.length);
            switch (message.command) {
                case 'findText':
                    if (typeof message.text === 'string') {
                        this.highlightTextInEditor(message.text);
                    }
                    return;
                case 'applyReplace':
                    if (typeof message.findText === 'string' && typeof message.replaceText === 'string') {
                        await this.replaceTextInEditor(message.findText, message.replaceText);
                    }
                    return;
                case 'alert':
                    if (typeof message.text === 'string') {
                        vscode.window.showInformationMessage(message.text);
                    }
                    return;
            }
        });

        webviewView.onDidDispose(() => {
            console.log('[CodeReplacerTS] WebviewView disposed.');
            this.clearHighlights();
        });
    }

    private highlightTextInEditor(textToFindFromWebview: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Highlighting text. Editor active:', !!editor);

        // Нормализуем текст из Webview (удаляем крайние пробелы по умолчанию)
        const normalizedTextToFind = normalizeText(textToFindFromWebview);

        if (normalizedTextToFind.length === 0 && textToFindFromWebview.length > 0) {
            console.log('[CodeReplacerTS] Search text became empty after normalization (was likely all whitespace). Clearing highlights.');
            this.clearHighlights();
            return;
        }
        if (normalizedTextToFind.length === 0) { // Если и был пустой, или стал пустым
             this.clearHighlights();
             return;
        }


        console.log('--- DEBUG: Normalized Text from Webview (Find) ---');
        console.log('Original Length:', textToFindFromWebview.length, 'Normalized Length:', normalizedTextToFind.length);
        // console.log('Normalized JSON:', JSON.stringify(normalizedTextToFind)); // Для очень детальной отладки
        console.log('--- END DEBUG ---');

        if (!editor) {
            this.clearHighlights(); // Очищаем, если нет активного редактора
            return;
        }

        const document = editor.document;
        // Нормализуем текст документа, но НЕ удаляем крайние пробелы, т.к. они могут быть значимы в коде
        const documentText = normalizeText(document.getText(), false);
        const decorationsArray: vscode.DecorationOptions[] = [];
        let startIndex = 0;
        let count = 0;

        console.log('--- DEBUG: Document Text Snippet (for highlight) ---');
        const snippetStart = Math.max(0, documentText.indexOf(normalizedTextToFind) - 50);
        const snippetEnd = Math.min(documentText.length, snippetStart + normalizedTextToFind.length + 100);
        // console.log('Document JSON (snippet):', JSON.stringify(documentText.substring(snippetStart, snippetEnd))); // Для очень детальной отладки
        console.log('--- END DEBUG ---');


        while ((startIndex = documentText.indexOf(normalizedTextToFind, startIndex)) !== -1) {
            count++;
            const startPosOriginal = document.positionAt(this.getOriginalIndex(document.getText(), documentText, startIndex));
            const endPosOriginal = document.positionAt(this.getOriginalIndex(document.getText(), documentText, startIndex + normalizedTextToFind.length));

            const decoration: vscode.DecorationOptions = {
                range: new vscode.Range(startPosOriginal, endPosOriginal),
                hoverMessage: 'Найденный фрагмент для замены'
            };
            decorationsArray.push(decoration);
            startIndex += normalizedTextToFind.length;
        }
        console.log(`[CodeReplacerTS] Found ${count} occurrences during highlight.`);
        editor.setDecorations(findDecorationType, decorationsArray);
    }

    private clearHighlights() {
        const editor = vscode.window.activeTextEditor;
        if (editor && findDecorationType) {
            editor.setDecorations(findDecorationType, []);
            console.log('[CodeReplacerTS] Highlights cleared by provider.');
        }
    }

    private async replaceTextInEditor(findTextFromWebview: string, replaceTextFromWebview: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Applying replace. Editor active:', !!editor);

        // Нормализуем текст для поиска (удаляем крайние пробелы по умолчанию)
        const normalizedFindText = normalizeText(findTextFromWebview);
        // Текст для замены оставляем "как есть", т.к. пользователь может хотеть вставить пробелы/новые строки
        const replaceText = replaceTextFromWebview;


        if (normalizedFindText.length === 0 && findTextFromWebview.length > 0) {
            vscode.window.showInformationMessage('Текст для поиска стал пустым после удаления пробелов. Замена не выполнена.');
            return;
        }
         if (normalizedFindText.length === 0) {
            vscode.window.showInformationMessage('Поле "Код для поиска" не должно быть пустым (или состоять только из пробелов).');
            return;
        }


        console.log('--- DEBUG: Normalized Text from Webview (Replace - Find) ---');
        console.log('Original Find Length:', findTextFromWebview.length, 'Normalized Find Length:', normalizedFindText.length);
        // console.log('Normalized Find JSON:', JSON.stringify(normalizedFindText));
        console.log('Replace Text Length:', replaceText.length);
        // console.log('Replace Text JSON:', JSON.stringify(replaceText));
        console.log('--- END DEBUG ---');


        if (!editor) {
            vscode.window.showErrorMessage('Нет активного текстового редактора для замены.');
            return;
        }

        const document = editor.document;
        const originalDocumentText = document.getText();
        // Нормализуем текст документа для поиска, но НЕ удаляем крайние пробелы
        const normalizedDocumentText = normalizeText(originalDocumentText, false);

        console.log('--- DEBUG: Document Text Snippet (for replace) ---');
        const snippetStart = Math.max(0, normalizedDocumentText.indexOf(normalizedFindText) - 50);
        const snippetEnd = Math.min(normalizedDocumentText.length, snippetStart + normalizedFindText.length + 100);
        // console.log('Document JSON (snippet):', JSON.stringify(normalizedDocumentText.substring(snippetStart, snippetEnd)));
        console.log('--- END DEBUG ---');

        const firstOccurrenceIndexNormalized = normalizedDocumentText.indexOf(normalizedFindText);
        console.log('[CodeReplacerTS] indexOf for replacement (on normalized text) returned:', firstOccurrenceIndexNormalized);

        if (firstOccurrenceIndexNormalized === -1) {
            vscode.window.showInformationMessage(`Нормализованный код для поиска не найден в документе.`);
            console.log('[CodeReplacerTS] Normalized text to find not found in the document.');
            this.clearHighlights();
            return;
        }

        // Получаем оригинальные индексы для замены в исходном документе
        const originalStartIndex = this.getOriginalIndex(originalDocumentText, normalizedDocumentText, firstOccurrenceIndexNormalized);
        const originalEndIndex = this.getOriginalIndex(originalDocumentText, normalizedDocumentText, firstOccurrenceIndexNormalized + normalizedFindText.length);

        const rangeToReplace = new vscode.Range(
            document.positionAt(originalStartIndex),
            document.positionAt(originalEndIndex)
        );

        const success = await editor.edit(editBuilder => {
            editBuilder.replace(rangeToReplace, replaceText); // Заменяем в оригинальном документе, используя оригинальный текст для замены
        });

        if (success) {
            console.log('[CodeReplacerTS] Text replaced successfully. Saving document...');
            await document.save();
            vscode.window.showInformationMessage('Код успешно заменен и файл сохранен!');
            this.clearHighlights();
        } else {
            vscode.window.showErrorMessage('Не удалось выполнить замену текста.');
            console.log('[CodeReplacerTS] Text replacement failed.');
        }
    }

    /**
     * Вспомогательная функция для получения индекса в оригинальной строке,
     * соответствующего индексу в нормализованной строке (где удалены \r).
     * Это нужно, потому что document.positionAt() работает с оригинальными смещениями.
     */
    private getOriginalIndex(originalText: string, normalizedText: string, normalizedIndex: number): number {
        if (originalText === normalizedText) {
            return normalizedIndex; // Если нормализации не было (или она не изменила текст), индексы совпадают
        }

        let crCount = 0;
        let currentNormalizedIndex = 0;
        for (let i = 0; i < originalText.length; i++) {
            if (originalText[i] === '\r' && originalText[i + 1] === '\n') {
                crCount++; // Считаем \r, которые были частью \r\n
                // i++; // Пропускаем \n, так как он есть и в нормализованной строке
            } else if (originalText[i] === '\r') {
                 crCount++; // Считаем одиночные \r
            }

            if (currentNormalizedIndex === normalizedIndex) {
                return i; // Нашли соответствующий оригинальный индекс
            }
            
            if (originalText[i] !== '\r') { // Символы \r не учитываются в normalizedText
                 currentNormalizedIndex++;
            }
        }
        // Если normalizedIndex указывает на конец нормализованной строки
        if (normalizedIndex === normalizedText.length) {
             return originalText.length;
        }
        // Эта ситуация не должна возникать, если normalizedIndex корректен
        console.warn(`[CodeReplacerTS] Could not map normalized index ${normalizedIndex} back to original text.`);
        return normalizedIndex + crCount; // Возвращаем аппроксимацию, но это плохой знак
    }


    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();
        const stylesPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.css');
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js');
        const stylesUri = webview.asWebviewUri(stylesPath);
        const scriptUri = webview.asWebviewUri(scriptPath);

        console.log('[CodeReplacerTS] Generating HTML for sidebar. Styles URI:', stylesUri.toString(), 'Script URI:', scriptUri.toString());

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" 
                  content="default-src 'none'; 
                           style-src ${webview.cspSource} 'unsafe-inline'; 
                           script-src 'nonce-${nonce}';
                           img-src ${webview.cspSource} https:;">
            <link href="${stylesUri}" rel="stylesheet">
            <title>Code Replacer Controls</title>
        </head>
        <body>
            <div class="container">
                <div class="input-group">
                    <h2>Код для поиска:</h2>
                    <textarea id="findText" placeholder="Вставьте код, который нужно найти..."></textarea>
                </div>
                <div class="input-group">
                    <h2>Код для замены:</h2>
                    <textarea id="replaceText" placeholder="Вставьте код, на который нужно заменить..."></textarea>
                </div>
            </div>
            <div class="button-container">
                <button id="applyButton">Применить</button>
            </div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {
    console.log('[CodeReplacerTS] Extension "codereplacer" is now deactivated.');
    if (findDecorationType) {
        findDecorationType.dispose();
    }
}
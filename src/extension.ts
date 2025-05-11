import * as vscode from 'vscode';

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let findDecorationType: vscode.TextEditorDecorationType;

export function activate(context: vscode.ExtensionContext) { // Типизируем context

    console.log('Congratulations, your extension "my-ts-replacer" is now active!');

    findDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 255, 0, 0.3)',
        border: '1px solid yellow'
    });
    context.subscriptions.push(findDecorationType);

    let disposable = vscode.commands.registerCommand('my-ts-replacer.openPanel', () => { // Используйте новое имя команды
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (currentPanel) {
            currentPanel.reveal(columnToShowIn);
        } else {
            currentPanel = vscode.window.createWebviewPanel(
                'codeReplacerTS', // Уникальный идентификатор для webview
                'Code Replacer (TS)', // Заголовок
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
                }
            );

            currentPanel.webview.html = getWebviewContent(currentPanel.webview, context.extensionUri);

            currentPanel.webview.onDidReceiveMessage(
                (message: any) => { // Можно создать интерфейс для message
                    switch (message.command) {
                        case 'findText':
                            highlightTextInEditor(message.text);
                            return;
                        case 'applyReplace':
                            replaceTextInEditor(message.findText, message.replaceText);
                            return;
                        case 'alert':
                            vscode.window.showInformationMessage(message.text);
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );

            currentPanel.onDidDispose(
                () => {
                    currentPanel = undefined;
                    clearHighlights();
                },
                null,
                context.subscriptions
            );
        }
    });

    context.subscriptions.push(disposable);
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <link href="${stylesUri}" rel="stylesheet">
        <title>Code Replacer (TS)</title>
    </head>
    <body>
        <h2>Код для поиска:</h2>
        <textarea id="findText" rows="10" placeholder="Вставьте код, который нужно найти..."></textarea>

        <h2>Код для замены:</h2>
        <textarea id="replaceText" rows="10" placeholder="Вставьте код, на который нужно заменить..."></textarea>

        <button id="applyButton">Применить</button>

        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function highlightTextInEditor(textToFind: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !textToFind) {
        clearHighlights();
        return;
    }

    const document = editor.document;
    const text = document.getText();
    const decorationsArray: vscode.DecorationOptions[] = []; // Типизация
    let match;
    let startIndex = 0;

    while ((startIndex = text.indexOf(textToFind, startIndex)) !== -1) {
        const startPos = document.positionAt(startIndex);
        const endPos = document.positionAt(startIndex + textToFind.length);
        const decoration: vscode.DecorationOptions = { // Типизация
            range: new vscode.Range(startPos, endPos),
            hoverMessage: 'Найденный код'
        };
        decorationsArray.push(decoration);
        startIndex += textToFind.length;
    }
    editor.setDecorations(findDecorationType, decorationsArray);
}

function clearHighlights() {
    const editor = vscode.window.activeTextEditor;
    if (editor && findDecorationType) {
        editor.setDecorations(findDecorationType, []);
    }
}

async function replaceTextInEditor(findText: string, replaceText: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('Нет активного текстового редактора.');
        return;
    }
    if (!findText) {
        vscode.window.showInformationMessage('Поле "Код для поиска" не должно быть пустым.');
        return;
    }

    const document = editor.document;
    const fullText = document.getText();
    const firstOccurrenceIndex = fullText.indexOf(findText);

    if (firstOccurrenceIndex === -1) {
        vscode.window.showInformationMessage(`Код для поиска не найден в файле: \n\n${findText}`);
        clearHighlights();
        return;
    }

    const startPos = document.positionAt(firstOccurrenceIndex);
    const endPos = document.positionAt(firstOccurrenceIndex + findText.length);
    const range = new vscode.Range(startPos, endPos);

    const success = await editor.edit(editBuilder => {
        editBuilder.replace(range, replaceText);
    });

    if (success) {
        await document.save();
        vscode.window.showInformationMessage('Код успешно заменен и файл сохранен.');
        clearHighlights();
    } else {
        vscode.window.showErrorMessage('Не удалось заменить текст.');
    }
}

export function deactivate() {
    if (findDecorationType) {
        findDecorationType.dispose();
    }
}
import * as vscode from 'vscode';
import * as ts from 'typescript';

// Глобальная переменная для типа декорации, используемой для подсветки найденного текста
let findDecorationType: vscode.TextEditorDecorationType;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С AST ---

/**
 * Парсит строку кода в массив узлов AST (стейтментов TypeScript).
 * @param code Строка кода для парсинга.
 * @param fileName Имя файла (может быть временным), используется парсером.
 * @returns Массив узлов ts.Statement.
 */
function parseCodeToASTStatements(code: string,
                                  fileName: string = 'tempFile.ts'): ts.Statement[] {
    const sourceFile = ts.createSourceFile(
        fileName,
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
    );
    return Array.from(sourceFile.statements);
}

// --- КОНЕЦ ВСПОМОГАТЕЛЬНЫХ ФУНКЦИЙ ДЛЯ РАБОТЫ С AST ---

// Функция normalizeText пока не используется активно при AST-поиске, но может быть полезна
function normalizeText(text: string, trimEdges: boolean = true): string {
    let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (trimEdges) {
        normalized = normalized.trim();
    }
    return normalized;
}


export function activate(context: vscode.ExtensionContext) {
    console.log('[CodeReplacerTS] Extension "codereplacer" is now active!');

    // ---- ВРЕМЕННЫЙ ТЕСТ ПАРСЕРА AST (можно удалить или закомментировать после проверки) ----
    const testCodeForParser = `
        function hello(name: string) {
            console.log("Hello, " + name);
        }
        const x = 10;
        class MyClass { constructor() {} }
    `;
    try {
        const astStatements = parseCodeToASTStatements(testCodeForParser, 'parserTest.ts');
        console.log(`[CodeReplacerTS AST Test] Parsed ${astStatements.length} statements from testCodeForParser.`);
        astStatements.forEach((stmt, index) => {
            console.log(`  Statement ${index + 1} Kind: ${ts.SyntaxKind[stmt.kind]} (Value: ${stmt.kind})`);
            // ... (детальные логи из предыдущих версий можно вернуть при необходимости)
        });
    } catch (e) {
        console.error("[CodeReplacerTS AST Test] Error parsing test code:", e);
    }
    // ---- КОНЕЦ ВРЕМЕННОГО ТЕСТА ПАРСЕРА AST ----


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

    constructor(private readonly extensionUriValue: vscode.Uri) {
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
                        // TODO: Заменить replaceTextInEditor на AST-логику
                        await this.replaceTextInEditor_WithStringLogic(message.findText, message.replaceText);
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

    /**
     * Рекурсивная функция для сравнения двух AST узлов.
     */
    private areNodesBasicallyEqual(
        nodeA: ts.Node | undefined, // Разрешаем undefined для удобства рекурсивных вызовов
        nodeB: ts.Node | undefined,
        sourceFileA?: ts.SourceFile,
        sourceFileB?: ts.SourceFile
    ): boolean {
        if (!nodeA && !nodeB) return true; // Оба null/undefined -> равны
        if (!nodeA || !nodeB) return false; // Один null/undefined, другой нет -> не равны

        if (nodeA.kind !== nodeB.kind) {
            // console.log(`[AST Compare] Kind mismatch: ${ts.SyntaxKind[nodeA.kind]} vs ${ts.SyntaxKind[nodeB.kind]}`);
            return false;
        }

        // Пропускаем сравнение для узлов, которые не влияют на семантику в нашем контексте
        // (например, JSDoc комментарии, если бы они были обычными узлами).
        // ts.isJSDoc... функции проверяют тип узла, не его наличие как JSDoc для другого узла.
        // Комментарии (trivia) обрабатываются парсером отдельно и обычно не являются частью основного дерева узлов,
        // которые мы получаем через node.getChildren() или специфичные свойства узлов.
        // Поэтому явное игнорирование комментариев здесь обычно не требуется, если мы сравниваем только "структурные" свойства.

        switch (nodeA.kind) {
            // --- Простые узлы (Листья AST) ---
            case ts.SyntaxKind.Identifier:
                return (nodeA as ts.Identifier).text === (nodeB as ts.Identifier).text;
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NumericLiteral:
            case ts.SyntaxKind.RegularExpressionLiteral: // Добавим регекс литералы
                // .text содержит значение "как есть"
                return (nodeA as ts.LiteralLikeNode).text === (nodeB as ts.LiteralLikeNode).text;
            case ts.SyntaxKind.TrueKeyword:
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.NullKeyword:
            case ts.SyntaxKind.ThisKeyword:
            case ts.SyntaxKind.SuperKeyword:
                return true; // Если kind совпал, они равны

            // --- Составные узлы ---
            case ts.SyntaxKind.VariableDeclaration: {
                const varDeclA = nodeA as ts.VariableDeclaration;
                const varDeclB = nodeB as ts.VariableDeclaration;
                if (!this.areNodesBasicallyEqual(varDeclA.name, varDeclB.name, sourceFileA, sourceFileB)) return false;
                // TODO: Сравнение типа (varDeclA.type) - пока пропускаем для простоты
                // Сравниваем инициализатор (важно, что оба либо есть, либо нет)
                if (!!varDeclA.initializer !== !!varDeclB.initializer) return false;
                if (varDeclA.initializer && !this.areNodesBasicallyEqual(varDeclA.initializer, varDeclB.initializer, sourceFileA, sourceFileB)) return false;
                return true;
            }
            case ts.SyntaxKind.VariableDeclarationList: {
                const listA = nodeA as ts.VariableDeclarationList;
                const listB = nodeB as ts.VariableDeclarationList;
                // TODO: Сравнение флагов (let, const, var) - listA.flags
                if (listA.declarations.length !== listB.declarations.length) return false;
                for (let i = 0; i < listA.declarations.length; i++) {
                    if (!this.areNodesBasicallyEqual(listA.declarations[i], listB.declarations[i], sourceFileA, sourceFileB)) return false;
                }
                return true;
            }
            case ts.SyntaxKind.VariableStatement: {
                const stmtA = nodeA as ts.VariableStatement;
                const stmtB = nodeB as ts.VariableStatement;
                // TODO: Сравнение модификаторов (export, etc.) - stmtA.modifiers
                return this.areNodesBasicallyEqual(stmtA.declarationList, stmtB.declarationList, sourceFileA, sourceFileB);
            }

            case ts.SyntaxKind.ExpressionStatement: {
                const exprStmtA = nodeA as ts.ExpressionStatement;
                const exprStmtB = nodeB as ts.ExpressionStatement;
                return this.areNodesBasicallyEqual(exprStmtA.expression, exprStmtB.expression, sourceFileA, sourceFileB);
            }

            case ts.SyntaxKind.CallExpression: {
                const callA = nodeA as ts.CallExpression;
                const callB = nodeB as ts.CallExpression;
                if (!this.areNodesBasicallyEqual(callA.expression, callB.expression, sourceFileA, sourceFileB)) return false;
                // TODO: Сравнение typeArguments (дженерики)
                if (callA.arguments.length !== callB.arguments.length) return false;
                for (let i = 0; i < callA.arguments.length; i++) {
                    if (!this.areNodesBasicallyEqual(callA.arguments[i], callB.arguments[i], sourceFileA, sourceFileB)) return false;
                }
                return true;
            }
            
            case ts.SyntaxKind.PropertyAccessExpression: {
                const paeA = nodeA as ts.PropertyAccessExpression;
                const paeB = nodeB as ts.PropertyAccessExpression;
                if (!this.areNodesBasicallyEqual(paeA.expression, paeB.expression, sourceFileA, sourceFileB)) return false;
                return this.areNodesBasicallyEqual(paeA.name, paeB.name, sourceFileA, sourceFileB); // paeA.name это Identifier
            }

            case ts.SyntaxKind.Parameter: { // Параметр функции
                const paramA = nodeA as ts.ParameterDeclaration;
                const paramB = nodeB as ts.ParameterDeclaration;
                // Сравниваем имя параметра
                if (!this.areNodesBasicallyEqual(paramA.name, paramB.name, sourceFileA, sourceFileB)) return false;
                // TODO: Сравнение типа параметра (paramA.type)
                // TODO: Сравнение инициализатора по умолчанию (paramA.initializer)
                // TODO: Сравнение rest параметра (paramA.dotDotDotToken)
                // TODO: Сравнение модификаторов (public, private, readonly)
                return true; // Пока упрощенно
            }

            case ts.SyntaxKind.FunctionDeclaration: {
                const funcA = nodeA as ts.FunctionDeclaration;
                const funcB = nodeB as ts.FunctionDeclaration;
                // TODO: Сравнение модификаторов (async, export)
                // Сравниваем имя (может быть undefined для анонимных, но для Declaration обычно есть)
                if (!this.areNodesBasicallyEqual(funcA.name, funcB.name, sourceFileA, sourceFileB)) return false;
                // TODO: Сравнение typeParameters (дженерики)
                // Сравниваем параметры
                if (funcA.parameters.length !== funcB.parameters.length) return false;
                for (let i = 0; i < funcA.parameters.length; i++) {
                    if (!this.areNodesBasicallyEqual(funcA.parameters[i], funcB.parameters[i], sourceFileA, sourceFileB)) return false;
                }
                // TODO: Сравнение возвращаемого типа (funcA.type)
                // Сравниваем тело функции
                if (!!funcA.body !== !!funcB.body) return false;
                if (funcA.body && !this.areNodesBasicallyEqual(funcA.body, funcB.body, sourceFileA, sourceFileB)) return false;
                return true;
            }
            
            case ts.SyntaxKind.Block: {
                const blockA = nodeA as ts.Block;
                const blockB = nodeB as ts.Block;
                if (blockA.statements.length !== blockB.statements.length) return false;
                for (let i = 0; i < blockA.statements.length; i++) {
                    if (!this.areNodesBasicallyEqual(blockA.statements[i], blockB.statements[i], sourceFileA, sourceFileB)) return false;
                }
                return true;
            }
            
            // Добавляем сюда другие SyntaxKind по мере необходимости...

            default:
                // Для узлов, для которых нет явной логики сравнения,
                // проверим, есть ли у них вообще дочерние узлы, которые нужно сравнивать.
                // Это очень грубое приближение.
                const childrenA = nodeA.getChildren(sourceFileA);
                const childrenB = nodeB.getChildren(sourceFileB);

                if (childrenA.length === 0 && childrenB.length === 0) {
                    // Если дочерних узлов нет, и kind совпал, считаем их равными
                    // (например, для ThisKeyword, NullKeyword и т.д., которые уже обработаны выше,
                    // или для других простых токенов)
                    return true;
                }
                // Если есть дочерние узлы, но нет явной логики сравнения,
                // для строгости лучше вернуть false.
                // Либо нужно реализовать универсальное сравнение всех дочерних узлов.
                // console.warn(`[AST Compare] Kind ${ts.SyntaxKind[nodeA.kind]} matched, but it's a composite node or has unhandled specific properties. Strict comparison would return false here.`);
                // Пока оставим true для постепенного расширения, но это источник ложных срабатываний.
                // Для более точного поведения здесь можно попытаться сравнить всех детей:
                if (childrenA.length !== childrenB.length) return false;
                for (let i = 0; i < childrenA.length; i++) {
                    // Пропускаем SyntaxList, так как его содержимое уже сравнивается через свойства родителя
                    // (например, block.statements, call.arguments)
                    if (childrenA[i].kind === ts.SyntaxKind.SyntaxList || childrenB[i].kind === ts.SyntaxKind.SyntaxList) {
                        continue;
                    }
                    if (!this.areNodesBasicallyEqual(childrenA[i], childrenB[i], sourceFileA, sourceFileB)) return false;
                }
                return true;
        }
    }

    private highlightTextInEditor(textToFindFromWebview: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Highlighting text (AST-based). Editor active:', !!editor);

        if (!editor) {
            this.clearHighlights();
            return;
        }
        const trimmedTextToFind = textToFindFromWebview.trim();
        if (!trimmedTextToFind) {
            console.log('[CodeReplacerTS AST] textToFindFromWebview is empty or whitespace. Clearing highlights.');
            this.clearHighlights();
            return;
        }

        const decorationsArray: vscode.DecorationOptions[] = [];
        let astMatchCount = 0;

        try {
            const findSourceFile = ts.createSourceFile('findFragment.ts', trimmedTextToFind, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
            const findStatements = Array.from(findSourceFile.statements);

            if (findStatements.length === 0) {
                console.log('[CodeReplacerTS AST] No statements parsed from findText. Clearing highlights.');
                this.clearHighlights();
                editor.setDecorations(findDecorationType, []);
                return;
            }

            const findNodeToMatch = findStatements[0]; // ---- УПРОЩЕНИЕ: Берем только первый стейтмент ----
            console.log(`[CodeReplacerTS AST] Attempting to match first statement from webview: Kind=${ts.SyntaxKind[findNodeToMatch.kind]}`);

            const documentText = editor.document.getText();
            const documentSourceFile = ts.createSourceFile(editor.document.fileName, documentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

            const visit = (nodeInDocument: ts.Node) => {
                if (this.areNodesBasicallyEqual(nodeInDocument, findNodeToMatch, documentSourceFile, findSourceFile)) {
                    astMatchCount++;
                    const start = nodeInDocument.getStart(documentSourceFile);
                    const end = nodeInDocument.getEnd();
                    const startPos = editor.document.positionAt(start);
                    const endPos = editor.document.positionAt(end);
                    decorationsArray.push({
                        range: new vscode.Range(startPos, endPos),
                        hoverMessage: 'Найденный AST-фрагмент (улучшенное совпадение)'
                    });
                }
                ts.forEachChild(nodeInDocument, visit);
            };
            ts.forEachChild(documentSourceFile, visit);
            console.log(`[CodeReplacerTS AST] Found ${astMatchCount} AST-based matches.`);
        } catch (error) {
            console.error("[CodeReplacerTS AST] Error during AST processing for highlight:", error);
            if (error instanceof SyntaxError) {
                 vscode.window.showErrorMessage(`Ошибка синтаксиса в коде для поиска: ${error.message}`);
            } else if (error && typeof (error as any).message === 'string') {
                 vscode.window.showErrorMessage(`Ошибка при AST-анализе: ${(error as any).message}`);
            } else {
                 vscode.window.showErrorMessage("Произошла ошибка при AST-анализе кода для подсветки.");
            }
            this.clearHighlights();
        } finally {
            editor.setDecorations(findDecorationType, decorationsArray);
        }
    }

    private clearHighlights() {
        // ... (без изменений) ...
        const editor = vscode.window.activeTextEditor;
        if (editor && findDecorationType) {
            editor.setDecorations(findDecorationType, []);
            console.log('[CodeReplacerTS] Highlights cleared by provider.');
        }
    }

    // TODO: Заменить эту функцию на AST-логику
    private async replaceTextInEditor_WithStringLogic(findTextFromWebview: string, replaceTextFromWebview: string) {
        // ... (без изменений, все еще строковая логика) ...
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Applying replace (current: string-based). Editor active:', !!editor);
        const normalizedFindText = normalizeText(findTextFromWebview); 
        const replaceText = replaceTextFromWebview;

        if (normalizedFindText.length === 0) {
            if (findTextFromWebview.length > 0) {
                vscode.window.showInformationMessage('Текст для поиска стал пустым после удаления пробелов. Замена не выполнена.');
            } else {
                vscode.window.showInformationMessage('Поле "Код для поиска" не должно быть пустым.');
            }
            return;
        }
        if (!editor) {
            vscode.window.showErrorMessage('Нет активного текстового редактора для замены.');
            return;
        }
        const document = editor.document;
        const originalDocumentText = document.getText();
        const normalizedDocumentText = normalizeText(originalDocumentText, false); 
        const firstOccurrenceIndexNormalized = normalizedDocumentText.indexOf(normalizedFindText);
        console.log('[CodeReplacerTS String Logic] indexOf for replacement (on normalized text) returned:', firstOccurrenceIndexNormalized);

        if (firstOccurrenceIndexNormalized === -1) {
            vscode.window.showInformationMessage(`Нормализованный код для поиска не найден в документе (строковый поиск).`);
            this.clearHighlights(); 
            return;
        }
        const originalStartIndex = this.getOriginalIndex(originalDocumentText, normalizedDocumentText, firstOccurrenceIndexNormalized);
        const originalEndIndex = this.getOriginalIndex(originalDocumentText, normalizedDocumentText, firstOccurrenceIndexNormalized + normalizedFindText.length);
        const rangeToReplace = new vscode.Range(
            document.positionAt(originalStartIndex),
            document.positionAt(originalEndIndex)
        );
        const success = await editor.edit(editBuilder => {
            editBuilder.replace(rangeToReplace, replaceText);
        });
        if (success) {
            console.log('[CodeReplacerTS String Logic] Text replaced successfully. Saving document...');
            await document.save();
            vscode.window.showInformationMessage('Код успешно заменен и файл сохранен (строковая замена)!');
            this.clearHighlights();
        } else {
            vscode.window.showErrorMessage('Не удалось выполнить замену текста (строковая замена).');
        }
    }

    private getOriginalIndex(originalText: string, normalizedText: string, normalizedIndex: number): number {
        // ... (без изменений, все еще упрощенная и потенциально неточная) ...
        if (originalText === normalizedText) { 
            return normalizedIndex;
        }
        let finalOriginalIndex = 0;
        let currentNormalizedCount = 0;
        for(let i=0; i < originalText.length; i++) {
            if (currentNormalizedCount === normalizedIndex) {
                finalOriginalIndex = i;
                break;
            }
            if (originalText[i] === '\r' && originalText[i+1] === '\n') { /* \r пропускается */ }
            else if (originalText[i] === '\r') { /* одиночный \r пропускается */ }
            else { currentNormalizedCount++; }

            if (i === originalText.length - 1 && currentNormalizedCount <= normalizedIndex) {
                finalOriginalIndex = originalText.length;
            }
        }
         if (normalizedIndex === normalizedText.length) return originalText.length;
        return finalOriginalIndex;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // ... (без изменений) ...
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
    // ... (без изменений) ...
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {
    // ... (без изменений) ...
    console.log('[CodeReplacerTS] Extension "codereplacer" is now deactivated.');
    if (findDecorationType) {
        findDecorationType.dispose();
    }
}
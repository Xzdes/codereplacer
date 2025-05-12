// --- ПОЛНЫЙ ФАЙЛ src/extension.ts (Версия 5 - Полная, без сокращений) ---

import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as crypto from 'crypto';

// --- Global State ---
let findDecorationType: vscode.TextEditorDecorationType;
let matchedASTRanges: vscode.Range[] = [];

// --- ВАЖНО: ОБНОВИТЕ ВЕРСИЮ TypeScript! ---
// Ошибка 'getSyntacticDiagnostics does not exist' означает,
// что ваша версия TypeScript в package.json СЛИШКОМ СТАРАЯ.
// Установите ^4.0.0 или новее и выполните `npm install`.
// -----------------------------------------

// --- AST Helper ---
function parseCodeToASTStatements(code: string, fileName: string = 'tempFile.ts'): ts.Statement[] {
    const sourceFile = ts.createSourceFile(
        fileName,
        code,
        ts.ScriptTarget.Latest,
        true, // setParentNodes
        ts.ScriptKind.TSX // Parse as TSX
    );

    // --- ИЗМЕНЕНИЕ: Используем getPreEmitDiagnostics как ОБХОДНОЙ ПУТЬ для старых версий TS ---
    // ПРЕДУПРЕЖДЕНИЕ: Этот метод МЕНЕЕ эффективен, если нужна только проверка синтаксиса,
    // и требует создания временной 'Program'.
    // НАСТОЯТЕЛЬНО РЕКОМЕНДУЕТСЯ ОБНОВИТЬ ВЕРСИЮ TypeScript в package.json!
    let diagnostics: readonly ts.Diagnostic[] = [];
    try {
        // Создаем минимальную программу для получения диагностик
        const program = ts.createProgram([fileName], { noEmit: true }, undefined, undefined, undefined);
        // Получаем все диагностики (синтаксис + семантика, если получится)
        diagnostics = ts.getPreEmitDiagnostics(program, sourceFile);
    } catch (programError) {
        console.error("[CodeReplacerTS] Error creating temporary program for diagnostics:", programError);
        // Если создание программы не удалось, просто вернем пустой массив диагностик
        diagnostics = [];
    }
    // --- КОНЕЦ ИЗМЕНЕНИЯ ---


    if (diagnostics.length > 0) {
        // Указываем тип для diag
        const errors = diagnostics.map((diag: ts.Diagnostic) => {
            let message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
            if (diag.file && diag.start !== undefined) {
                try {
                    // Используем getLineAndCharacterOfPosition от исходного файла, не из программы
                    const { line, character } = sourceFile.getLineAndCharacterOfPosition(diag.start);
                     // Имя файла лучше брать из diag.file, если оно есть
                    const diagnosticFileName = diag.file ? diag.file.fileName : fileName;
                    message = `${diagnosticFileName} (${line + 1},${character + 1}): ${message}`;
                } catch (e) {
                    // Ошибка получения позиции может случиться, если diag.start некорректен
                    console.warn("Could not get diagnostic position:", e instanceof Error ? e.message : String(e));
                }
            }
            return message;
        }).join('\n');
        console.warn(`[CodeReplacerTS] AST Parsing Diagnostics for ${fileName}:\n${errors}`);
    }
    return Array.from(sourceFile.statements);
} // Конец функции parseCodeToASTStatements


// --- Normalization Helper ---
function normalizeText(text: string, trimEdges: boolean = true): string {
    let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (trimEdges) { normalized = normalized.trim(); }
    return normalized;
}

// --- Nonce Helper ---
function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

// --- Activation ---
export function activate(context: vscode.ExtensionContext) {
    console.log('[CodeReplacerTS] Extension "codereplacer" is now active!');

    findDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 255, 0, 0.3)',
        border: '1px solid rgba(200, 200, 0, 0.5)',
        isWholeLine: false
    });
    context.subscriptions.push(findDecorationType);

    const provider = new CodeReplacerViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CodeReplacerViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );
    console.log('[CodeReplacerTS] CodeReplacerViewProvider registered.');

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (provider) { provider.clearHighlights(undefined); }
        })
    );
}

// --- Webview Provider ---
class CodeReplacerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codereplacer.view';
    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;

    constructor(private readonly extensionUriValue: vscode.Uri) {
        this._extensionUri = extensionUriValue;
    }

    // --- resolveWebviewView ---
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        console.log('[CodeReplacerTS] HTML content set for WebviewView.');

        webviewView.webview.onDidReceiveMessage(async (message: { command: string; text?: string; findText?: string; replaceText?: string }) => {
            console.log('[CodeReplacerTS] Provider received message:', message.command);
            switch (message.command) {
                case 'findText':
                    if (typeof message.text === 'string') { this.highlightTextInEditor(message.text); }
                    break;
                case 'applyReplace':
                    if (typeof message.replaceText === 'string') { await this.replaceFoundMatches(message.replaceText); }
                    else { vscode.window.showWarningMessage('Replace text was not provided.'); }
                    break;
                case 'alert':
                    if (typeof message.text === 'string') { vscode.window.showInformationMessage(message.text); }
                    break;
                default:
                     console.warn("[CodeReplacerTS] Received unknown command:", message.command)
            }
        });

        webviewView.onDidDispose(() => {
            console.log('[CodeReplacerTS] WebviewView disposed.');
            this.clearHighlights();
            this._view = undefined;
        });
    }


    // --- Core AST Comparison Logic ---
    private areNodesBasicallyEqual(
        nodeA: ts.Node | undefined,
        nodeB: ts.Node | undefined,
        sourceFileA: ts.SourceFile | undefined,
        sourceFileB: ts.SourceFile | undefined,
        depth = 0,
        ignoreIdentifiers: boolean = false
    ): boolean {
        if (!nodeA && !nodeB) return true;
        if (!nodeA || !nodeB) return false;
        if (nodeA.kind !== nodeB.kind) return false;

        switch (nodeA.kind) {
            case ts.SyntaxKind.Identifier:
                if (ignoreIdentifiers) return true;
                return (nodeA as ts.Identifier).text === (nodeB as ts.Identifier).text;

            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NumericLiteral:
            case ts.SyntaxKind.RegularExpressionLiteral:
            case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
                 return (nodeA as ts.LiteralLikeNode).text === (nodeB as ts.LiteralLikeNode).text;

            case ts.SyntaxKind.TrueKeyword:
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.NullKeyword:
            case ts.SyntaxKind.UndefinedKeyword:
            case ts.SyntaxKind.ThisKeyword:
            case ts.SyntaxKind.SuperKeyword:
            case ts.SyntaxKind.VoidKeyword:
            case ts.SyntaxKind.ExportKeyword:
            case ts.SyntaxKind.StaticKeyword:
            case ts.SyntaxKind.AsyncKeyword:
            case ts.SyntaxKind.PublicKeyword:
            case ts.SyntaxKind.PrivateKeyword:
            case ts.SyntaxKind.ProtectedKeyword:
            case ts.SyntaxKind.ReadonlyKeyword:
                return true; // Kind match is sufficient

            case ts.SyntaxKind.VariableDeclaration: {
                const varDeclA = nodeA as ts.VariableDeclaration;
                const varDeclB = nodeB as ts.VariableDeclaration;
                if (!this.areNodesBasicallyEqual(varDeclA.name, varDeclB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!this.areNodesBasicallyEqual(varDeclA.type, varDeclB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!this.areNodesBasicallyEqual(varDeclA.exclamationToken, varDeclB.exclamationToken, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!this.areNodesBasicallyEqual(varDeclA.initializer, varDeclB.initializer, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                break;
            }
            case ts.SyntaxKind.VariableDeclarationList: {
                 const listA = nodeA as ts.VariableDeclarationList;
                 const listB = nodeB as ts.VariableDeclarationList;
                 if (listA.flags !== listB.flags) return false;
                 if (!this.compareNodeArrays(listA.declarations, listB.declarations, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 break;
            }
            case ts.SyntaxKind.VariableStatement: {
                const stmtA = nodeA as ts.VariableStatement;
                const stmtB = nodeB as ts.VariableStatement;
                const decoratorsA = ts.canHaveDecorators(stmtA) ? ts.getDecorators(stmtA) : undefined;
                const decoratorsB = ts.canHaveDecorators(stmtB) ? ts.getDecorators(stmtB) : undefined;
                if (!this.compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                // УТВЕРЖДЕНИЕ ТИПА ДЛЯ ИСПРАВЛЕНИЯ ОШИБКИ
                const modifiersOnlyA = (stmtA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
                const modifiersOnlyB = (stmtB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
                if (!this.compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
                if (!this.areNodesBasicallyEqual(stmtA.declarationList, stmtB.declarationList, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                break;
            }
             case ts.SyntaxKind.ExpressionStatement: {
                 const exprStmtA = nodeA as ts.ExpressionStatement;
                 const exprStmtB = nodeB as ts.ExpressionStatement;
                 if (!this.areNodesBasicallyEqual(exprStmtA.expression, exprStmtB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 break;
             }
            case ts.SyntaxKind.CallExpression: case ts.SyntaxKind.NewExpression: {
                 const callA = nodeA as ts.CallExpression | ts.NewExpression;
                 const callB = nodeB as ts.CallExpression | ts.NewExpression;
                 if (!this.areNodesBasicallyEqual(callA.expression, callB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 if (!this.compareNodeArrays(callA.typeArguments, callB.typeArguments, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 if (!this.compareNodeArrays(callA.arguments, callB.arguments, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 break;
            }
            case ts.SyntaxKind.PropertyAccessExpression: case ts.SyntaxKind.ElementAccessExpression: {
                const accessA = nodeA as ts.PropertyAccessExpression | ts.ElementAccessExpression;
                const accessB = nodeB as ts.PropertyAccessExpression | ts.ElementAccessExpression;
                if (!this.areNodesBasicallyEqual(accessA.expression, accessB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                const nameOrArgA = ts.isPropertyAccessExpression(accessA) ? accessA.name : accessA.argumentExpression;
                const nameOrArgB = ts.isPropertyAccessExpression(accessB) ? accessB.name : accessB.argumentExpression;
                 if (!this.areNodesBasicallyEqual(nameOrArgA, nameOrArgB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 if (!!accessA.questionDotToken !== !!accessB.questionDotToken) return false;
                 break;
            }
            case ts.SyntaxKind.Parameter: {
                const paramA = nodeA as ts.ParameterDeclaration;
                const paramB = nodeB as ts.ParameterDeclaration;
                const decoratorsA = ts.canHaveDecorators(paramA) ? ts.getDecorators(paramA) : undefined;
                const decoratorsB = ts.canHaveDecorators(paramB) ? ts.getDecorators(paramB) : undefined;
                if (!this.compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 // УТВЕРЖДЕНИЕ ТИПА ДЛЯ ИСПРАВЛЕНИЯ ОШИБКИ
                const modifiersOnlyA = (paramA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
                const modifiersOnlyB = (paramB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
                if (!this.compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
                if (!!paramA.dotDotDotToken !== !!paramB.dotDotDotToken) return false;
                if (!this.areNodesBasicallyEqual(paramA.name, paramB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!!paramA.questionToken !== !!paramB.questionToken) return false;
                if (!this.areNodesBasicallyEqual(paramA.type, paramB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!this.areNodesBasicallyEqual(paramA.initializer, paramB.initializer, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                break;
            }
            case ts.SyntaxKind.FunctionDeclaration: case ts.SyntaxKind.MethodDeclaration: case ts.SyntaxKind.Constructor:
            case ts.SyntaxKind.ArrowFunction: case ts.SyntaxKind.FunctionExpression: case ts.SyntaxKind.GetAccessor:
            case ts.SyntaxKind.SetAccessor:
                {
                const funcA = nodeA as ts.FunctionLikeDeclaration;
                const funcB = nodeB as ts.FunctionLikeDeclaration;
                const decoratorsA = ts.canHaveDecorators(funcA) ? ts.getDecorators(funcA) : undefined;
                const decoratorsB = ts.canHaveDecorators(funcB) ? ts.getDecorators(funcB) : undefined;
                if (!this.compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 // УТВЕРЖДЕНИЕ ТИПА ДЛЯ ИСПРАВЛЕНИЯ ОШИБКИ
                const modifiersOnlyA = (funcA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
                const modifiersOnlyB = (funcB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
                if (!this.compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
                if (!!funcA.asteriskToken !== !!funcB.asteriskToken) return false;
                if (!this.areNodesBasicallyEqual(funcA.name, funcB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!this.compareNodeArrays(funcA.typeParameters, funcB.typeParameters, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!this.compareNodeArrays(funcA.parameters, funcB.parameters, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!this.areNodesBasicallyEqual(funcA.type, funcB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                if (!this.areNodesBasicallyEqual(funcA.body, funcB.body, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                break;
            }
            case ts.SyntaxKind.Block: {
                const blockA = nodeA as ts.Block;
                const blockB = nodeB as ts.Block;
                 if (!this.compareNodeArrays(blockA.statements, blockB.statements, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 break;
            }
            case ts.SyntaxKind.IfStatement: {
                const ifA = nodeA as ts.IfStatement;
                const ifB = nodeB as ts.IfStatement;
                 if (!this.areNodesBasicallyEqual(ifA.expression, ifB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 if (!this.areNodesBasicallyEqual(ifA.thenStatement, ifB.thenStatement, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 if (!this.areNodesBasicallyEqual(ifA.elseStatement, ifB.elseStatement, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 break;
            }
             case ts.SyntaxKind.BinaryExpression: {
                const binA = nodeA as ts.BinaryExpression;
                const binB = nodeB as ts.BinaryExpression;
                 if (binA.operatorToken.kind !== binB.operatorToken.kind) return false;
                 if (!this.areNodesBasicallyEqual(binA.left, binB.left, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 if (!this.areNodesBasicallyEqual(binA.right, binB.right, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 break;
             }
            case ts.SyntaxKind.PrefixUnaryExpression: case ts.SyntaxKind.PostfixUnaryExpression: {
                 const unaryA = nodeA as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
                 const unaryB = nodeB as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
                 if (unaryA.operator !== unaryB.operator) return false;
                 if (!this.areNodesBasicallyEqual(unaryA.operand, unaryB.operand, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 break;
            }
            case ts.SyntaxKind.ParenthesizedExpression: {
                 const parenA = nodeA as ts.ParenthesizedExpression;
                 const parenB = nodeB as ts.ParenthesizedExpression;
                 if (!this.areNodesBasicallyEqual(parenA.expression, parenB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
                 break;
            }
            // --- Добавьте другие cases по необходимости ---
            case ts.SyntaxKind.ForStatement:
            case ts.SyntaxKind.WhileStatement:
            case ts.SyntaxKind.DoStatement:
            case ts.SyntaxKind.SwitchStatement:
            case ts.SyntaxKind.CaseClause:
            case ts.SyntaxKind.DefaultClause:
            case ts.SyntaxKind.TryStatement:
            case ts.SyntaxKind.CatchClause:
            case ts.SyntaxKind.ReturnStatement:
            case ts.SyntaxKind.ThrowStatement:
            case ts.SyntaxKind.BreakStatement:
            case ts.SyntaxKind.ContinueStatement:
            case ts.SyntaxKind.ClassDeclaration:
            case ts.SyntaxKind.InterfaceDeclaration:
            case ts.SyntaxKind.EnumDeclaration:
            case ts.SyntaxKind.TypeAliasDeclaration:
            case ts.SyntaxKind.ImportDeclaration:
            case ts.SyntaxKind.ExportDeclaration:
            case ts.SyntaxKind.ObjectLiteralExpression:
            case ts.SyntaxKind.ArrayLiteralExpression:
            case ts.SyntaxKind.PropertyAssignment:
            case ts.SyntaxKind.ShorthandPropertyAssignment:
            case ts.SyntaxKind.ComputedPropertyName:
            case ts.SyntaxKind.ConditionalExpression:
            case ts.SyntaxKind.TemplateExpression:
            case ts.SyntaxKind.TemplateHead:
            case ts.SyntaxKind.TemplateMiddle:
            case ts.SyntaxKind.TemplateTail:
            case ts.SyntaxKind.TemplateSpan:
            case ts.SyntaxKind.JsxElement:
            case ts.SyntaxKind.JsxSelfClosingElement:
            case ts.SyntaxKind.JsxOpeningElement:
            case ts.SyntaxKind.JsxClosingElement:
            case ts.SyntaxKind.JsxAttribute:
            case ts.SyntaxKind.JsxSpreadAttribute:
            case ts.SyntaxKind.JsxExpression:
                // Fall through to default for now

            // --- default case (Сравнение дочерних узлов) ---
            default:
                const childrenA = nodeA.getChildren(sourceFileA);
                const childrenB = nodeB.getChildren(sourceFileB);
                const significantChildrenA = childrenA.filter(n => !this.isTriviaNode(n));
                const significantChildrenB = childrenB.filter(n => !this.isTriviaNode(n));
                if (significantChildrenA.length !== significantChildrenB.length) {
                    return false;
                }
                for (let i = 0; i < significantChildrenA.length; i++) {
                    if (!this.areNodesBasicallyEqual(significantChildrenA[i], significantChildrenB[i], sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) {
                         return false;
                    }
                }
                break;
        }
        // Если все проверки для данного типа узла прошли
        return true;
    }

    // Helper: Сравнение массивов узлов
    private compareNodeArrays(
        arrA: readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined,
        arrB: readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined,
        sourceFileA: ts.SourceFile | undefined,
        sourceFileB: ts.SourceFile | undefined,
        depth: number,
        ignoreIdentifiers: boolean
    ): boolean {
        const listA = arrA || [];
        const listB = arrB || [];
        if (listA.length !== listB.length) return false;
        for (let i = 0; i < listA.length; i++) {
            if (!this.areNodesBasicallyEqual(listA[i], listB[i], sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) {
                return false;
            }
        }
        return true;
    }

     // Helper: Сравнение ТОЛЬКО модификаторов
     private compareModifiers(modA: readonly ts.Modifier[] | undefined, modB: readonly ts.Modifier[] | undefined): boolean {
         const modsAKinds = modA ? modA.map(m => m.kind).sort() : [];
         const modsBKinds = modB ? modB.map(m => m.kind).sort() : [];
         if (modsAKinds.length !== modsBKinds.length) return false;
         for (let i = 0; i < modsAKinds.length; i++) {
             if (modsAKinds[i] !== modsBKinds[i]) return false;
         }
         return true;
     }

      // Helper: Проверка на узел-тривию
    private isTriviaNode(node: ts.Node): boolean {
        return node.kind === ts.SyntaxKind.SingleLineCommentTrivia ||
               node.kind === ts.SyntaxKind.MultiLineCommentTrivia ||
               (node.kind === ts.SyntaxKind.SyntaxList && node.getChildCount() === 0);
    }


    // --- Логика подсветки ---
    private highlightTextInEditor(textToFindFromWebview: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Highlighting text (AST-based)... Editor active:', !!editor);
        this.clearHighlights();

        if (!editor) {
            console.log('[CodeReplacerTS] No active editor.');
            return;
        }
        const trimmedTextToFind = textToFindFromWebview.trim();
        if (!trimmedTextToFind) {
            console.log('[CodeReplacerTS AST] Find text is empty.');
            return;
        }

        const decorationsArray: vscode.DecorationOptions[] = [];
        let findSourceFile: ts.SourceFile;
        let findStatements: ts.Statement[];
        let localMatchedRanges: vscode.Range[] = [];

        try {
            findStatements = parseCodeToASTStatements(trimmedTextToFind, 'findFragment.ts');
            findSourceFile = ts.createSourceFile('findFragment.ts', trimmedTextToFind, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

            if (findStatements.length === 0) {
                console.log('[CodeReplacerTS AST] No statements parsed from find text.');
                return;
            }
            if (findStatements.length > 1) {
                console.warn(`[CodeReplacerTS AST] WARNING: Matching only the FIRST statement.`);
                 vscode.window.showWarningMessage('Search currently works only for the first statement/expression.');
            }
            const findNodeToMatch = findStatements[0];
            console.log(`[CodeReplacerTS AST] Attempting to match AST node Kind: ${ts.SyntaxKind[findNodeToMatch.kind]}`);

            const document = editor.document;
            const documentText = document.getText();
            const documentSourceFile = ts.createSourceFile(document.fileName, documentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

            const visit = (nodeInDocument: ts.Node) => {
                if (this.areNodesBasicallyEqual(nodeInDocument, findNodeToMatch, documentSourceFile, findSourceFile, 0)) {
                    console.log(`[AST Match FOUND] Node Kind: ${ts.SyntaxKind[nodeInDocument.kind]} at pos ${nodeInDocument.getStart(documentSourceFile)}`);
                    try {
                        const start = nodeInDocument.getStart(documentSourceFile);
                        const end = nodeInDocument.getEnd();
                        const startPos = document.positionAt(start);
                        const endPos = document.positionAt(end);
                        const range = new vscode.Range(startPos, endPos);
                        decorationsArray.push({ range, hoverMessage: 'AST Match' });
                        localMatchedRanges.push(range);
                    } catch (rangeError: any) {
                         console.error(`[CodeReplacerTS AST] Error calculating range:`, rangeError.message);
                    }
                }
                ts.forEachChild(nodeInDocument, visit);
            };

            console.log(`[CodeReplacerTS AST] Starting traversal of: ${document.fileName}`);
            ts.forEachChild(documentSourceFile, visit);

            matchedASTRanges = localMatchedRanges; // Обновляем глобальное состояние
            console.log(`[CodeReplacerTS AST] Found ${matchedASTRanges.length} match(es). Applying decorations.`);

            if (matchedASTRanges.length === 0 && trimmedTextToFind.length > 0) {
                 vscode.window.showInformationMessage('No matching code structures found.');
            }

        } catch (error: any) {
            console.error("[CodeReplacerTS AST] Error during highlight:", error);
            vscode.window.showErrorMessage(`AST Analysis Error: ${error.message || 'Unknown error'}`);
            this.clearHighlights();
        } finally {
            // Применяем декорации в любом случае (даже пустые, чтобы очистить старые)
            if (editor && findDecorationType) { // Доп. проверка на случай закрытия редактора
                editor.setDecorations(findDecorationType, decorationsArray);
            }
        }
    }

    // --- Логика замены ---
    private async replaceFoundMatches(replaceText: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Applying replace...');

        if (!editor) {
            vscode.window.showErrorMessage('No active editor.');
            return;
        }
        if (matchedASTRanges.length === 0) {
            vscode.window.showInformationMessage('No matches stored. Please find first.');
            return;
        }

        // Сортируем диапазоны в ОБРАТНОМ порядке для корректной замены
        const sortedRanges = [...matchedASTRanges].sort((a, b) => b.start.compareTo(a.start));
        const originalRangesCount = sortedRanges.length;

        try {
            // Выполняем все замены одной операцией редактирования
            const success = await editor.edit(editBuilder => {
                sortedRanges.forEach(range => editBuilder.replace(range, replaceText));
            }, { undoStopBefore: true, undoStopAfter: true }); // Группируем в один шаг отмены

            if (success) {
                console.log(`[CodeReplacerTS] ${originalRangesCount} match(es) replaced.`);
                vscode.window.showInformationMessage(`Replacement successful (${originalRangesCount} matches).`);
                this.clearHighlights(editor); // Очищаем после успешной замены
            } else {
                console.error('[CodeReplacerTS] editor.edit() returned false.');
                vscode.window.showErrorMessage('Replacement failed. Editor modified concurrently?');
                // Не очищаем подсветку, чтобы пользователь видел, где остановились
            }
        } catch (error: any) {
            console.error("[CodeReplacerTS] Error during replace:", error);
            vscode.window.showErrorMessage(`Replacement Error: ${error.message || 'Unknown error'}`);
             // Не очищаем подсветку
        }
    }

    // --- Очистка подсветки ---
    public clearHighlights(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor) {
        if (editor && findDecorationType) {
            editor.setDecorations(findDecorationType, []);
        } else if (!editor) { // Если вызвано без редактора (dispose)
             vscode.window.visibleTextEditors.forEach(visibleEditor => {
                 if (findDecorationType) {
                    visibleEditor.setDecorations(findDecorationType, []);
                 }
             });
        }
        // Всегда очищаем сохраненные диапазоны при очистке подсветки
        if (matchedASTRanges.length > 0) {
             console.log('[CodeReplacerTS] Clearing stored ranges.');
             matchedASTRanges = [];
        }
    }

    // --- Генерация HTML ---
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();
        const stylesPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.css');
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js');
        const stylesUri = webview.asWebviewUri(stylesPath);
        const scriptUri = webview.asWebviewUri(scriptPath);

        // Используем строки шаблона для удобства
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
        img-src ${webview.cspSource} https:;
        connect-src 'self';
    ">
    <link href="${stylesUri}" rel="stylesheet">
    <title>Code Replacer TS</title>
</head>
<body>
    <div class="container">
        <div class="input-group">
            <h2>Code to Find (AST Match):</h2>
            <textarea id="findText" placeholder="Paste code snippet..." rows="8"></textarea>
             <small>Matches structure of the first statement/expression.</small>
        </div>
        <div class="input-group">
            <h2>Replacement Code:</h2>
            <textarea id="replaceText" placeholder="Paste replacement code..." rows="8"></textarea>
        </div>
    </div>
    <div class="button-container">
        <button id="applyButton">Replace Found Matches</button>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

// --- Deactivation ---
export function deactivate() {
    console.log('[CodeReplacerTS] Extension deactivated.');
    if (findDecorationType) {
        findDecorationType.dispose();
    }
    matchedASTRanges = [];
}

// --- КОНЕЦ ФАЙЛА src/extension.ts ---
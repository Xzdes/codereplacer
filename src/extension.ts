// --- ПОЛНЫЙ ФАЙЛ src/extension.ts (Версия 8 - Удалена проверка синтаксиса из-за старого TS) ---

import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as crypto from 'crypto';

// --- Global State ---
let findDecorationType: vscode.TextEditorDecorationType;
let matchedResults: { range: vscode.Range, mode: 'ast' | 'text' }[] = [];

// --- AST Helper (для TS/JS) ---
// ВАЖНО: Удалена проверка синтаксиса входного кода (diagnostics),
// так как используемая версия TypeScript слишком старая и не поддерживает getSyntacticDiagnostics.
// РЕКОМЕНДУЕТСЯ ОБНОВИТЬ ВЕРСИЮ TypeScript в package.json!
function parseCodeToAST(code: string, fileName: string = 'findFragment.ts'): { nodes: ts.Node[], sourceFile: ts.SourceFile } | null {
    try {
        const sourceFile = ts.createSourceFile(
            fileName,
            code,
            ts.ScriptTarget.Latest,
            true, // setParentNodes
            ts.ScriptKind.TSX // Parse as TSX для универсальности с JS/TS/TSX
        );

        // --- БЛОК ДИАГНОСТИКИ ПОЛНОСТЬЮ УДАЛЕН ---

        const statements = Array.from(sourceFile.statements);

        // Логика определения, парсить как выражение или операторы
        if (statements.length === 1) {
            const firstStatement = statements[0];
            if (ts.isExpressionStatement(firstStatement)) {
                if (code.trim().slice(-1) !== ';') {
                     console.log("[CodeReplacerTS AST] Parsed as a single Expression.");
                     return { nodes: [firstStatement.expression], sourceFile };
                }
            }
             console.log(`[CodeReplacerTS AST] Parsed as ${statements.length} Statement(s).`);
             return { nodes: statements, sourceFile };
        } else if (statements.length > 0) {
             console.log(`[CodeReplacerTS AST] Parsed as ${statements.length} Statement(s).`);
             return { nodes: statements, sourceFile };
        } else {
            console.log("[CodeReplacerTS AST] No statements or expressions found in find text.");
            return null;
        }
    } catch (error: any) {
        // Ловим ошибки самого парсера ts.createSourceFile (маловероятно, но возможно)
        console.error("[CodeReplacerTS AST] Error during source file creation:", error);
        vscode.window.showErrorMessage(`Error parsing code to find: ${error.message || 'Unknown error'}`);
        return null;
    }
}


// --- Text Helper (для CSS/HTML/JSON и др.) ---
function normalizeAndCleanText(text: string, languageId: string): string {
    let cleaned = text;
    // Удаляем комментарии
    switch (languageId) {
        case 'css': case 'jsonc': case 'javascript': case 'typescript': case 'less': case 'scss':
            cleaned = cleaned.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''); break;
        case 'json':
             cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, ''); break;
        case 'html': case 'xml': case 'vue':
            cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, ''); break;
        case 'python': case 'ruby': case 'shellscript':
            cleaned = cleaned.replace(/#.*/g, ''); break;
    }
    // Нормализуем пробелы
    return cleaned.replace(/\s+/g, ' ').trim();
}

// --- Normalization Helper (старый, если нужен) ---
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
        backgroundColor: 'rgba(255, 255, 0, 0.3)', border: '1px solid rgba(200, 200, 0, 0.5)', isWholeLine: false
    });
    context.subscriptions.push(findDecorationType);
    const provider = new CodeReplacerViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(CodeReplacerViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );
    console.log('[CodeReplacerTS] CodeReplacerViewProvider registered.');
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
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


    // --- Core AST Comparison Logic (для TS/JS) ---
    private areNodesBasicallyEqual(
        nodeA: ts.Node | undefined, nodeB: ts.Node | undefined, sourceFileA: ts.SourceFile | undefined,
        sourceFileB: ts.SourceFile | undefined, depth = 0, ignoreIdentifiers: boolean = false
    ): boolean {
        if (!nodeA && !nodeB) return true; if (!nodeA || !nodeB) return false; if (nodeA.kind !== nodeB.kind) return false;
        switch (nodeA.kind) {
            case ts.SyntaxKind.Identifier: if (ignoreIdentifiers) return true; return (nodeA as ts.Identifier).text === (nodeB as ts.Identifier).text;
            case ts.SyntaxKind.StringLiteral: case ts.SyntaxKind.NumericLiteral: case ts.SyntaxKind.RegularExpressionLiteral: case ts.SyntaxKind.NoSubstitutionTemplateLiteral: return (nodeA as ts.LiteralLikeNode).text === (nodeB as ts.LiteralLikeNode).text;
            case ts.SyntaxKind.TrueKeyword: case ts.SyntaxKind.FalseKeyword: case ts.SyntaxKind.NullKeyword: case ts.SyntaxKind.UndefinedKeyword: case ts.SyntaxKind.ThisKeyword: case ts.SyntaxKind.SuperKeyword: case ts.SyntaxKind.VoidKeyword: case ts.SyntaxKind.ExportKeyword: case ts.SyntaxKind.StaticKeyword: case ts.SyntaxKind.AsyncKeyword: case ts.SyntaxKind.PublicKeyword: case ts.SyntaxKind.PrivateKeyword: case ts.SyntaxKind.ProtectedKeyword: case ts.SyntaxKind.ReadonlyKeyword: return true;
            case ts.SyntaxKind.VariableDeclaration: { const varDeclA = nodeA as ts.VariableDeclaration; const varDeclB = nodeB as ts.VariableDeclaration; if (!this.areNodesBasicallyEqual(varDeclA.name, varDeclB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(varDeclA.type, varDeclB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(varDeclA.exclamationToken, varDeclB.exclamationToken, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(varDeclA.initializer, varDeclB.initializer, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.VariableDeclarationList: { const listA = nodeA as ts.VariableDeclarationList; const listB = nodeB as ts.VariableDeclarationList; if (listA.flags !== listB.flags) return false; if (!this.compareNodeArrays(listA.declarations, listB.declarations, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.VariableStatement: { const stmtA = nodeA as ts.VariableStatement; const stmtB = nodeB as ts.VariableStatement; const decoratorsA = ts.canHaveDecorators(stmtA) ? ts.getDecorators(stmtA) : undefined; const decoratorsB = ts.canHaveDecorators(stmtB) ? ts.getDecorators(stmtB) : undefined; if (!this.compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; const modifiersOnlyA = (stmtA.modifiers || []).filter(ts.isModifier) as ts.Modifier[]; const modifiersOnlyB = (stmtB.modifiers || []).filter(ts.isModifier) as ts.Modifier[]; if (!this.compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false; if (!this.areNodesBasicallyEqual(stmtA.declarationList, stmtB.declarationList, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.ExpressionStatement: { const exprStmtA = nodeA as ts.ExpressionStatement; const exprStmtB = nodeB as ts.ExpressionStatement; if (!this.areNodesBasicallyEqual(exprStmtA.expression, exprStmtB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.CallExpression: case ts.SyntaxKind.NewExpression: { const callA = nodeA as ts.CallExpression | ts.NewExpression; const callB = nodeB as ts.CallExpression | ts.NewExpression; if (!this.areNodesBasicallyEqual(callA.expression, callB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.compareNodeArrays(callA.typeArguments, callB.typeArguments, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.compareNodeArrays(callA.arguments, callB.arguments, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.PropertyAccessExpression: case ts.SyntaxKind.ElementAccessExpression: { const accessA = nodeA as ts.PropertyAccessExpression | ts.ElementAccessExpression; const accessB = nodeB as ts.PropertyAccessExpression | ts.ElementAccessExpression; if (!this.areNodesBasicallyEqual(accessA.expression, accessB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; const nameOrArgA = ts.isPropertyAccessExpression(accessA) ? accessA.name : accessA.argumentExpression; const nameOrArgB = ts.isPropertyAccessExpression(accessB) ? accessB.name : accessB.argumentExpression; if (!this.areNodesBasicallyEqual(nameOrArgA, nameOrArgB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!!accessA.questionDotToken !== !!accessB.questionDotToken) return false; break; }
            case ts.SyntaxKind.Parameter: { const paramA = nodeA as ts.ParameterDeclaration; const paramB = nodeB as ts.ParameterDeclaration; const decoratorsA = ts.canHaveDecorators(paramA) ? ts.getDecorators(paramA) : undefined; const decoratorsB = ts.canHaveDecorators(paramB) ? ts.getDecorators(paramB) : undefined; if (!this.compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; const modifiersOnlyA = (paramA.modifiers || []).filter(ts.isModifier) as ts.Modifier[]; const modifiersOnlyB = (paramB.modifiers || []).filter(ts.isModifier) as ts.Modifier[]; if (!this.compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false; if (!!paramA.dotDotDotToken !== !!paramB.dotDotDotToken) return false; if (!this.areNodesBasicallyEqual(paramA.name, paramB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!!paramA.questionToken !== !!paramB.questionToken) return false; if (!this.areNodesBasicallyEqual(paramA.type, paramB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(paramA.initializer, paramB.initializer, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.FunctionDeclaration: case ts.SyntaxKind.MethodDeclaration: case ts.SyntaxKind.Constructor: case ts.SyntaxKind.ArrowFunction: case ts.SyntaxKind.FunctionExpression: case ts.SyntaxKind.GetAccessor: case ts.SyntaxKind.SetAccessor: { const funcA = nodeA as ts.FunctionLikeDeclaration; const funcB = nodeB as ts.FunctionLikeDeclaration; const decoratorsA = ts.canHaveDecorators(funcA) ? ts.getDecorators(funcA) : undefined; const decoratorsB = ts.canHaveDecorators(funcB) ? ts.getDecorators(funcB) : undefined; if (!this.compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; const modifiersOnlyA = (funcA.modifiers || []).filter(ts.isModifier) as ts.Modifier[]; const modifiersOnlyB = (funcB.modifiers || []).filter(ts.isModifier) as ts.Modifier[]; if (!this.compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false; if (!!funcA.asteriskToken !== !!funcB.asteriskToken) return false; if (!this.areNodesBasicallyEqual(funcA.name, funcB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.compareNodeArrays(funcA.typeParameters, funcB.typeParameters, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.compareNodeArrays(funcA.parameters, funcB.parameters, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(funcA.type, funcB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(funcA.body, funcB.body, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.Block: { const blockA = nodeA as ts.Block; const blockB = nodeB as ts.Block; if (!this.compareNodeArrays(blockA.statements, blockB.statements, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.IfStatement: { const ifA = nodeA as ts.IfStatement; const ifB = nodeB as ts.IfStatement; if (!this.areNodesBasicallyEqual(ifA.expression, ifB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(ifA.thenStatement, ifB.thenStatement, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(ifA.elseStatement, ifB.elseStatement, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.BinaryExpression: { const binA = nodeA as ts.BinaryExpression; const binB = nodeB as ts.BinaryExpression; if (binA.operatorToken.kind !== binB.operatorToken.kind) return false; if (!this.areNodesBasicallyEqual(binA.left, binB.left, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; if (!this.areNodesBasicallyEqual(binA.right, binB.right, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.PrefixUnaryExpression: case ts.SyntaxKind.PostfixUnaryExpression: { const unaryA = nodeA as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression; const unaryB = nodeB as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression; if (unaryA.operator !== unaryB.operator) return false; if (!this.areNodesBasicallyEqual(unaryA.operand, unaryB.operand, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            case ts.SyntaxKind.ParenthesizedExpression: { const parenA = nodeA as ts.ParenthesizedExpression; const parenB = nodeB as ts.ParenthesizedExpression; if (!this.areNodesBasicallyEqual(parenA.expression, parenB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; break; }
            default: { const childrenA = nodeA.getChildren(sourceFileA); const childrenB = nodeB.getChildren(sourceFileB); const significantChildrenA = childrenA.filter(n => !this.isTriviaNode(n)); const significantChildrenB = childrenB.filter(n => !this.isTriviaNode(n)); if (significantChildrenA.length !== significantChildrenB.length) return false; for (let i = 0; i < significantChildrenA.length; i++) { if (!this.areNodesBasicallyEqual(significantChildrenA[i], significantChildrenB[i], sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; } break; }
        }
        return true; // Nodes are equal
    }
    // --- compareNodeArrays ---
    private compareNodeArrays(arrA: readonly ts.Node[]|ts.NodeArray<ts.Node>|undefined, arrB: readonly ts.Node[]|ts.NodeArray<ts.Node>|undefined, sourceFileA: ts.SourceFile|undefined, sourceFileB: ts.SourceFile|undefined, depth: number, ignoreIdentifiers: boolean): boolean { const listA = arrA || []; const listB = arrB || []; if (listA.length !== listB.length) return false; for (let i = 0; i < listA.length; i++) { if (!this.areNodesBasicallyEqual(listA[i], listB[i], sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false; } return true; }
    // --- compareModifiers ---
    private compareModifiers(modA: readonly ts.Modifier[]|undefined, modB: readonly ts.Modifier[]|undefined): boolean { const modsAKinds = modA ? modA.map(m => m.kind).sort() : []; const modsBKinds = modB ? modB.map(m => m.kind).sort() : []; if (modsAKinds.length !== modsBKinds.length) return false; for (let i = 0; i < modsAKinds.length; i++) { if (modsAKinds[i] !== modsBKinds[i]) return false; } return true; }
    // --- isTriviaNode ---
    private isTriviaNode(node: ts.Node): boolean { return node.kind === ts.SyntaxKind.SingleLineCommentTrivia || node.kind === ts.SyntaxKind.MultiLineCommentTrivia || (node.kind === ts.SyntaxKind.SyntaxList && node.getChildCount() === 0); }

    // --- Логика подсветки ---
    private highlightTextInEditor(textToFindFromWebview: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Highlighting text... Editor active:', !!editor);
        this.clearHighlights();

        if (!editor) { console.log('[CodeReplacerTS] No active editor.'); return; }
        const document = editor.document;
        const languageId = document.languageId;
        const documentText = document.getText();
        const trimmedTextToFind = textToFindFromWebview.trim();
        if (!trimmedTextToFind) { console.log('[CodeReplacerTS] Find text is empty.'); return; }

        const decorationsArray: vscode.DecorationOptions[] = [];
        let localMatchedResults: { range: vscode.Range, mode: 'ast' | 'text' }[] = [];
        const isAstSupported = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(languageId);
        const isTextSupported = ['css', 'html', 'json', 'jsonc', 'xml', 'less', 'scss', 'python', 'ruby', 'shellscript'].includes(languageId);

        if (isAstSupported) {
            console.log(`[CodeReplacerTS] Using AST mode for language: ${languageId}`);
            try {
                const parseResult = parseCodeToAST(trimmedTextToFind, 'findFragment.ts'); // Используем обновленный парсер
                if (!parseResult || parseResult.nodes.length === 0) { console.log('[CodeReplacerTS AST] Could not parse find text or no nodes found.'); return; }
                const findNodes = parseResult.nodes; const findSourceFile = parseResult.sourceFile;
                console.log(`[CodeReplacerTS AST] Attempting to match sequence of ${findNodes.length} node(s). First kind: ${ts.SyntaxKind[findNodes[0].kind]}`);
                const documentSourceFile = ts.createSourceFile(document.fileName, documentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

                const findASTSequences = (siblings: readonly ts.Node[]) => {
                    if (!siblings || siblings.length < findNodes.length) return;
                    for (let i = 0; i <= siblings.length - findNodes.length; i++) {
                        let sequenceMatch = true;
                        for (let j = 0; j < findNodes.length; j++) { if (!this.areNodesBasicallyEqual(siblings[i + j], findNodes[j], documentSourceFile, findSourceFile, 0)) { sequenceMatch = false; break; } }
                        if (sequenceMatch) {
                            const firstNode = siblings[i]; const lastNode = siblings[i + findNodes.length - 1];
                            console.log(`[AST Sequence Match FOUND] Starts at pos ${firstNode.getStart(documentSourceFile)}`);
                            try {
                                const start = firstNode.getStart(documentSourceFile); const end = lastNode.getEnd();
                                const startPos = document.positionAt(start); const endPos = document.positionAt(end); const range = new vscode.Range(startPos, endPos);
                                decorationsArray.push({ range, hoverMessage: `AST Match (${findNodes.length} node${findNodes.length > 1 ? 's': ''})` });
                                localMatchedResults.push({ range, mode: 'ast' }); i += findNodes.length - 1;
                            } catch (rangeError: any) { console.error(`[CodeReplacerTS AST] Error calculating range:`, rangeError.message); }
                        }
                    }
                };
                 const visit = (node: ts.Node) => { const children = node.getChildren(documentSourceFile); findASTSequences(children); children.forEach(visit); };
                 console.log(`[CodeReplacerTS AST] Starting AST search in: ${document.fileName}`); visit(documentSourceFile);
            } catch (error: any) { console.error("[CodeReplacerTS AST] Error during AST processing:", error); vscode.window.showErrorMessage(`AST Analysis Error: ${error.message || 'Unknown error'}`); }
        } else if (isTextSupported) {
             console.log(`[CodeReplacerTS] Using Text mode for language: ${languageId}`);
             try {
                 const normalizedTarget = normalizeAndCleanText(trimmedTextToFind, languageId);
                 if (!normalizedTarget) { console.log("[CodeReplacerTS Text] Normalized find text is empty."); return; }
                 console.log(`[CodeReplacerTS Text] Searching for normalized text: "${normalizedTarget.substring(0, 50)}..."`);
                 const normalizedDocument = normalizeAndCleanText(documentText, languageId);
                 let searchStartIndex = 0; let matchIndex = -1;
                 while ((matchIndex = normalizedDocument.indexOf(normalizedTarget, searchStartIndex)) !== -1) {
                     console.log(`[CodeReplacerTS Text] Found potential match at normalized index: ${matchIndex}`);
                     try {
                          // Приблизительное определение диапазона (ОЧЕНЬ НЕТОЧНОЕ)
                          const approxOriginalStart = Math.max(0, matchIndex - 50);
                          const originalTextSnippet = documentText.substring(approxOriginalStart, approxOriginalStart + normalizedTarget.length + 100);
                          const originalIndexInSnippet = originalTextSnippet.indexOf(trimmedTextToFind.split('\n')[0]);
                          if (originalIndexInSnippet !== -1) {
                              const originalStart = approxOriginalStart + originalIndexInSnippet; const originalEnd = originalStart + trimmedTextToFind.length; // Приблизительно
                              const startPos = document.positionAt(originalStart); const endPos = document.positionAt(originalEnd); const range = new vscode.Range(startPos, endPos);
                              if (!localMatchedResults.some(r => r.range.isEqual(range))) {
                                    decorationsArray.push({ range, hoverMessage: `Text Match (Approximate)` }); localMatchedResults.push({ range, mode: 'text' });
                                    console.log(`[CodeReplacerTS Text] Added approximate range: ${originalStart}-${originalEnd}`);
                              } else { console.log(`[CodeReplacerTS Text] Skipping duplicate approximate range.`); }
                          } else { console.log(`[CodeReplacerTS Text] Could not find original text snippet nearby for normalized index ${matchIndex}`); }
                     } catch (rangeError: any) { console.error(`[CodeReplacerTS Text] Error calculating approximate range:`, rangeError.message); }
                     searchStartIndex = matchIndex + Math.max(1, normalizedTarget.length); // Перемещаем поиск
                 }
             } catch (error: any) { console.error("[CodeReplacerTS Text] Error during text processing:", error); vscode.window.showErrorMessage(`Text Analysis Error: ${error.message || 'Unknown error'}`); }
        } else {
            console.log(`[CodeReplacerTS] Language not supported: ${languageId}`); vscode.window.showInformationMessage(`Language '${languageId}' is not currently supported.`); return;
        }
        matchedResults = localMatchedResults;
        console.log(`[CodeReplacerTS] Found ${matchedResults.length} total match(es). Applying decorations.`);
        if (matchedResults.length === 0 && trimmedTextToFind.length > 0) { vscode.window.showInformationMessage(`No matches found for the provided code.`); }
        if (editor && findDecorationType) { editor.setDecorations(findDecorationType, decorationsArray); }
    }

    // --- Логика замены ---
    private async replaceFoundMatches(replaceText: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Applying replace...');
        if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }
        if (matchedResults.length === 0) { vscode.window.showInformationMessage('No matches stored. Please find first.'); return; }
        const sortedResults = [...matchedResults].sort((a, b) => b.range.start.compareTo(a.range.start));
        const originalRangesCount = sortedResults.length;
        const modesUsed = new Set(sortedResults.map(r => r.mode));
        try {
            const success = await editor.edit(editBuilder => { sortedResults.forEach(result => { editBuilder.replace(result.range, replaceText); }); }, { undoStopBefore: true, undoStopAfter: true });
            if (success) {
                console.log(`[CodeReplacerTS] ${originalRangesCount} match(es) replaced (Modes: ${Array.from(modesUsed).join(', ')}).`);
                vscode.window.showInformationMessage(`Replacement successful (${originalRangesCount} matches).`);
                this.clearHighlights(editor);
            } else { console.error('[CodeReplacerTS] editor.edit() returned false.'); vscode.window.showErrorMessage('Replacement failed. Editor modified concurrently?'); }
        } catch (error: any) { console.error("[CodeReplacerTS] Error during replace:", error); vscode.window.showErrorMessage(`Replacement Error: ${error.message || 'Unknown error'}`); }
    }

    // --- Очистка подсветки ---
    public clearHighlights(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor) {
        if (editor && findDecorationType) { editor.setDecorations(findDecorationType, []); }
        else if (!editor) { vscode.window.visibleTextEditors.forEach(visibleEditor => { if (findDecorationType) { visibleEditor.setDecorations(findDecorationType, []); } }); }
        if (matchedResults.length > 0) { console.log('[CodeReplacerTS] Clearing stored matches.'); matchedResults = []; }
    }

    // --- Генерация HTML ---
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce(); const stylesPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.css'); const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js'); const stylesUri = webview.asWebviewUri(stylesPath); const scriptUri = webview.asWebviewUri(scriptPath);
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; connect-src 'self';"><link href="${stylesUri}" rel="stylesheet"><title>Code Replacer TS</title></head><body><div class="container"><div class="input-group"><h2>Code to Find:</h2><textarea id="findText" placeholder="Paste code snippet..." rows="8"></textarea><small>Uses AST for TS/JS, basic text compare for CSS/HTML/JSON.</small></div><div class="input-group"><h2>Replacement Code:</h2><textarea id="replaceText" placeholder="Paste replacement code..." rows="8"></textarea></div></div><div class="button-container"><button id="applyButton">Replace Found Matches</button></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }
}

// --- Deactivation ---
export function deactivate() {
    console.log('[CodeReplacerTS] Extension deactivated.'); if (findDecorationType) { findDecorationType.dispose(); } matchedResults = [];
}

// --- КОНЕЦ ФАЙЛА src/extension.ts ---
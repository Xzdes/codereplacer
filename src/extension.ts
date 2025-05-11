import * as vscode from 'vscode';
import * as ts from 'typescript';

// Глобальная переменная для типа декорации, используемой для подсветки найденного текста
let findDecorationType: vscode.TextEditorDecorationType;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С AST ---
function parseCodeToASTStatements(code: string,
                                  fileName: string = 'tempFile.ts'): ts.Statement[] {
    const sourceFile = ts.createSourceFile(
        fileName,
        code,
        ts.ScriptTarget.Latest,
        true, // setParentNodes
        ts.ScriptKind.TSX // Parse as TSX for flexibility
    );
    return Array.from(sourceFile.statements);
}
// --- КОНЕЦ ВСПОМОГАТЕЛЬНЫХ ФУНКЦИЙ ДЛЯ РАБОТЫ С AST ---

function normalizeText(text: string, trimEdges: boolean = true): string {
    let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (trimEdges) {
        normalized = normalized.trim();
    }
    return normalized;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('[CodeReplacerTS] Extension "codereplacer" is now active!');

    const testCodeForParser = `
        function hello(name: string) { console.log("Hello, " + name); }
        const x = 10;
        class MyClass { constructor() {} }
    `;
    try {
        const astStatements = parseCodeToASTStatements(testCodeForParser, 'parserTest.ts');
        console.log(`[CodeReplacerTS AST Test] Parsed ${astStatements.length} statements from testCodeForParser.`);
        astStatements.forEach((stmt, index) => {
            console.log(`  Statement ${index + 1} Kind: ${ts.SyntaxKind[stmt.kind]} (Value: ${stmt.kind})`);
        });
    } catch (e) {
        console.error("[CodeReplacerTS AST Test] Error parsing test code:", e);
    }

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
                        await this.replaceTextInEditor_WithStringLogic(message.findText, message.replaceText); // TODO: Convert to AST logic
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

    private areNodesBasicallyEqual(
        nodeA: ts.Node | undefined, // DocNode
        nodeB: ts.Node | undefined, // FindNode
        sourceFileA?: ts.SourceFile,
        sourceFileB?: ts.SourceFile,
        depth = 0
    ): boolean {
        const indent = "  ".repeat(depth);
        if (!nodeA && !nodeB) {
            // console.log(`${indent}[AST Compare OK] Both nodes are undefined`);
            return true;
        }
        if (!nodeA || !nodeB) {
            console.log(`${indent}[AST Compare FAIL] One node is undefined. DocNode: ${!!nodeA} (Kind: ${nodeA ? ts.SyntaxKind[nodeA.kind] : 'N/A'}), FindNode: ${!!nodeB} (Kind: ${nodeB ? ts.SyntaxKind[nodeB.kind] : 'N/A'})`);
            return false;
        }

        if (nodeA.kind === ts.SyntaxKind.FunctionDeclaration && nodeB.kind === ts.SyntaxKind.FunctionDeclaration) {
            console.log(`${indent}>>> Comparing FunctionDeclarations <<<`);
            if (sourceFileA) try { console.log(`${indent}Doc Func Text (approx): "${nodeA.getText(sourceFileA).substring(0, 150).replace(/\n/g, "\\n")}"`); } catch(e){}
            if (sourceFileB) try { console.log(`${indent}Find Func Text (approx): "${nodeB.getText(sourceFileB).substring(0, 150).replace(/\n/g, "\\n")}"`); } catch(e){}
        }
        // else { // Общий лог для других типов узлов
        //     console.log(`${indent}[AST Compare Attempt] DocNode Kind: ${ts.SyntaxKind[nodeA.kind]}, FindNode Kind: ${ts.SyntaxKind[nodeB.kind]}`);
        // }

        if (nodeA.kind !== nodeB.kind) {
            console.log(`${indent}[AST Compare FAIL] Kind mismatch: DocNode=${ts.SyntaxKind[nodeA.kind]} (${nodeA.kind}) vs FindNode=${ts.SyntaxKind[nodeB.kind]} (${nodeB.kind})`);
            return false;
        }

        switch (nodeA.kind) {
            case ts.SyntaxKind.Identifier:
                const textA_ident = (nodeA as ts.Identifier).text;
                const textB_ident = (nodeB as ts.Identifier).text;
                if (textA_ident !== textB_ident) {
                    console.log(`${indent}[AST Compare FAIL] Identifier text mismatch: "${textA_ident}" vs "${textB_ident}"`);
                    return false;
                }
                break;
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NumericLiteral:
            case ts.SyntaxKind.RegularExpressionLiteral:
                const textA_literal = (nodeA as ts.LiteralLikeNode).text;
                const textB_literal = (nodeB as ts.LiteralLikeNode).text;
                if (textA_literal !== textB_literal) {
                    console.log(`${indent}[AST Compare FAIL] Literal text mismatch: "${textA_literal}" vs "${textB_literal}"`);
                    return false;
                }
                break;
            case ts.SyntaxKind.TrueKeyword:
            case ts.SyntaxKind.FalseKeyword:
            case ts.SyntaxKind.NullKeyword:
            case ts.SyntaxKind.ThisKeyword:
            case ts.SyntaxKind.SuperKeyword:
                break; 

            case ts.SyntaxKind.VariableDeclaration: {
                const varDeclA = nodeA as ts.VariableDeclaration;
                const varDeclB = nodeB as ts.VariableDeclaration;
                if (!this.areNodesBasicallyEqual(varDeclA.name, varDeclB.name, sourceFileA, sourceFileB, depth + 1)) {
                    console.log(`${indent}[AST Compare FAIL] VariableDeclaration: name mismatch`); return false;
                }
                if (!!varDeclA.initializer !== !!varDeclB.initializer) {
                    console.log(`${indent}[AST Compare FAIL] VariableDeclaration: initializer presence mismatch (Doc: ${!!varDeclA.initializer}, Find: ${!!varDeclB.initializer})`); return false;
                }
                if (varDeclA.initializer && !this.areNodesBasicallyEqual(varDeclA.initializer, varDeclB.initializer, sourceFileA, sourceFileB, depth + 1)) {
                    console.log(`${indent}[AST Compare FAIL] VariableDeclaration: initializer content mismatch`); return false;
                }
                break;
            }
            case ts.SyntaxKind.VariableDeclarationList: {
                const listA = nodeA as ts.VariableDeclarationList;
                const listB = nodeB as ts.VariableDeclarationList;
                if (listA.flags !== listB.flags) { 
                    console.log(`${indent}[AST Compare FAIL] VariableDeclarationList: flags mismatch ${listA.flags} vs ${listB.flags}`); return false;
                }
                if (listA.declarations.length !== listB.declarations.length) {
                    console.log(`${indent}[AST Compare FAIL] VariableDeclarationList: declarations length mismatch ${listA.declarations.length} vs ${listB.declarations.length}`); return false;
                }
                for (let i = 0; i < listA.declarations.length; i++) {
                    if (!this.areNodesBasicallyEqual(listA.declarations[i], listB.declarations[i], sourceFileA, sourceFileB, depth + 1)) {
                        console.log(`${indent}[AST Compare FAIL] VariableDeclarationList: declaration at index ${i} mismatch`); return false;
                    }
                }
                break;
            }
            case ts.SyntaxKind.VariableStatement: {
                const stmtA = nodeA as ts.VariableStatement;
                const stmtB = nodeB as ts.VariableStatement;
                if (!this.areNodesBasicallyEqual(stmtA.declarationList, stmtB.declarationList, sourceFileA, sourceFileB, depth + 1)) {
                    console.log(`${indent}[AST Compare FAIL] VariableStatement: declarationList mismatch`); return false;
                }
                break;
            }
            case ts.SyntaxKind.ExpressionStatement: {
                const exprStmtA = nodeA as ts.ExpressionStatement;
                const exprStmtB = nodeB as ts.ExpressionStatement;
                if (!this.areNodesBasicallyEqual(exprStmtA.expression, exprStmtB.expression, sourceFileA, sourceFileB, depth + 1)) {
                    console.log(`${indent}[AST Compare FAIL] ExpressionStatement: expression mismatch`); return false;
                }
                break;
            }
            case ts.SyntaxKind.CallExpression: {
                const callA = nodeA as ts.CallExpression;
                const callB = nodeB as ts.CallExpression;
                if (!this.areNodesBasicallyEqual(callA.expression, callB.expression, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}[AST Compare FAIL] CallExpression: expression (callee) mismatch`); return false;
                }
                if (callA.arguments.length !== callB.arguments.length) {
                     console.log(`${indent}[AST Compare FAIL] CallExpression: arguments length mismatch ${callA.arguments.length} vs ${callB.arguments.length}`); return false;
                }
                for (let i = 0; i < callA.arguments.length; i++) {
                    if (!this.areNodesBasicallyEqual(callA.arguments[i], callB.arguments[i], sourceFileA, sourceFileB, depth + 1)) {
                         console.log(`${indent}[AST Compare FAIL] CallExpression: argument at index ${i} mismatch`); return false;
                    }
                }
                break;
            }
            case ts.SyntaxKind.PropertyAccessExpression: {
                const paeA = nodeA as ts.PropertyAccessExpression;
                const paeB = nodeB as ts.PropertyAccessExpression;
                if (!this.areNodesBasicallyEqual(paeA.expression, paeB.expression, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}[AST Compare FAIL] PropertyAccessExpression: object/expression mismatch`); return false;
                }
                if (!this.areNodesBasicallyEqual(paeA.name, paeB.name, sourceFileA, sourceFileB, depth + 1)) { 
                     console.log(`${indent}[AST Compare FAIL] PropertyAccessExpression: property name mismatch`); return false;
                }
                break;
            }
            case ts.SyntaxKind.Parameter: {
                const paramA = nodeA as ts.ParameterDeclaration;
                const paramB = nodeB as ts.ParameterDeclaration;
                if (!this.areNodesBasicallyEqual(paramA.name, paramB.name, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}[AST Compare FAIL] Parameter: name mismatch`); return false;
                }
                break;
            }
            case ts.SyntaxKind.FunctionDeclaration: {
                const funcA = nodeA as ts.FunctionDeclaration;
                const funcB = nodeB as ts.FunctionDeclaration;
                console.log(`${indent}  [FunctionDeclaration Compare] Comparing names...`);
                if (!this.areNodesBasicallyEqual(funcA.name, funcB.name, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}  [AST Compare FAIL] FunctionDeclaration: name mismatch`); return false;
                }
                console.log(`${indent}  [FunctionDeclaration Compare] Names OK. Comparing parameters count...`);
                if (funcA.parameters.length !== funcB.parameters.length) {
                     console.log(`${indent}  [AST Compare FAIL] FunctionDeclaration: parameters length mismatch ${funcA.parameters.length} vs ${funcB.parameters.length}`); return false;
                }
                console.log(`${indent}  [FunctionDeclaration Compare] Params count OK (${funcA.parameters.length}). Comparing each parameter...`);
                for (let i = 0; i < funcA.parameters.length; i++) {
                    if (!this.areNodesBasicallyEqual(funcA.parameters[i], funcB.parameters[i], sourceFileA, sourceFileB, depth + 1)) {
                         console.log(`${indent}  [AST Compare FAIL] FunctionDeclaration: parameter at index ${i} mismatch`); return false;
                    }
                }
                console.log(`${indent}  [FunctionDeclaration Compare] Params OK. Comparing body presence...`);
                if (!!funcA.body !== !!funcB.body) {
                     console.log(`${indent}  [AST Compare FAIL] FunctionDeclaration: body presence mismatch (Doc: ${!!funcA.body}, Find: ${!!funcB.body})`); return false;
                }
                console.log(`${indent}  [FunctionDeclaration Compare] Body presence OK. Comparing body content...`);
                if (funcA.body && !this.areNodesBasicallyEqual(funcA.body, funcB.body, sourceFileA, sourceFileB, depth + 1)) { 
                     console.log(`${indent}  [AST Compare FAIL] FunctionDeclaration: body content mismatch`); return false;
                }
                console.log(`${indent}  [FunctionDeclaration Compare] Body OK. Functions are considered equal at this level.`);
                break;
            }
            case ts.SyntaxKind.Block: {
                const blockA = nodeA as ts.Block;
                const blockB = nodeB as ts.Block;
                console.log(`${indent}  [Block Compare] Template statements: ${blockA.statements.length}, Candidate statements: ${blockB.statements.length}`);
                if (blockA.statements.length > 0 && blockB.statements.length === 0) {
                    console.log(`${indent}  [AST Compare FAIL] Block: Template has statements, candidate is empty.`);
                    return false;
                }
                if (blockA.statements.length > blockB.statements.length) {
                    console.log(`${indent}  [AST Compare FAIL] Block: Template block has more statements (${blockA.statements.length}) than candidate block (${blockB.statements.length}).`);
                    return false;
                }
                for (let i = 0; i < blockA.statements.length; i++) {
                    console.log(`${indent}    [Block Compare] Comparing statement at index ${i}`);
                    if (!this.areNodesBasicallyEqual(blockA.statements[i], blockB.statements[i], sourceFileA, sourceFileB, depth + 1)) {
                        console.log(`${indent}    [AST Compare FAIL] Block: Statement at index ${i} mismatch (Kind Doc: ${ts.SyntaxKind[blockB.statements[i].kind]}, Kind Find: ${ts.SyntaxKind[blockA.statements[i].kind]})`);
                        return false;
                    }
                }
                console.log(`${indent}  [Block Compare] All ${blockA.statements.length} template statements matched prefix of candidate block.`);
                break;
            }
            case ts.SyntaxKind.IfStatement: {
                const ifA = nodeA as ts.IfStatement;
                const ifB = nodeB as ts.IfStatement;
                if (!this.areNodesBasicallyEqual(ifA.expression, ifB.expression, sourceFileA, sourceFileB, depth + 1)) {
                    console.log(`${indent}[AST Compare FAIL] IfStatement: expression mismatch`); return false;
                }
                if (!this.areNodesBasicallyEqual(ifA.thenStatement, ifB.thenStatement, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}[AST Compare FAIL] IfStatement: then statement mismatch`); return false;
                }
                if (!!ifA.elseStatement !== !!ifB.elseStatement) {
                     console.log(`${indent}[AST Compare FAIL] IfStatement: else statement presence mismatch`); return false;
                }
                if (ifA.elseStatement && !this.areNodesBasicallyEqual(ifA.elseStatement, ifB.elseStatement, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}[AST Compare FAIL] IfStatement: else statement content mismatch`); return false;
                }
                break;
            }
            case ts.SyntaxKind.BinaryExpression: {
                const binA = nodeA as ts.BinaryExpression;
                const binB = nodeB as ts.BinaryExpression;
                if (binA.operatorToken.kind !== binB.operatorToken.kind) {
                     console.log(`${indent}[AST Compare FAIL] BinaryExpression: Operator mismatch: ${ts.SyntaxKind[binA.operatorToken.kind]} vs ${ts.SyntaxKind[binB.operatorToken.kind]}`); return false;
                }
                if (!this.areNodesBasicallyEqual(binA.left, binB.left, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}[AST Compare FAIL] BinaryExpression: Left operand mismatch`); return false;
                }
                if (!this.areNodesBasicallyEqual(binA.right, binB.right, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}[AST Compare FAIL] BinaryExpression: Right operand mismatch`); return false;
                }
                break;
            }
            case ts.SyntaxKind.TypeOfExpression: {
                const typeofA = nodeA as ts.TypeOfExpression;
                const typeofB = nodeB as ts.TypeOfExpression;
                if (!this.areNodesBasicallyEqual(typeofA.expression, typeofB.expression, sourceFileA, sourceFileB, depth + 1)) {
                    console.log(`${indent}[AST Compare FAIL] TypeOfExpression: expression mismatch`); return false;
                }
                break;
            }
            case ts.SyntaxKind.NewExpression: {
                const newA = nodeA as ts.NewExpression;
                const newB = nodeB as ts.NewExpression;
                if (!this.areNodesBasicallyEqual(newA.expression, newB.expression, sourceFileA, sourceFileB, depth + 1)) {
                     console.log(`${indent}[AST Compare FAIL] NewExpression: expression (callee) mismatch`); return false;
                }
                const argsA = newA.arguments || [];
                const argsB = newB.arguments || [];
                if (argsA.length !== argsB.length) {
                     console.log(`${indent}[AST Compare FAIL] NewExpression: arguments length mismatch`); return false;
                }
                for (let i = 0; i < argsA.length; i++) {
                    if (!this.areNodesBasicallyEqual(argsA[i], argsB[i], sourceFileA, sourceFileB, depth + 1)) {
                         console.log(`${indent}[AST Compare FAIL] NewExpression: argument at index ${i} mismatch`); return false;
                    }
                }
                break;
            }
            case ts.SyntaxKind.ThrowStatement: {
                const throwA = nodeA as ts.ThrowStatement;
                const throwB = nodeB as ts.ThrowStatement;
                if(!this.areNodesBasicallyEqual(throwA.expression, throwB.expression, sourceFileA, sourceFileB, depth + 1)) {
                    console.log(`${indent}[AST Compare FAIL] ThrowStatement: expression mismatch`); return false;
                }
                break;
            }
            default:
                const childrenA = nodeA.getChildren(sourceFileA);
                const childrenB = nodeB.getChildren(sourceFileB);
                if (childrenA.length === 0 && childrenB.length === 0) {
                    return true;
                }
                if (childrenA.length !== childrenB.length) {
                    console.log(`${indent}[AST Compare FAIL Generic Children] Children length mismatch: ${childrenA.length} vs ${childrenB.length} for kind ${ts.SyntaxKind[nodeA.kind]}`);
                    return false;
                }
                for (let i = 0; i < childrenA.length; i++) {
                    if (childrenA[i].kind === ts.SyntaxKind.SyntaxList && childrenB[i].kind === ts.SyntaxKind.SyntaxList) {
                        const syntaxListAChildren = childrenA[i].getChildren(sourceFileA);
                        const syntaxListBChildren = childrenB[i].getChildren(sourceFileB);
                        if (syntaxListAChildren.length !== syntaxListBChildren.length) {
                            console.log(`${indent}[AST Compare FAIL SyntaxList] Children length mismatch inside SyntaxList for kind ${ts.SyntaxKind[nodeA.kind]}`);
                            return false;
                        }
                        for(let j = 0; j < syntaxListAChildren.length; j++) {
                            if (!this.areNodesBasicallyEqual(syntaxListAChildren[j], syntaxListBChildren[j], sourceFileA, sourceFileB, depth + 1)) {
                                console.log(`${indent}[AST Compare FAIL SyntaxList] Child at index ${j} mismatch inside SyntaxList for kind ${ts.SyntaxKind[nodeA.kind]}`);
                                return false;
                            }
                        }
                        continue; 
                    }
                    if (!this.areNodesBasicallyEqual(childrenA[i], childrenB[i], sourceFileA, sourceFileB, depth + 1)) {
                        console.log(`${indent}[AST Compare FAIL Generic Children] Child at index ${i} (Kind Doc: ${ts.SyntaxKind[childrenA[i].kind]}, Kind Find: ${ts.SyntaxKind[childrenB[i].kind]}) mismatch for parent kind ${ts.SyntaxKind[nodeA.kind]}`);
                        return false;
                    }
                }
                break;
        }
        return true;
    }

    // --- Возвращаем highlightTextInEditor к поиску ОДНОГО стейтмента для отладки ---
    private highlightTextInEditor(textToFindFromWebview: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Highlighting text (AST-based, SINGLE statement matching). Editor active:', !!editor);

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

            const findNodeToMatch = findStatements[0]; // Используем только первый стейтмент из поиска
            console.log(`[CodeReplacerTS AST] Attempting to match single statement from webview: Kind=${ts.SyntaxKind[findNodeToMatch.kind]}`);
            if (findStatements.length > 1) {
                console.warn(`[CodeReplacerTS AST] WARNING: Webview provided ${findStatements.length} statements, but current logic only matches the first one for focused debugging.`);
            }

            const documentText = editor.document.getText();
            const documentSourceFile = ts.createSourceFile(editor.document.fileName, documentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

            const visit = (nodeInDocument: ts.Node) => {
                // console.log(`[AST Visit] Visiting Doc Node: Kind=${ts.SyntaxKind[nodeInDocument.kind]}, Pos=${nodeInDocument.pos}-${nodeInDocument.end}`);
                if (this.areNodesBasicallyEqual(nodeInDocument, findNodeToMatch, documentSourceFile, findSourceFile, 0)) { 
                    astMatchCount++;
                    console.log(`[AST Match FOUND] Doc Node Kind: ${ts.SyntaxKind[nodeInDocument.kind]}, Find Node Kind: ${ts.SyntaxKind[findNodeToMatch.kind]}`);
                    const start = nodeInDocument.getStart(documentSourceFile);
                    const end = nodeInDocument.getEnd();
                    const startPos = editor.document.positionAt(start);
                    const endPos = editor.document.positionAt(end);
                    decorationsArray.push({
                        range: new vscode.Range(startPos, endPos),
                        hoverMessage: 'Найденный AST-фрагмент'
                    });
                }
                ts.forEachChild(nodeInDocument, visit);
            };
            ts.forEachChild(documentSourceFile, visit);
            console.log(`[CodeReplacerTS AST] Found ${astMatchCount} AST-based matches for the first statement.`);
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
    // --- КОНЕЦ ОТЛАДОЧНОЙ ВЕРСИИ highlightTextInEditor ---

    private clearHighlights() {
        const editor = vscode.window.activeTextEditor;
        if (editor && findDecorationType) {
            editor.setDecorations(findDecorationType, []);
            console.log('[CodeReplacerTS] Highlights cleared by provider.');
        }
    }

    private async replaceTextInEditor_WithStringLogic(findTextFromWebview: string, replaceTextFromWebview: string) {
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeReplacerTS] Applying replace (current: string-based). Editor active:', !!editor);
        const normalizedFindText = normalizeText(findTextFromWebview); 
        const replaceText = replaceTextFromWebview;

        if (normalizedFindText.length === 0) { if (findTextFromWebview.length > 0) { vscode.window.showInformationMessage('Текст для поиска стал пустым после удаления пробелов. Замена не выполнена.'); } else { vscode.window.showInformationMessage('Поле "Код для поиска" не должно быть пустым.'); } return; }
        if (!editor) { vscode.window.showErrorMessage('Нет активного текстового редактора для замены.'); return; }
        
        const document = editor.document;
        const originalDocumentText = document.getText();
        const normalizedDocumentText = normalizeText(originalDocumentText, false); 
        const firstOccurrenceIndexNormalized = normalizedDocumentText.indexOf(normalizedFindText);
        console.log('[CodeReplacerTS String Logic] indexOf for replacement (on normalized text) returned:', firstOccurrenceIndexNormalized);

        if (firstOccurrenceIndexNormalized === -1) { vscode.window.showInformationMessage(`Нормализованный код для поиска не найден в документе (строковый поиск).`); this.clearHighlights(); return; }
        
        const originalStartIndex = this.getOriginalIndex(originalDocumentText, normalizedDocumentText, firstOccurrenceIndexNormalized);
        const originalEndIndex = this.getOriginalIndex(originalDocumentText, normalizedDocumentText, firstOccurrenceIndexNormalized + normalizedFindText.length);
        const rangeToReplace = new vscode.Range( document.positionAt(originalStartIndex), document.positionAt(originalEndIndex) );
        const success = await editor.edit(editBuilder => { editBuilder.replace(rangeToReplace, replaceText); });

        if (success) { console.log('[CodeReplacerTS String Logic] Text replaced successfully. Saving document...'); await document.save(); vscode.window.showInformationMessage('Код успешно заменен и файл сохранен (строковая замена)!'); this.clearHighlights(); }
        else { vscode.window.showErrorMessage('Не удалось выполнить замену текста (строковая замена).'); }
    }

    private getOriginalIndex(originalText: string, normalizedText: string, normalizedIndex: number): number {
        if (originalText === normalizedText) { return normalizedIndex; }
        let finalOriginalIndex = 0;
        let currentNormalizedCount = 0;
        for(let i=0; i < originalText.length; i++) {
            if (currentNormalizedCount === normalizedIndex) { finalOriginalIndex = i; break; }
            if (originalText[i] === '\r' && originalText[i+1] === '\n') { /* skip \r */ }
            else if (originalText[i] === '\r') { /* skip single \r */ }
            else { currentNormalizedCount++; }
            if (i === originalText.length - 1 && currentNormalizedCount <= normalizedIndex) { finalOriginalIndex = originalText.length; }
        }
        if (normalizedIndex === normalizedText.length) return originalText.length;
        return finalOriginalIndex;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();
        const stylesPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.css');
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.js');
        const stylesUri = webview.asWebviewUri(stylesPath);
        const scriptUri = webview.asWebviewUri(scriptPath);

        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;"><link href="${stylesUri}" rel="stylesheet"><title>Code Replacer Controls</title></head><body><div class="container"><div class="input-group"><h2>Код для поиска:</h2><textarea id="findText" placeholder="Вставьте код, который нужно найти..."></textarea></div><div class="input-group"><h2>Код для замены:</h2><textarea id="replaceText" placeholder="Вставьте код, на который нужно заменить..."></textarea></div></div><div class="button-container"><button id="applyButton">Применить</button></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
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
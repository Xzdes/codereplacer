// src/astUtils.ts
import * as ts from 'typescript';
import * as vscode from 'vscode';

/**
 * Парсит строку кода в AST (Abstract Syntax Tree).
 * @param {string} code Строка кода для парсинга.
 * @param {string} [fileName='findFragment.ts'] Имя файла для контекста парсера TypeScript.
 * @returns {{ nodes: ts.Node[], sourceFile: ts.SourceFile } | null} Объект с узлами верхнего уровня и файлом источника, или null в случае ошибки.
 */
export function parseCodeToAST(code: string, fileName: string = 'findFragment.ts'): { nodes: ts.Node[], sourceFile: ts.SourceFile } | null {
    try {
        const sourceFile = ts.createSourceFile(
            fileName,
            code,
            ts.ScriptTarget.Latest,
            true, // setParentNodes
            ts.ScriptKind.TSX
        );

        // --- БЛОК ДИАГНОСТИКИ (ПРОВЕРКИ СИНТАКСИСА) ОСТАВЛЕН УДАЛЕННЫМ ---

        const statements = Array.from(sourceFile.statements);

        if (statements.length === 1) {
            const firstStatement = statements[0];
            if (ts.isExpressionStatement(firstStatement)) {
                const trimmedCode = code.trim();
                if (trimmedCode.length > 0 && trimmedCode.slice(-1) !== ';') {
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
            return { nodes: [], sourceFile };
        }
    } catch (error: any) {
        console.error("[CodeReplacerTS AST] Error during source file creation:", error);
        vscode.window.showErrorMessage(`Error parsing code to find: ${error.message || 'Unknown error'}`);
        return null;
    }
}

/**
 * Рекурсивно сравнивает два узла AST на "базовое" равенство.
 * Флаг ignoreIdentifiers применяется ТОЛЬКО на текущем уровне сравнения,
 * при рекурсивных вызовах для дочерних узлов он всегда передается как false.
 *
 * @param {ts.Node | undefined} nodeA Первый узел для сравнения.
 * @param {ts.Node | undefined} nodeB Второй узел для сравнения.
 * @param {ts.SourceFile | undefined} sourceFileA Исходный файл узла A.
 * @param {ts.SourceFile | undefined} sourceFileB Исходный файл узла B.
 * @param {number} [depth=0] Текущая глубина рекурсии (для отладки).
 * @param {boolean} [ignoreIdentifiers=false] Игнорировать ли идентификаторы (имена) на ТЕКУЩЕМ уровне.
 * @returns {boolean} true, если узлы считаются эквивалентными, иначе false.
 */
export function areNodesBasicallyEqual(
    nodeA: ts.Node | undefined,
    nodeB: ts.Node | undefined,
    sourceFileA: ts.SourceFile | undefined,
    sourceFileB: ts.SourceFile | undefined,
    depth = 0,
    ignoreIdentifiers: boolean = false // Принимаем флаг для текущего уровня
    // TODO: Добавить флаг ignoreTypes: boolean = false
): boolean {
    if (!nodeA && !nodeB) return true;
    if (!nodeA || !nodeB) return false;
    if (nodeA.kind !== nodeB.kind) return false;

    // --- Детальное сравнение по типам узлов ---
    switch (nodeA.kind) {
        case ts.SyntaxKind.Identifier:
            // Игнорируем только если флаг установлен НА ЭТОМ УРОВНЕ
            if (ignoreIdentifiers) return true;
            return (nodeA as ts.Identifier).text === (nodeB as ts.Identifier).text;

        case ts.SyntaxKind.StringLiteral: // и другие литералы
        case ts.SyntaxKind.NumericLiteral:
        case ts.SyntaxKind.RegularExpressionLiteral:
        case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
            return (nodeA as ts.LiteralLikeNode).text === (nodeB as ts.LiteralLikeNode).text;

        case ts.SyntaxKind.TrueKeyword: // и другие ключевые слова
        case ts.SyntaxKind.FalseKeyword: case ts.SyntaxKind.NullKeyword:
        case ts.SyntaxKind.UndefinedKeyword: case ts.SyntaxKind.ThisKeyword: case ts.SyntaxKind.SuperKeyword:
        case ts.SyntaxKind.VoidKeyword: case ts.SyntaxKind.ExportKeyword: case ts.SyntaxKind.StaticKeyword:
        case ts.SyntaxKind.AsyncKeyword: case ts.SyntaxKind.PublicKeyword: case ts.SyntaxKind.PrivateKeyword:
        case ts.SyntaxKind.ProtectedKeyword: case ts.SyntaxKind.ReadonlyKeyword:
            return true;

        case ts.SyntaxKind.VariableDeclaration: {
            const varDeclA = nodeA as ts.VariableDeclaration;
            const varDeclB = nodeB as ts.VariableDeclaration;
            // В рекурсивных вызовах передаем ignoreIdentifiers = false
            if (!areNodesBasicallyEqual(varDeclA.name, varDeclB.name, sourceFileA, sourceFileB, depth + 1, false)) return false;
            if (!areNodesBasicallyEqual(varDeclA.type, varDeclB.type, sourceFileA, sourceFileB, depth + 1, false)) return false;
            if (!areNodesBasicallyEqual(varDeclA.exclamationToken, varDeclB.exclamationToken, sourceFileA, sourceFileB, depth + 1, false)) return false;
            if (!areNodesBasicallyEqual(varDeclA.initializer, varDeclB.initializer, sourceFileA, sourceFileB, depth + 1, false)) return false;
            break;
        }

        case ts.SyntaxKind.VariableDeclarationList: {
            const listA = nodeA as ts.VariableDeclarationList;
            const listB = nodeB as ts.VariableDeclarationList;
            if (listA.flags !== listB.flags) return false;
            // compareNodeArrays теперь сама внутри передает false при рекурсии
            if (!compareNodeArrays(listA.declarations, listB.declarations, sourceFileA, sourceFileB, depth + 1, false)) return false;
            break;
        }

        case ts.SyntaxKind.VariableStatement: {
            const stmtA = nodeA as ts.VariableStatement;
            const stmtB = nodeB as ts.VariableStatement;
            const decoratorsA = ts.canHaveDecorators(stmtA) ? ts.getDecorators(stmtA) : undefined;
            const decoratorsB = ts.canHaveDecorators(stmtB) ? ts.getDecorators(stmtB) : undefined;
            if (!compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            const modifiersOnlyA = (stmtA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            const modifiersOnlyB = (stmtB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            if (!compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
            if (!areNodesBasicallyEqual(stmtA.declarationList, stmtB.declarationList, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        case ts.SyntaxKind.ExpressionStatement: {
            const exprStmtA = nodeA as ts.ExpressionStatement;
            const exprStmtB = nodeB as ts.ExpressionStatement;
            if (!areNodesBasicallyEqual(exprStmtA.expression, exprStmtB.expression, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        case ts.SyntaxKind.CallExpression:
        case ts.SyntaxKind.NewExpression: {
            const callA = nodeA as ts.CallExpression | ts.NewExpression;
            const callB = nodeB as ts.CallExpression | ts.NewExpression;
            if (!areNodesBasicallyEqual(callA.expression, callB.expression, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            if (!compareNodeArrays(callA.typeArguments, callB.typeArguments, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            if (!compareNodeArrays(callA.arguments, callB.arguments, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        case ts.SyntaxKind.PropertyAccessExpression:
        case ts.SyntaxKind.ElementAccessExpression: {
            const accessA = nodeA as ts.PropertyAccessExpression | ts.ElementAccessExpression;
            const accessB = nodeB as ts.PropertyAccessExpression | ts.ElementAccessExpression;
            if (!areNodesBasicallyEqual(accessA.expression, accessB.expression, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            const nameOrArgA = ts.isPropertyAccessExpression(accessA) ? accessA.name : accessA.argumentExpression;
            const nameOrArgB = ts.isPropertyAccessExpression(accessB) ? accessB.name : accessB.argumentExpression;
            // Сравниваем имя свойства или индекс как обычно (с false)
            if (!areNodesBasicallyEqual(nameOrArgA, nameOrArgB, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            if (!!accessA.questionDotToken !== !!accessB.questionDotToken) return false;
            break;
        }

        case ts.SyntaxKind.Parameter: {
            const paramA = nodeA as ts.ParameterDeclaration;
            const paramB = nodeB as ts.ParameterDeclaration;
            const decoratorsA = ts.canHaveDecorators(paramA) ? ts.getDecorators(paramA) : undefined;
            const decoratorsB = ts.canHaveDecorators(paramB) ? ts.getDecorators(paramB) : undefined;
            if (!compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            const modifiersOnlyA = (paramA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            const modifiersOnlyB = (paramB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            if (!compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
            if (!!paramA.dotDotDotToken !== !!paramB.dotDotDotToken) return false;
            if (!areNodesBasicallyEqual(paramA.name, paramB.name, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии (имя параметра важно)
            if (!!paramA.questionToken !== !!paramB.questionToken) return false;
            if (!areNodesBasicallyEqual(paramA.type, paramB.type, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            if (!areNodesBasicallyEqual(paramA.initializer, paramB.initializer, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        case ts.SyntaxKind.FunctionDeclaration: case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.Constructor: case ts.SyntaxKind.ArrowFunction:
        case ts.SyntaxKind.FunctionExpression: case ts.SyntaxKind.GetAccessor: case ts.SyntaxKind.SetAccessor: {
            const funcA = nodeA as ts.FunctionLikeDeclaration;
            const funcB = nodeB as ts.FunctionLikeDeclaration;
            const decoratorsA = ts.canHaveDecorators(funcA) ? ts.getDecorators(funcA) : undefined;
            const decoratorsB = ts.canHaveDecorators(funcB) ? ts.getDecorators(funcB) : undefined;
            if (!compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            const modifiersOnlyA = (funcA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            const modifiersOnlyB = (funcB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            if (!compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
            if (!!funcA.asteriskToken !== !!funcB.asteriskToken) return false;
            // Сравниваем имя самой функции/метода с учетом флага ignoreIdentifiers ТЕКУЩЕГО уровня
            if (!areNodesBasicallyEqual(funcA.name, funcB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Для всего остального (параметры, типы, тело) передаем false
            if (!compareNodeArrays(funcA.typeParameters, funcB.typeParameters, sourceFileA, sourceFileB, depth + 1, false)) return false;
            if (!compareNodeArrays(funcA.parameters, funcB.parameters, sourceFileA, sourceFileB, depth + 1, false)) return false;
            if (!areNodesBasicallyEqual(funcA.type, funcB.type, sourceFileA, sourceFileB, depth + 1, false)) return false;
            if (!areNodesBasicallyEqual(funcA.body, funcB.body, sourceFileA, sourceFileB, depth + 1, false)) return false;
            break;
        }

        case ts.SyntaxKind.Block: {
            const blockA = nodeA as ts.Block;
            const blockB = nodeB as ts.Block;
            if (!compareNodeArrays(blockA.statements, blockB.statements, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        case ts.SyntaxKind.IfStatement: {
            const ifA = nodeA as ts.IfStatement;
            const ifB = nodeB as ts.IfStatement;
            if (!areNodesBasicallyEqual(ifA.expression, ifB.expression, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            if (!areNodesBasicallyEqual(ifA.thenStatement, ifB.thenStatement, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            if (!areNodesBasicallyEqual(ifA.elseStatement, ifB.elseStatement, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        case ts.SyntaxKind.BinaryExpression: {
            const binA = nodeA as ts.BinaryExpression;
            const binB = nodeB as ts.BinaryExpression;
            if (binA.operatorToken.kind !== binB.operatorToken.kind) return false;
            if (!areNodesBasicallyEqual(binA.left, binB.left, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            if (!areNodesBasicallyEqual(binA.right, binB.right, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        case ts.SyntaxKind.PrefixUnaryExpression:
        case ts.SyntaxKind.PostfixUnaryExpression: {
            const unaryA = nodeA as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
            const unaryB = nodeB as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
            if (unaryA.operator !== unaryB.operator) return false;
            if (!areNodesBasicallyEqual(unaryA.operand, unaryB.operand, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        case ts.SyntaxKind.ParenthesizedExpression: {
            const parenA = nodeA as ts.ParenthesizedExpression;
            const parenB = nodeB as ts.ParenthesizedExpression;
            if (!areNodesBasicallyEqual(parenA.expression, parenB.expression, sourceFileA, sourceFileB, depth + 1, false)) return false; // false в рекурсии
            break;
        }

        // --- Общий случай для других типов узлов ---
        default: {
            const childrenA = nodeA.getChildren(sourceFileA);
            const childrenB = nodeB.getChildren(sourceFileB);
            const significantChildrenA = childrenA.filter(n => !isTriviaNode(n));
            const significantChildrenB = childrenB.filter(n => !isTriviaNode(n));
            if (significantChildrenA.length !== significantChildrenB.length) return false;
            for (let i = 0; i < significantChildrenA.length; i++) {
                 // В рекурсивных вызовах передаем ignoreIdentifiers = false
                if (!areNodesBasicallyEqual(significantChildrenA[i], significantChildrenB[i], sourceFileA, sourceFileB, depth + 1, false)) {
                    return false;
                }
            }
            break;
        }
    }
    return true;
}

/**
 * Вспомогательная функция для сравнения массивов/списков узлов AST.
 * При рекурсивном вызове areNodesBasicallyEqual всегда передает ignoreIdentifiers = false.
 *
 * @param {readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined} arrA Первый массив/список узлов.
 * @param {readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined} arrB Второй массив/список узлов.
 * @param {ts.SourceFile | undefined} sourceFileA Исходный файл узлов A.
 * @param {ts.SourceFile | undefined} sourceFileB Исходный файл узлов B.
 * @param {number} depth Глубина рекурсии для передачи в areNodesBasicallyEqual.
 * @param {boolean} ignoreIdentifiers Игнорировать ли идентификаторы (этот параметр здесь больше не используется для рекурсии).
 * @returns {boolean} true, если массивы содержат эквивалентные узлы в том же порядке, иначе false.
 */
export function compareNodeArrays(
    arrA: readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined,
    arrB: readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined,
    sourceFileA: ts.SourceFile | undefined,
    sourceFileB: ts.SourceFile | undefined,
    depth: number,
    ignoreIdentifiers: boolean // Параметр принимается, но не используется для рекурсии ниже
): boolean {
    const listA = arrA || [];
    const listB = arrB || [];
    if (listA.length !== listB.length) return false;
    for (let i = 0; i < listA.length; i++) {
        // В рекурсивных вызовах всегда передаем ignoreIdentifiers = false
        if (!areNodesBasicallyEqual(listA[i], listB[i], sourceFileA, sourceFileB, depth + 1, false)) {
            return false;
        }
    }
    return true;
}

/**
 * Вспомогательная функция для сравнения массивов модификаторов (например, export, async, static).
 * @param {readonly ts.Modifier[] | undefined} modA Первый массив модификаторов.
 * @param {readonly ts.Modifier[] | undefined} modB Второй массив модификаторов.
 * @returns {boolean} true, если массивы содержат одинаковый набор модификаторов, иначе false.
 */
export function compareModifiers(
    modA: readonly ts.Modifier[] | undefined,
    modB: readonly ts.Modifier[] | undefined
): boolean {
    const kindsA = modA ? modA.map(m => m.kind).sort() : [];
    const kindsB = modB ? modB.map(m => m.kind).sort() : [];
    if (kindsA.length !== kindsB.length) return false;
    for (let i = 0; i < kindsA.length; i++) {
        if (kindsA[i] !== kindsB[i]) {
            return false;
        }
    }
    return true;
}

/**
 * Проверяет, является ли узел "незначимым" (trivia) - комментарием или пустым синтаксическим списком.
 * @param {ts.Node} node Узел для проверки.
 * @returns {boolean} true, если узел является trivia, иначе false.
 */
export function isTriviaNode(node: ts.Node): boolean {
    return node.kind === ts.SyntaxKind.SingleLineCommentTrivia ||
           node.kind === ts.SyntaxKind.MultiLineCommentTrivia  ||
           (node.kind === ts.SyntaxKind.SyntaxList && node.getChildCount() === 0);
}
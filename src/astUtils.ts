// src/astUtils.ts
import * as ts from 'typescript';
import * as vscode from 'vscode'; // Импортируем vscode для показа сообщений об ошибках

/**
 * Парсит строку кода в AST (Abstract Syntax Tree).
 * Используется для анализа структуры кода JavaScript/TypeScript.
 * ВАЖНО: Удалена проверка синтаксиса (diagnostics), так как используемая
 * версия TypeScript могла быть старой. Рекомендуется обновить TypeScript.
 *
 * @param {string} code Строка кода для парсинга.
 * @param {string} [fileName='findFragment.ts'] Имя файла для контекста парсера TypeScript.
 * @returns {{ nodes: ts.Node[], sourceFile: ts.SourceFile } | null} Объект с узлами верхнего уровня и файлом источника, или null в случае ошибки.
 */
export function parseCodeToAST(code: string, fileName: string = 'findFragment.ts'): { nodes: ts.Node[], sourceFile: ts.SourceFile } | null {
    try {
        const sourceFile = ts.createSourceFile(
            fileName,
            code,
            ts.ScriptTarget.Latest, // Целевая версия JS (можно выбрать ESNext или ES2015 и т.д.)
            true, // setParentNodes - важно для навигации по дереву
            ts.ScriptKind.TSX // Парсим как TSX для поддержки JSX в JS/TS файлах
        );

        // --- БЛОК ДИАГНОСТИКИ (ПРОВЕРКИ СИНТАКСИСА) ОСТАВЛЕН УДАЛЕННЫМ ---
        // Если нужна проверка, нужно убедиться, что версия TS поддерживает getSyntacticDiagnostics
        // const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([fileName], {})); // Примерно так
        // if (diagnostics.length > 0) {
        //     const errors = diagnostics.map(d => d.messageText).join('\n');
        //     console.warn(`[CodeReplacerTS AST] Syntax errors found in find text: ${errors}`);
        //     // Возможно, стоит прервать выполнение или сообщить пользователю
        //     // vscode.window.showWarningMessage(`Syntax errors in find text: ${errors}`);
        //     // return null; // или продолжить парсинг, если ошибки не критичны
        // }

        // Узлы верхнего уровня (операторы или выражения)
        const statements = Array.from(sourceFile.statements);

        // Пытаемся определить, это одно выражение или набор операторов
        if (statements.length === 1) {
            const firstStatement = statements[0];
            // Если это ExpressionStatement (например, `myFunc(1);` или `a + b`)
            // и код не заканчивается точкой с запятой (признак выражения, а не оператора),
            // то возвращаем само выражение.
            if (ts.isExpressionStatement(firstStatement)) {
                // Проверяем, был ли код явно завершен точкой с запятой
                const trimmedCode = code.trim();
                if (trimmedCode.length > 0 && trimmedCode.slice(-1) !== ';') {
                    console.log("[CodeReplacerTS AST] Parsed as a single Expression.");
                    // Возвращаем само выражение (например, узел CallExpression)
                    return { nodes: [firstStatement.expression], sourceFile };
                }
            }
            // Иначе (это один оператор, например, `const a = 1;` или `myFunc(1);`)
            console.log(`[CodeReplacerTS AST] Parsed as ${statements.length} Statement(s).`);
            return { nodes: statements, sourceFile };
        } else if (statements.length > 0) {
            // Несколько операторов (например, `const a = 1; console.log(a);`)
            console.log(`[CodeReplacerTS AST] Parsed as ${statements.length} Statement(s).`);
            return { nodes: statements, sourceFile };
        } else {
            // Пустой ввод или только комментарии
            console.log("[CodeReplacerTS AST] No statements or expressions found in find text.");
            // Возвращаем пустой массив узлов, но валидный sourceFile, если парсинг прошел
            return { nodes: [], sourceFile };
           // Или можно вернуть null, если считать это ошибкой
           // return null;
        }
    } catch (error: any) {
        // Ловим ошибки самого парсера ts.createSourceFile (редко)
        console.error("[CodeReplacerTS AST] Error during source file creation:", error);
        vscode.window.showErrorMessage(`Error parsing code to find: ${error.message || 'Unknown error'}`);
        return null;
    }
}

/**
 * Рекурсивно сравнивает два узла AST на "базовое" равенство.
 * Игнорирует комментарии, пробелы, форматирование и опционально идентификаторы.
 *
 * @param {ts.Node | undefined} nodeA Первый узел для сравнения.
 * @param {ts.Node | undefined} nodeB Второй узел для сравнения.
 * @param {ts.SourceFile | undefined} sourceFileA Исходный файл узла A (нужен для getChildren).
 * @param {ts.SourceFile | undefined} sourceFileB Исходный файл узла B.
 * @param {number} [depth=0] Текущая глубина рекурсии (для отладки).
 * @param {boolean} [ignoreIdentifiers=false] Игнорировать ли имена переменных/функций при сравнении.
 * @returns {boolean} true, если узлы считаются эквивалентными, иначе false.
 */
export function areNodesBasicallyEqual(
    nodeA: ts.Node | undefined,
    nodeB: ts.Node | undefined,
    sourceFileA: ts.SourceFile | undefined,
    sourceFileB: ts.SourceFile | undefined,
    depth = 0,
    ignoreIdentifiers: boolean = false
): boolean {
    // Базовые случаи: оба null/undefined -> равны, один null/undefined -> не равны
    if (!nodeA && !nodeB) return true;
    if (!nodeA || !nodeB) return false;

    // Сравниваем тип узла (Kind)
    if (nodeA.kind !== nodeB.kind) return false;

    // --- Детальное сравнение по типам узлов ---
    // (Логика оставлена такой же, как в исходном файле, но теперь это отдельная функция)
    switch (nodeA.kind) {
        // Идентификаторы (переменные, имена функций и т.д.)
        case ts.SyntaxKind.Identifier:
            if (ignoreIdentifiers) return true; // Если включено игнорирование имен
            return (nodeA as ts.Identifier).text === (nodeB as ts.Identifier).text;

        // Литералы (строки, числа, регулярки, шаблонные строки без вставок)
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NumericLiteral:
        case ts.SyntaxKind.RegularExpressionLiteral:
        case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
            return (nodeA as ts.LiteralLikeNode).text === (nodeB as ts.LiteralLikeNode).text;

        // Простые ключевые слова (всегда равны, если kind совпал)
        case ts.SyntaxKind.TrueKeyword: case ts.SyntaxKind.FalseKeyword: case ts.SyntaxKind.NullKeyword:
        case ts.SyntaxKind.UndefinedKeyword: case ts.SyntaxKind.ThisKeyword: case ts.SyntaxKind.SuperKeyword:
        case ts.SyntaxKind.VoidKeyword: case ts.SyntaxKind.ExportKeyword: case ts.SyntaxKind.StaticKeyword:
        case ts.SyntaxKind.AsyncKeyword: case ts.SyntaxKind.PublicKeyword: case ts.SyntaxKind.PrivateKeyword:
        case ts.SyntaxKind.ProtectedKeyword: case ts.SyntaxKind.ReadonlyKeyword:
            return true;

        // Объявление переменной (var/let/const name: type = initializer)
        case ts.SyntaxKind.VariableDeclaration: {
            const varDeclA = nodeA as ts.VariableDeclaration;
            const varDeclB = nodeB as ts.VariableDeclaration;
            // Сравниваем рекурсивно имя, тип, восклицательный знак (non-null assertion) и инициализатор
            if (!areNodesBasicallyEqual(varDeclA.name, varDeclB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            if (!areNodesBasicallyEqual(varDeclA.type, varDeclB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            if (!areNodesBasicallyEqual(varDeclA.exclamationToken, varDeclB.exclamationToken, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            if (!areNodesBasicallyEqual(varDeclA.initializer, varDeclB.initializer, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break; // Переходим к общей проверке дочерних узлов (если она нужна)
        }

        // Список объявлений переменных (let a=1, b=2)
        case ts.SyntaxKind.VariableDeclarationList: {
            const listA = nodeA as ts.VariableDeclarationList;
            const listB = nodeB as ts.VariableDeclarationList;
            // Сравниваем флаги (let, const, var)
            if (listA.flags !== listB.flags) return false;
            // Сравниваем массивы объявлений
            if (!compareNodeArrays(listA.declarations, listB.declarations, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Оператор объявления переменных (export const a = 1;)
        case ts.SyntaxKind.VariableStatement: {
            const stmtA = nodeA as ts.VariableStatement;
            const stmtB = nodeB as ts.VariableStatement;
            // Сравниваем декораторы
            const decoratorsA = ts.canHaveDecorators(stmtA) ? ts.getDecorators(stmtA) : undefined;
            const decoratorsB = ts.canHaveDecorators(stmtB) ? ts.getDecorators(stmtB) : undefined;
            if (!compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем модификаторы (export, async, static и т.д., исключая декораторы)
            const modifiersOnlyA = (stmtA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            const modifiersOnlyB = (stmtB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            if (!compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
            // Сравниваем список объявлений
            if (!areNodesBasicallyEqual(stmtA.declarationList, stmtB.declarationList, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Оператор-выражение (myFunc(); или a++;)
        case ts.SyntaxKind.ExpressionStatement: {
            const exprStmtA = nodeA as ts.ExpressionStatement;
            const exprStmtB = nodeB as ts.ExpressionStatement;
            // Сравниваем само выражение
            if (!areNodesBasicallyEqual(exprStmtA.expression, exprStmtB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Вызов функции (myFunc(a, b)) или создание экземпляра (new MyClass(a))
        case ts.SyntaxKind.CallExpression:
        case ts.SyntaxKind.NewExpression: {
            const callA = nodeA as ts.CallExpression | ts.NewExpression;
            const callB = nodeB as ts.CallExpression | ts.NewExpression;
            // Сравниваем вызываемое выражение (myFunc или new MyClass)
            if (!areNodesBasicallyEqual(callA.expression, callB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем generic-аргументы (типы в <>)
            if (!compareNodeArrays(callA.typeArguments, callB.typeArguments, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем аргументы вызова (в скобках)
            if (!compareNodeArrays(callA.arguments, callB.arguments, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Доступ к свойству (obj.prop) или элементу (arr[index])
        case ts.SyntaxKind.PropertyAccessExpression:
        case ts.SyntaxKind.ElementAccessExpression: {
            const accessA = nodeA as ts.PropertyAccessExpression | ts.ElementAccessExpression;
            const accessB = nodeB as ts.PropertyAccessExpression | ts.ElementAccessExpression;
            // Сравниваем базовое выражение (obj или arr)
            if (!areNodesBasicallyEqual(accessA.expression, accessB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем имя свойства (prop) или выражение индекса (index)
            const nameOrArgA = ts.isPropertyAccessExpression(accessA) ? accessA.name : accessA.argumentExpression;
            const nameOrArgB = ts.isPropertyAccessExpression(accessB) ? accessB.name : accessB.argumentExpression;
            if (!areNodesBasicallyEqual(nameOrArgA, nameOrArgB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем наличие опциональной цепочки (?.)
            if (!!accessA.questionDotToken !== !!accessB.questionDotToken) return false; // !! преобразует в boolean
            break;
        }

        // Параметр функции/метода (param: type = defaultValue)
        case ts.SyntaxKind.Parameter: {
            const paramA = nodeA as ts.ParameterDeclaration;
            const paramB = nodeB as ts.ParameterDeclaration;
            // Сравниваем декораторы
            const decoratorsA = ts.canHaveDecorators(paramA) ? ts.getDecorators(paramA) : undefined;
            const decoratorsB = ts.canHaveDecorators(paramB) ? ts.getDecorators(paramB) : undefined;
            if (!compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем модификаторы (public, private, readonly и т.д.)
            const modifiersOnlyA = (paramA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            const modifiersOnlyB = (paramB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            if (!compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
            // Сравниваем наличие rest-параметра (...)
            if (!!paramA.dotDotDotToken !== !!paramB.dotDotDotToken) return false;
            // Сравниваем имя параметра
            if (!areNodesBasicallyEqual(paramA.name, paramB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем наличие опционального знака (?)
            if (!!paramA.questionToken !== !!paramB.questionToken) return false;
            // Сравниваем тип параметра
            if (!areNodesBasicallyEqual(paramA.type, paramB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем значение по умолчанию
            if (!areNodesBasicallyEqual(paramA.initializer, paramB.initializer, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Объявления функций, методов, конструкторов, стрелочных функций, геттеров, сеттеров
        case ts.SyntaxKind.FunctionDeclaration: case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.Constructor: case ts.SyntaxKind.ArrowFunction:
        case ts.SyntaxKind.FunctionExpression: case ts.SyntaxKind.GetAccessor: case ts.SyntaxKind.SetAccessor: {
            const funcA = nodeA as ts.FunctionLikeDeclaration; // Общий тип для всех *Like
            const funcB = nodeB as ts.FunctionLikeDeclaration;
            // Сравниваем декораторы
            const decoratorsA = ts.canHaveDecorators(funcA) ? ts.getDecorators(funcA) : undefined;
            const decoratorsB = ts.canHaveDecorators(funcB) ? ts.getDecorators(funcB) : undefined;
            if (!compareNodeArrays(decoratorsA, decoratorsB, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем модификаторы (async, export, static и т.д.)
            const modifiersOnlyA = (funcA.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            const modifiersOnlyB = (funcB.modifiers || []).filter(ts.isModifier) as ts.Modifier[];
            if (!compareModifiers(modifiersOnlyA, modifiersOnlyB)) return false;
            // Сравниваем наличие генератора (*)
            if (!!funcA.asteriskToken !== !!funcB.asteriskToken) return false;
            // Сравниваем имя (если есть)
            if (!areNodesBasicallyEqual(funcA.name, funcB.name, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем generic-параметры (типы в <>)
            if (!compareNodeArrays(funcA.typeParameters, funcB.typeParameters, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем параметры функции
            if (!compareNodeArrays(funcA.parameters, funcB.parameters, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем возвращаемый тип
            if (!areNodesBasicallyEqual(funcA.type, funcB.type, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем тело функции/метода
            if (!areNodesBasicallyEqual(funcA.body, funcB.body, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Блок кода ({ ... })
        case ts.SyntaxKind.Block: {
            const blockA = nodeA as ts.Block;
            const blockB = nodeB as ts.Block;
            // Сравниваем операторы внутри блока
            if (!compareNodeArrays(blockA.statements, blockB.statements, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Условный оператор (if (condition) thenStmt else elseStmt)
        case ts.SyntaxKind.IfStatement: {
            const ifA = nodeA as ts.IfStatement;
            const ifB = nodeB as ts.IfStatement;
            // Сравниваем условие
            if (!areNodesBasicallyEqual(ifA.expression, ifB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем then-блок
            if (!areNodesBasicallyEqual(ifA.thenStatement, ifB.thenStatement, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем else-блок
            if (!areNodesBasicallyEqual(ifA.elseStatement, ifB.elseStatement, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Бинарные операции (a + b, a === b, a && b)
        case ts.SyntaxKind.BinaryExpression: {
            const binA = nodeA as ts.BinaryExpression;
            const binB = nodeB as ts.BinaryExpression;
            // Сравниваем тип оператора (+, ===, && и т.д.)
            if (binA.operatorToken.kind !== binB.operatorToken.kind) return false;
            // Сравниваем левый операнд
            if (!areNodesBasicallyEqual(binA.left, binB.left, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            // Сравниваем правый операнд
            if (!areNodesBasicallyEqual(binA.right, binB.right, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // Унарные операции (префиксные: ++a, !a; постфиксные: a++)
        case ts.SyntaxKind.PrefixUnaryExpression:
        case ts.SyntaxKind.PostfixUnaryExpression: {
            const unaryA = nodeA as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
            const unaryB = nodeB as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
            // Сравниваем тип оператора (++, --, !, ~ и т.д.)
            if (unaryA.operator !== unaryB.operator) return false;
            // Сравниваем операнд
            if (!areNodesBasicallyEqual(unaryA.operand, unaryB.operand, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

         // Выражение в скобках ((a + b))
        case ts.SyntaxKind.ParenthesizedExpression: {
            const parenA = nodeA as ts.ParenthesizedExpression;
            const parenB = nodeB as ts.ParenthesizedExpression;
             // Сравниваем выражение внутри скобок
            if (!areNodesBasicallyEqual(parenA.expression, parenB.expression, sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) return false;
            break;
        }

        // --- Общий случай для других типов узлов ---
        // Если тип узла не обработан явно выше, сравниваем рекурсивно всех значащих дочерних узлов.
        default: {
            const childrenA = nodeA.getChildren(sourceFileA);
            const childrenB = nodeB.getChildren(sourceFileB);

            // Фильтруем незначимые узлы (комментарии, пустые списки)
            const significantChildrenA = childrenA.filter(n => !isTriviaNode(n));
            const significantChildrenB = childrenB.filter(n => !isTriviaNode(n));

            // Если количество значащих дочерних узлов разное, узлы не равны
            if (significantChildrenA.length !== significantChildrenB.length) return false;

            // Сравниваем рекурсивно каждую пару дочерних узлов
            for (let i = 0; i < significantChildrenA.length; i++) {
                if (!areNodesBasicallyEqual(significantChildrenA[i], significantChildrenB[i], sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) {
                    return false;
                }
            }
            break; // Если все дочерние узлы равны, переходим к return true
        }
    }

    // Если все проверки пройдены (и kind совпал, и специфичные поля/дети равны)
    return true;
}

/**
 * Вспомогательная функция для сравнения массивов/списков узлов AST.
 *
 * @param {readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined} arrA Первый массив/список узлов.
 * @param {readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined} arrB Второй массив/список узлов.
 * @param {ts.SourceFile | undefined} sourceFileA Исходный файл узлов A.
 * @param {ts.SourceFile | undefined} sourceFileB Исходный файл узлов B.
 * @param {number} depth Глубина рекурсии для передачи в areNodesBasicallyEqual.
 * @param {boolean} ignoreIdentifiers Игнорировать ли идентификаторы.
 * @returns {boolean} true, если массивы содержат эквивалентные узлы в том же порядке, иначе false.
 */
export function compareNodeArrays(
    arrA: readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined,
    arrB: readonly ts.Node[] | ts.NodeArray<ts.Node> | undefined,
    sourceFileA: ts.SourceFile | undefined,
    sourceFileB: ts.SourceFile | undefined,
    depth: number,
    ignoreIdentifiers: boolean
): boolean {
    const listA = arrA || []; // Обрабатываем undefined как пустой массив
    const listB = arrB || [];

    // Если длины массивов разные, они не равны
    if (listA.length !== listB.length) return false;

    // Сравниваем каждый элемент массивов попарно
    for (let i = 0; i < listA.length; i++) {
        if (!areNodesBasicallyEqual(listA[i], listB[i], sourceFileA, sourceFileB, depth + 1, ignoreIdentifiers)) {
            return false; // Если хоть одна пара не равна, весь массив не равен
        }
    }

    // Если все элементы попарно равны
    return true;
}

/**
 * Вспомогательная функция для сравнения массивов модификаторов (например, export, async, static).
 * Порядок модификаторов не важен.
 *
 * @param {readonly ts.Modifier[] | undefined} modA Первый массив модификаторов.
 * @param {readonly ts.Modifier[] | undefined} modB Второй массив модификаторов.
 * @returns {boolean} true, если массивы содержат одинаковый набор модификаторов, иначе false.
 */
export function compareModifiers(
    modA: readonly ts.Modifier[] | undefined,
    modB: readonly ts.Modifier[] | undefined
): boolean {
    // Получаем типы (kind) модификаторов и сортируем их для сравнения независимо от порядка
    const kindsA = modA ? modA.map(m => m.kind).sort() : [];
    const kindsB = modB ? modB.map(m => m.kind).sort() : [];

    // Если количество модификаторов разное, наборы не равны
    if (kindsA.length !== kindsB.length) return false;

    // Сравниваем отсортированные типы
    for (let i = 0; i < kindsA.length; i++) {
        if (kindsA[i] !== kindsB[i]) {
            return false; // Если найден разный тип, наборы не равны
        }
    }

    // Если все типы совпали
    return true;
}

/**
 * Проверяет, является ли узел "незначимым" (trivia) - комментарием или пустым синтаксическим списком.
 * Такие узлы обычно игнорируются при сравнении структуры кода.
 *
 * @param {ts.Node} node Узел для проверки.
 * @returns {boolean} true, если узел является trivia, иначе false.
 */
export function isTriviaNode(node: ts.Node): boolean {
    return node.kind === ts.SyntaxKind.SingleLineCommentTrivia || // Однострочный комментарий (// ...)
           node.kind === ts.SyntaxKind.MultiLineCommentTrivia  || // Многострочный комментарий (/* ... */)
           // Пустой синтаксический список (например, список без элементов)
           (node.kind === ts.SyntaxKind.SyntaxList && node.getChildCount() === 0);
}
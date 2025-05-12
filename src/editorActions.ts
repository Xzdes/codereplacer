// src/editorActions.ts
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { getDecorationType, getMatchedResults, setMatchedResults, clearMatchedResults } from './state';
import { parseCodeToAST, areNodesBasicallyEqual } from './astUtils';
import { normalizeAndCleanText } from './textUtils';

/**
 * Выполняет текстовый поиск в документе, используя нормализацию.
 * Пытается найти приблизительный оригинальный диапазон для каждого совпадения.
 *
 * @param {vscode.TextDocument} document Документ для поиска.
 * @param {string} textToFind Текст для поиска.
 * @param {string} languageId ID языка документа.
 * @param {string} textToReplace Текст для замены (для hover-сообщения).
 * @param {boolean} isFallback Указывает, вызывается ли функция как fallback после AST.
 * @returns {Promise<{ range: vscode.Range, decoration: vscode.DecorationOptions, mode: 'text' }[]>} Массив найденных результатов.
 */
async function _performTextSearch(
    document: vscode.TextDocument,
    textToFind: string,
    languageId: string,
    textToReplace: string,
    isFallback: boolean
): Promise<{ range: vscode.Range, decoration: vscode.DecorationOptions, mode: 'text' }[]> {
    const results: { range: vscode.Range, decoration: vscode.DecorationOptions, mode: 'text' }[] = [];
    const logPrefix = `[CodeReplacerTS EditorActions Text${isFallback ? ' Fallback' : ''}]`;
    const trimmedTextToFind = textToFind.trim(); // Используем обрезанный текст для логики

    try {
        const normalizedTarget = normalizeAndCleanText(trimmedTextToFind, languageId);
        if (!normalizedTarget) {
            console.log(`${logPrefix} Normalized find text is empty.`);
            return []; // Нечего искать
        }
        console.log(`${logPrefix} Searching for normalized text: "${normalizedTarget.substring(0, 70)}..."`);

        const documentText = document.getText();
        // Проверка на случай пустого нормализованного документа
        const normalizedDocument = normalizeAndCleanText(documentText, languageId);
        if (!normalizedDocument) {
            console.log(`${logPrefix} Normalized document text is empty.`);
            return [];
        }

        let searchStartIndex = 0;
        let matchIndex = -1;
        const processedRanges: vscode.Range[] = []; // Для предотвращения дубликатов из-за неточности

        while ((matchIndex = normalizedDocument.indexOf(normalizedTarget, searchStartIndex)) !== -1) {
            console.log(`${logPrefix} Found potential match at normalized index: ${matchIndex}`);

            // --- Приблизительное определение оригинального диапазона ---
            const linesToFind = trimmedTextToFind.split('\n');
            const firstSignificantLine = linesToFind.find(line => line.trim() !== '');
            const firstLineTrimmed = firstSignificantLine ? firstSignificantLine.trim() : '';

            if (firstLineTrimmed) {
                 // Коэффициент масштабирования + проверка деления на ноль
                 const scaleFactor = documentText.length / Math.max(1, normalizedDocument.length);
                 const approxOriginalIndex = Math.round(matchIndex * scaleFactor);
                 // Увеличим радиус поиска для большей надежности
                 const searchRadius = Math.max(200, trimmedTextToFind.length * 3);
                 const searchStartOriginal = Math.max(0, approxOriginalIndex - searchRadius);
                 // Ищем в широком диапазоне, чтобы захватить весь фрагмент
                 const searchEndOriginal = Math.min(documentText.length, approxOriginalIndex + searchRadius + trimmedTextToFind.length);
                 const snippet = documentText.substring(searchStartOriginal, searchEndOriginal);

                 // Ищем первое НЕпустое вхождение ПЕРВОЙ строки искомого текста в окрестности
                 const indexInSnippet = snippet.indexOf(firstLineTrimmed);

                 if (indexInSnippet !== -1) {
                     const originalStart = searchStartOriginal + indexInSnippet;

                     // Попытка найти конец более точно, ища ПОСЛЕДНЮЮ непустую строку
                     let originalEnd = originalStart + trimmedTextToFind.length; // Конец по умолчанию
                     const lastSignificantLine = [...linesToFind].reverse().find(line => line.trim() !== '');
                     const lastLineTrimmed = lastSignificantLine ? lastSignificantLine.trim() : '';

                     if (lastLineTrimmed) {
                         // Ищем последнее вхождение последней строки в разумном диапазоне после начала
                         const endSearchStart = originalStart + Math.max(0, trimmedTextToFind.length - lastLineTrimmed.length - 50); // Начать поиск конца немного раньше
                         const endSearchEnd = Math.min(documentText.length, originalStart + trimmedTextToFind.length + searchRadius);
                         const endSnippet = documentText.substring(endSearchStart, endSearchEnd);
                         const lastLineIndexInEndSnippet = endSnippet.lastIndexOf(lastLineTrimmed);

                         if (lastLineIndexInEndSnippet !== -1) {
                            // Рассчитываем конец на основе найденной последней строки
                             originalEnd = endSearchStart + lastLineIndexInEndSnippet + lastLineTrimmed.length;
                         }
                     }
                     // Гарантируем, что конец не выходит за пределы документа
                     originalEnd = Math.min(documentText.length, originalEnd);
                     // Гарантируем, что конец не раньше начала
                     if (originalEnd < originalStart) originalEnd = originalStart + trimmedTextToFind.length;
                     originalEnd = Math.min(documentText.length, originalEnd); // Повторная проверка

                     const startPos = document.positionAt(originalStart);
                     const endPos = document.positionAt(originalEnd);
                     const range = new vscode.Range(startPos, endPos);

                     // Проверка на дубликаты диапазонов
                     if (!processedRanges.some(r => r.isEqual(range))) {
                        processedRanges.push(range);

                        // Создание hover-сообщения
                        const hoverMessage = new vscode.MarkdownString();
                        hoverMessage.isTrusted = true; // Для возможных будущих команд
                        hoverMessage.appendCodeblock(document.getText(range), languageId); // Оригинальный текст
                        hoverMessage.appendMarkdown('\n---\n**Will be replaced with:**\n');
                        hoverMessage.appendCodeblock(textToReplace || '<<DELETE>>', languageId);
                        const matchType = isFallback ? 'Fallback Text Match' : 'Text Match';
                        hoverMessage.appendMarkdown(`\n*(${matchType} - May be approximate)*`);

                        const decoration: vscode.DecorationOptions = { range, hoverMessage };
                        results.push({ range, decoration, mode: 'text' }); // Mode всегда 'text' для этого поиска
                        console.log(`${logPrefix} Added approximate range: ${range.start.line + 1}:${range.start.character}-${range.end.line + 1}:${range.end.character}`);
                     } else {
                         console.log(`${logPrefix} Skipping duplicate approximate range.`);
                     }
                 } else {
                     console.log(`${logPrefix} Could not reliably map normalized index ${matchIndex} back to original document (first line '${firstLineTrimmed.substring(0, 30)}...' not found in vicinity).`);
                 }
            } else {
                console.log(`${logPrefix} Cannot determine original range because find text is empty or whitespace only.`);
            }

            // Перемещаем индекс для следующего поиска, чтобы найти следующее вхождение
            searchStartIndex = matchIndex + 1; // Начать следующий поиск со следующего символа
        }
    } catch (error: any) {
        console.error(`${logPrefix} Error during text processing:`, error);
        vscode.window.showErrorMessage(`Text Analysis Error: ${error.message || 'Unknown error'}`);
    }
    return results; // Возвращаем массив найденных результатов
}
export async function highlightTextInEditor(textToFind: string, textToReplace: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    console.log('[CodeReplacerTS EditorActions] Highlighting text... Editor active:', !!editor);

    // Очищаем предыдущие результаты ПЕРЕД началом нового поиска
    clearHighlights(editor); // clearHighlights вызывает clearMatchedResults внутри

    if (!editor) {
        console.log('[CodeReplacerTS EditorActions] No active editor.');
        return;
    }

    const document = editor.document;
    const languageId = document.languageId;
    const documentText = document.getText(); // Получаем текст один раз
    const trimmedTextToFind = textToFind.trim();

    if (!trimmedTextToFind) {
        console.log('[CodeReplacerTS EditorActions] Find text is empty after trimming.');
        // Подсветка уже очищена, выходим
        return;
    }

    const localMatchedResults: { range: vscode.Range, mode: 'ast' | 'text' }[] = [];
    const decorationsArray: vscode.DecorationOptions[] = [];

    // Определяем поддерживаемые режимы
    const isAstSupported = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(languageId);
    const isTextSupported = ['css', 'html', 'json', 'jsonc', 'xml', 'less', 'scss', 'python', 'ruby', 'shellscript', 'java', 'csharp', 'php', 'go', 'rust'].includes(languageId);

    try {
        if (isAstSupported) {
            console.log(`[CodeReplacerTS EditorActions] Using AST mode for language: ${languageId}`);
            let astFoundMatches = false; // Флаг, что AST что-то нашел

            try {
                 // --- AST Поиск ---
                 const parseResult = parseCodeToAST(trimmedTextToFind); // Используем утилиту
                 if (parseResult && parseResult.nodes.length > 0) {
                     const findNodes = parseResult.nodes;
                     const findSourceFile = parseResult.sourceFile;
                     console.log(`[CodeReplacerTS EditorActions AST] Attempting to match sequence of ${findNodes.length} node(s). First kind: ${ts.SyntaxKind[findNodes[0].kind]}`);

                     // Парсим текущий документ
                     const documentSourceFile = ts.createSourceFile(
                         document.fileName,
                         documentText,
                         ts.ScriptTarget.Latest,
                         true, // setParentNodes
                         ts.ScriptKind.Unknown // Позволяем TS определить тип (TS, TSX, JS, JSX) по расширению файла
                     );

                     // Функция для поиска последовательности узлов в списке соседей
                     const findASTSequences = (siblings: readonly ts.Node[]) => {
                         if (!siblings || siblings.length < findNodes.length) {
                             return; // Не может быть совпадения
                         }
                         // Идем по соседям, проверяя возможность совпадения последовательности
                         for (let i = 0; i <= siblings.length - findNodes.length; i++) {
                             let sequenceMatch = true;
                             // Сравниваем каждый узел искомой последовательности с текущей позицией в соседях
                             for (let j = 0; j < findNodes.length; j++) {
                                 if (!areNodesBasicallyEqual(siblings[i + j], findNodes[j], documentSourceFile, findSourceFile, 0)) {
                                     sequenceMatch = false;
                                     break; // Если один узел не совпал, вся последовательность не подходит
                                 }
                             }

                             if (sequenceMatch) {
                                 // Последовательность совпала!
                                 const firstNode = siblings[i];
                                 const lastNode = siblings[i + findNodes.length - 1];
                                 console.log(`[CodeReplacerTS EditorActions AST Sequence Match FOUND] Node kinds: ${findNodes.map(n => ts.SyntaxKind[n.kind]).join(', ')}. Starts at doc pos ${firstNode.getStart(documentSourceFile)}`);

                                 try {
                                     // Определяем диапазон в документе
                                     const start = firstNode.getStart(documentSourceFile);
                                     const end = lastNode.getEnd(); // getEnd() включает конечные пробелы/комментарии узла
                                     const startPos = document.positionAt(start);
                                     const endPos = document.positionAt(end);
                                     const range = new vscode.Range(startPos, endPos);

                                     // Создаем hover message с предпросмотром
                                     const hoverMessage = new vscode.MarkdownString();
                                     hoverMessage.isTrusted = true; // Разрешаем команды
                                     hoverMessage.appendCodeblock(document.getText(range), languageId); // Показываем найденный код
                                     hoverMessage.appendMarkdown('\n---\n**Will be replaced with:**\n');
                                     hoverMessage.appendCodeblock(textToReplace || '<<DELETE>>', languageId); // Показываем код для замены или <<DELETE>>
                                     hoverMessage.appendMarkdown(`\n*(AST Match, ${findNodes.length} node${findNodes.length > 1 ? 's': ''})*`);

                                     // Добавляем декорацию и результат
                                     decorationsArray.push({ range, hoverMessage });
                                     localMatchedResults.push({ range, mode: 'ast' });
                                     astFoundMatches = true; // Устанавливаем флаг

                                     // Пропускаем проверенные узлы, чтобы не находить перекрывающиеся совпадения той же последовательности
                                     i += findNodes.length - 1;
                                 } catch (rangeError: any) {
                                     console.error(`[CodeReplacerTS EditorActions AST] Error calculating range or creating hover message:`, rangeError.message);
                                 }
                             }
                         } // Конец цикла for (по 'i')
                     }; // Конец функции findASTSequences

                     // Рекурсивная функция обхода дерева AST документа
                     const visit = (node: ts.Node) => {
                         // Ищем совпадения среди прямых потомков текущего узла
                         const children = node.getChildren(documentSourceFile);
                         findASTSequences(children);
                         // Рекурсивно обходим каждого потомка
                         children.forEach(visit);
                     };

                     console.log(`[CodeReplacerTS EditorActions AST] Starting AST search in: ${document.fileName}`);
                     visit(documentSourceFile); // Начинаем обход с корневого узла документа
                     console.log(`[CodeReplacerTS EditorActions AST] AST search finished. Found matches: ${astFoundMatches}`);

                 } else {
                     console.log('[CodeReplacerTS EditorActions AST] Could not parse find text or no nodes found for AST search.');
                     // Не показываем ошибку, так как попробуем fallback
                 }
             } catch (astError: any) {
                 console.error("[CodeReplacerTS EditorActions AST] Error during AST processing:", astError);
                 vscode.window.showErrorMessage(`AST Analysis Error: ${astError.message || 'Unknown error'}`);
                 // Если AST упал с ошибкой, не пытаемся делать fallback, выходим
                 return;
             }

            // --- Fallback на текстовый поиск, ЕСЛИ AST ничего не нашел ---
            if (!astFoundMatches) {
                console.log('[CodeReplacerTS EditorActions] AST search yielded no results. Falling back to Text search for', languageId);
                // Вызываем нашу новую вспомогательную функцию
                const textSearchResults = await _performTextSearch(document, textToFind, languageId, textToReplace, true); // isFallback = true

                // Добавляем результаты текстового поиска к общим результатам
                textSearchResults.forEach(result => {
                    // Дополнительная проверка, чтобы избежать дублирования, если диапазон чудом совпал
                    if (!localMatchedResults.some(existing => existing.range.isEqual(result.range))) {
                       decorationsArray.push(result.decoration);
                       localMatchedResults.push({ range: result.range, mode: result.mode }); // mode = 'text'
                    }
                });

                 if (textSearchResults.length > 0) {
                     console.log(`[CodeReplacerTS EditorActions] Found ${textSearchResults.length} matches via Text fallback.`);
                 } else {
                      console.log('[CodeReplacerTS EditorActions] Text fallback search also yielded no results.');
                 }
            }
        // --- Конец блока isAstSupported ---

        } else if (isTextSupported) {
            // --- Обычный текстовый поиск для других языков ---
            console.log(`[CodeReplacerTS EditorActions] Using Text mode for language: ${languageId}`);
            // Вызываем нашу новую вспомогательную функцию
            const textSearchResults = await _performTextSearch(document, textToFind, languageId, textToReplace, false); // isFallback = false

            // Добавляем результаты к общим
            textSearchResults.forEach(result => {
                 decorationsArray.push(result.decoration);
                 localMatchedResults.push({ range: result.range, mode: result.mode });
            });

        } else {
            // Язык не поддерживается
            console.log(`[CodeReplacerTS EditorActions] Language not supported for search: ${languageId}`);
            vscode.window.showInformationMessage(`Language '${languageId}' is not currently supported for search/replace.`);
            return; // Выходим, если язык не поддерживается
        }

    } catch (error: any) {
        // Глобальная обработка ошибок на случай непредвиденных проблем
        console.error("[CodeReplacerTS EditorActions] Unexpected error during search execution:", error);
        vscode.window.showErrorMessage(`An unexpected error occurred during the search: ${error.message || 'Unknown error'}`);
        return; // Выходим при глобальной ошибке
    }

    // --- Завершение: Сохранение результатов и применение декораций ---
    setMatchedResults(localMatchedResults); // Сохраняем ВСЕ найденные результаты (AST или Text)

    // Применяем подсветку, если что-то нашли
    if (editor && decorationsArray.length > 0) {
        try {
             const decorationType = getDecorationType(); // Получаем тип декоратора из состояния
             editor.setDecorations(decorationType, decorationsArray);
             console.log(`[CodeReplacerTS EditorActions] Applied ${decorationsArray.length} decorations.`);
        } catch (decorationError: any) {
             // Ловим ошибки, связанные с применением декораций (например, невалидный диапазон)
             console.error("[CodeReplacerTS EditorActions] Error applying decorations:", decorationError);
             vscode.window.showErrorMessage(`Error applying highlights: ${decorationError.message || 'Check debug console'}`);
             // Очищаем потенциально некорректные результаты, чтобы избежать проблем при замене
             clearHighlights(editor); // Это также очистит localMatchedResults через state
             return;
        }
    }

    // Сообщаем пользователю результат
    if (localMatchedResults.length === 0 && trimmedTextToFind.length > 0) {
        console.log('[CodeReplacerTS EditorActions] No matches found by any method.');
        vscode.window.showInformationMessage(`No matches found for the provided code.`);
    } else if (localMatchedResults.length > 0) {
         const modesFound = Array.from(new Set(localMatchedResults.map(r => r.mode))).join(', ');
         console.log(`[CodeReplacerTS EditorActions] Found ${localMatchedResults.length} total match(es) using modes: ${modesFound}.`);
    }
}
/**
 * Заменяет все найденные и сохраненные совпадения на `replaceText`.
 * Автоматически сохраняет файл после успешной замены.
 *
 * @param {string} replaceText Текст для вставки.
 */
export async function replaceFoundMatches(replaceText: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const resultsToReplace = getMatchedResults(); // Получаем результаты из состояния

    console.log('[CodeReplacerTS EditorActions] Applying replace...');

    if (!editor) {
        vscode.window.showErrorMessage('No active editor found to apply replacements.');
        return;
    }

    if (resultsToReplace.length === 0) {
        vscode.window.showInformationMessage('No matches found or stored. Please use "Find" first.');
        return;
    }

    // Сортируем результаты в ОБРАТНОМ порядке (от конца файла к началу)
    // Это критически важно, чтобы замены не смещали диапазоны последующих замен.
    const sortedResults = [...resultsToReplace].sort((a, b) =>
        b.range.start.compareTo(a.range.start) // Сортировка по начальной позиции, от большей к меньшей
    );

    const originalRangesCount = sortedResults.length;
    const modesUsed = new Set(sortedResults.map(r => r.mode)); // Собираем информацию о режимах поиска

    try {
        // Выполняем все замены в одной операции редактирования (для одного undo)
        const success = await editor.edit(editBuilder => {
            sortedResults.forEach(result => {
                console.log(`[CodeReplacerTS EditorActions] Replacing range: ${result.range.start.line+1}:${result.range.start.character}-${result.range.end.line+1}:${result.range.end.character} (Mode: ${result.mode})`);
                editBuilder.replace(result.range, replaceText);
            });
        }, { undoStopBefore: true, undoStopAfter: true }); // Группируем в один шаг отмены

        if (success) {
            console.log(`[CodeReplacerTS EditorActions] ${originalRangesCount} match(es) replaced successfully (Modes: ${Array.from(modesUsed).join(', ')}).`);

            // --- Новая функциональность: Сохранение файла ---
            try {
                const saveSuccess = await editor.document.save();
                if (saveSuccess) {
                    console.log('[CodeReplacerTS EditorActions] Document saved successfully after replacement.');
                    vscode.window.showInformationMessage(`Replacement successful (${originalRangesCount} matches). File saved.`);
                } else {
                    console.warn('[CodeReplacerTS EditorActions] Document save failed after replacement.');
                    vscode.window.showWarningMessage(`Replacement successful (${originalRangesCount} matches), but failed to save the file automatically.`);
                }
            } catch (saveError: any) {
                 console.error('[CodeReplacerTS EditorActions] Error during document save:', saveError);
                 vscode.window.showErrorMessage(`Replacement successful (${originalRangesCount} matches), but an error occurred while saving: ${saveError.message || 'Unknown error'}`);
            }
            // --- Конец блока сохранения файла ---

            // Очищаем подсветку и результаты после успешной замены
            clearHighlights(editor); // Передаем editor, чтобы очистить только в нем

        } else {
            // Это маловероятно при использовании editor.edit без сбоев, но обработаем
            console.error('[CodeReplacerTS EditorActions] editor.edit() returned false. Replacement might have failed partially or concurrently modified.');
            vscode.window.showErrorMessage('Replacement failed. The editor might have been modified concurrently.');
            // Не очищаем подсветку в этом случае, чтобы пользователь видел, что произошло
        }
    } catch (error: any) {
        console.error("[CodeReplacerTS EditorActions] Error during replace operation:", error);
        vscode.window.showErrorMessage(`Replacement Error: ${error.message || 'Unknown error'}`);
         // Не очищаем подсветку при ошибке
    }
}

/**
 * Очищает подсветку найденных совпадений в редакторе(ах)
 * и удаляет сохраненные результаты из состояния.
 *
 * @param {vscode.TextEditor | undefined} [editor=vscode.window.activeTextEditor] Редактор для очистки. Если undefined, пытается очистить во всех видимых редакторах.
 */
export function clearHighlights(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void {
    const decorationType = getDecorationType(); // Получаем актуальный декоратор из состояния

    if (editor) {
        // Очищаем только в указанном (обычно активном) редакторе
        editor.setDecorations(decorationType, []);
         console.log(`[CodeReplacerTS EditorActions] Cleared decorations in editor: ${editor.document.fileName}`);
    } else {
        // Если активного редактора нет, очищаем во всех видимых
        // Это полезно, если пользователь переключился на другую панель VS Code
        vscode.window.visibleTextEditors.forEach(visibleEditor => {
            visibleEditor.setDecorations(decorationType, []);
            console.log(`[CodeReplacerTS EditorActions] Cleared decorations in visible editor: ${visibleEditor.document.fileName}`);
        });
    }

    // Очищаем сохраненные результаты в состоянии
    clearMatchedResults(); // Эта функция сама логирует очистку состояния
}
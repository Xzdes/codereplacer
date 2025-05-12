// src/editorActions.ts
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { getDecorationType, getMatchedResults, setMatchedResults, clearMatchedResults } from './state';
// Убедитесь, что нужная функция импортирована:
import { parseCodeToAST, areNodesBasicallyEqual } from './astUtils';
import { normalizeAndCleanText } from './textUtils';

/**
 * Выполняет текстовый поиск в документе, используя нормализацию.
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
    const trimmedTextToFind = textToFind.trim();

    try {
        const normalizedTarget = normalizeAndCleanText(trimmedTextToFind, languageId);
        if (!normalizedTarget) {
            console.log(`${logPrefix} Normalized find text is empty.`);
            return [];
        }
        console.log(`${logPrefix} Searching for normalized text: "${normalizedTarget.substring(0, 70)}..."`);

        const documentText = document.getText();
        const normalizedDocument = normalizeAndCleanText(documentText, languageId);
        if (!normalizedDocument) {
            console.log(`${logPrefix} Normalized document text is empty.`);
            return [];
        }

        let searchStartIndex = 0;
        let matchIndex = -1;
        const processedRanges: vscode.Range[] = [];

        while ((matchIndex = normalizedDocument.indexOf(normalizedTarget, searchStartIndex)) !== -1) {
            console.log(`${logPrefix} Found potential match at normalized index: ${matchIndex}`);

            const linesToFind = trimmedTextToFind.split('\n');
            const firstSignificantLine = linesToFind.find(line => line.trim() !== '');
            const firstLineTrimmed = firstSignificantLine ? firstSignificantLine.trim() : '';

            if (firstLineTrimmed) {
                 const scaleFactor = documentText.length / Math.max(1, normalizedDocument.length);
                 const approxOriginalIndex = Math.round(matchIndex * scaleFactor);
                 const searchRadius = Math.max(200, trimmedTextToFind.length * 3);
                 const searchStartOriginal = Math.max(0, approxOriginalIndex - searchRadius);
                 const searchEndOriginal = Math.min(documentText.length, approxOriginalIndex + searchRadius + trimmedTextToFind.length);
                 const snippet = documentText.substring(searchStartOriginal, searchEndOriginal);
                 const indexInSnippet = snippet.indexOf(firstLineTrimmed);

                 if (indexInSnippet !== -1) {
                     const originalStart = searchStartOriginal + indexInSnippet;
                     let originalEnd = originalStart + trimmedTextToFind.length;
                     const lastSignificantLine = [...linesToFind].reverse().find(line => line.trim() !== '');
                     const lastLineTrimmed = lastSignificantLine ? lastSignificantLine.trim() : '';

                     if (lastLineTrimmed) {
                         const endSearchStart = originalStart + Math.max(0, trimmedTextToFind.length - lastLineTrimmed.length - 50);
                         const endSearchEnd = Math.min(documentText.length, originalStart + trimmedTextToFind.length + searchRadius);
                         const endSnippet = documentText.substring(endSearchStart, endSearchEnd);
                         const lastLineIndexInEndSnippet = endSnippet.lastIndexOf(lastLineTrimmed);

                         if (lastLineIndexInEndSnippet !== -1) {
                             originalEnd = endSearchStart + lastLineIndexInEndSnippet + lastLineTrimmed.length;
                         }
                     }
                     originalEnd = Math.min(documentText.length, originalEnd);
                     if (originalEnd < originalStart) originalEnd = originalStart + trimmedTextToFind.length;
                     originalEnd = Math.min(documentText.length, originalEnd);

                     const startPos = document.positionAt(originalStart);
                     const endPos = document.positionAt(originalEnd);
                     const range = new vscode.Range(startPos, endPos);

                     if (!processedRanges.some(r => r.isEqual(range))) {
                        processedRanges.push(range);
                        const hoverMessage = new vscode.MarkdownString();
                        hoverMessage.isTrusted = true;
                        hoverMessage.appendCodeblock(document.getText(range), languageId);
                        hoverMessage.appendMarkdown('\n---\n**Will be replaced with:**\n');
                        hoverMessage.appendCodeblock(textToReplace || '<<DELETE>>', languageId);
                        const matchType = isFallback ? 'Fallback Text Match' : 'Text Match';
                        hoverMessage.appendMarkdown(`\n*(${matchType} - May be approximate)*`);
                        const decoration: vscode.DecorationOptions = { range, hoverMessage };
                        results.push({ range, decoration, mode: 'text' });
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
            searchStartIndex = matchIndex + 1;
        }
    } catch (error: any) {
        console.error(`${logPrefix} Error during text processing:`, error);
        vscode.window.showErrorMessage(`Text Analysis Error: ${error.message || 'Unknown error'}`);
    }
    return results;
}

/**
 * Находит и подсвечивает совпадения для `textToFind` в активном редакторе.
 * @param {string} textToFind Текст (код) для поиска.
 * @param {string} textToReplace Текст для замены (используется для hover message).
 * @param {boolean} ignoreIdentifiers Флаг, указывающий, следует ли игнорировать имена идентификаторов при AST-сравнении.
 */
export async function highlightTextInEditor(
    textToFind: string,
    textToReplace: string,
    ignoreIdentifiers: boolean // Принимает флаг
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    console.log('[CodeReplacerTS EditorActions] Highlighting text... Editor active:', !!editor);

    clearHighlights(editor);

    if (!editor) {
        console.log('[CodeReplacerTS EditorActions] No active editor.');
        return;
    }

    const document = editor.document;
    const languageId = document.languageId;
    const documentText = document.getText();
    const trimmedTextToFind = textToFind.trim();

    if (!trimmedTextToFind) {
        console.log('[CodeReplacerTS EditorActions] Find text is empty after trimming.');
        return;
    }

    const localMatchedResults: { range: vscode.Range, mode: 'ast' | 'text' }[] = [];
    const decorationsArray: vscode.DecorationOptions[] = [];

    const isAstSupported = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(languageId);
    const isTextSupported = ['css', 'html', 'json', 'jsonc', 'xml', 'less', 'scss', 'python', 'ruby', 'shellscript', 'java', 'csharp', 'php', 'go', 'rust'].includes(languageId);

    try {
        if (isAstSupported) {
            console.log(`[CodeReplacerTS EditorActions] Using AST mode for language: ${languageId}`);
            let astFoundMatches = false;

            try {
                 const parseResult = parseCodeToAST(trimmedTextToFind);
                 if (parseResult && parseResult.nodes.length > 0) {
                     const findNodes = parseResult.nodes;
                     const findSourceFile = parseResult.sourceFile;
                     console.log(`[CodeReplacerTS EditorActions AST] Attempting to match sequence of ${findNodes.length} node(s). First kind: ${ts.SyntaxKind[findNodes[0].kind]}`);
                     const documentSourceFile = ts.createSourceFile(document.fileName, documentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.Unknown);

                     const findASTSequences = (siblings: readonly ts.Node[]) => {
                         if (!siblings || siblings.length < findNodes.length) {
                             return;
                         }
                         for (let i = 0; i <= siblings.length - findNodes.length; i++) {
                             let sequenceMatch = true;
                             for (let j = 0; j < findNodes.length; j++) {
                                 // Первоначальный вызов использует ignoreIdentifiers из UI
                                 if (!areNodesBasicallyEqual(siblings[i + j], findNodes[j], documentSourceFile, findSourceFile, 0, ignoreIdentifiers)) {
                                     sequenceMatch = false;
                                     break;
                                 }
                             }
                             if (sequenceMatch) {
                                 const firstNode = siblings[i];
                                 const lastNode = siblings[i + findNodes.length - 1];
                                 console.log(`[CodeReplacerTS EditorActions AST Sequence Match FOUND] Node kinds: ${findNodes.map(n => ts.SyntaxKind[n.kind]).join(', ')}. Starts at doc pos ${firstNode.getStart(documentSourceFile)}`);
                                 try {
                                     const start = firstNode.getStart(documentSourceFile);
                                     const end = lastNode.getEnd();
                                     const startPos = document.positionAt(start);
                                     const endPos = document.positionAt(end);
                                     const range = new vscode.Range(startPos, endPos);
                                     const hoverMessage = new vscode.MarkdownString();
                                     hoverMessage.isTrusted = true;
                                     hoverMessage.appendCodeblock(document.getText(range), languageId);
                                     hoverMessage.appendMarkdown('\n---\n**Will be replaced with:**\n');
                                     hoverMessage.appendCodeblock(textToReplace || '<<DELETE>>', languageId);
                                     hoverMessage.appendMarkdown(`\n*(AST Match, ${findNodes.length} node${findNodes.length > 1 ? 's': ''})*`);
                                     decorationsArray.push({ range, hoverMessage });
                                     localMatchedResults.push({ range, mode: 'ast' });
                                     astFoundMatches = true;
                                     i += findNodes.length - 1;
                                 } catch (rangeError: any) {
                                     console.error(`[CodeReplacerTS EditorActions AST] Error calculating range or creating hover message:`, rangeError.message);
                                 }
                             }
                         }
                     };

                     const visit = (node: ts.Node) => {
                         const children = node.getChildren(documentSourceFile);
                         findASTSequences(children);
                         children.forEach(visit);
                     };

                     console.log(`[CodeReplacerTS EditorActions AST] Starting AST search in: ${document.fileName}`);
                     visit(documentSourceFile);
                     console.log(`[CodeReplacerTS EditorActions AST] AST search finished. Found matches: ${astFoundMatches}`);
                 } else {
                     console.log('[CodeReplacerTS EditorActions AST] Could not parse find text or no nodes found for AST search.');
                 }
             } catch (astError: any) {
                 console.error("[CodeReplacerTS EditorActions AST] Error during AST processing:", astError);
                 vscode.window.showErrorMessage(`AST Analysis Error: ${astError.message || 'Unknown error'}`);
                 return;
             }

            if (!astFoundMatches) {
                console.log('[CodeReplacerTS EditorActions] AST search yielded no results. Falling back to Text search for', languageId);
                const textSearchResults = await _performTextSearch(document, textToFind, languageId, textToReplace, true);
                textSearchResults.forEach(result => {
                    if (!localMatchedResults.some(existing => existing.range.isEqual(result.range))) {
                       decorationsArray.push(result.decoration);
                       localMatchedResults.push({ range: result.range, mode: result.mode });
                    }
                });
                 if (textSearchResults.length > 0) {
                     console.log(`[CodeReplacerTS EditorActions] Found ${textSearchResults.length} matches via Text fallback.`);
                 } else {
                      console.log('[CodeReplacerTS EditorActions] Text fallback search also yielded no results.');
                 }
            }
        } else if (isTextSupported) {
            console.log(`[CodeReplacerTS EditorActions] Using Text mode for language: ${languageId}`);
            const textSearchResults = await _performTextSearch(document, textToFind, languageId, textToReplace, false);
            textSearchResults.forEach(result => {
                 decorationsArray.push(result.decoration);
                 localMatchedResults.push({ range: result.range, mode: result.mode });
            });
        } else {
            console.log(`[CodeReplacerTS EditorActions] Language not supported for search: ${languageId}`);
            vscode.window.showInformationMessage(`Language '${languageId}' is not currently supported for search/replace.`);
            return;
        }
    } catch (error: any) {
        console.error("[CodeReplacerTS EditorActions] Unexpected error during search execution:", error);
        vscode.window.showErrorMessage(`An unexpected error occurred during the search: ${error.message || 'Unknown error'}`);
        return;
    }

    setMatchedResults(localMatchedResults);

    if (editor && decorationsArray.length > 0) {
        try {
             const decorationType = getDecorationType();
             editor.setDecorations(decorationType, decorationsArray);
             console.log(`[CodeReplacerTS EditorActions] Applied ${decorationsArray.length} decorations.`);
        } catch (decorationError: any) {
             console.error("[CodeReplacerTS EditorActions] Error applying decorations:", decorationError);
             vscode.window.showErrorMessage(`Error applying highlights: ${decorationError.message || 'Check debug console'}`);
             clearHighlights(editor);
             return;
        }
    }

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
 * @param {string} replaceText Текст для вставки.
 */
export async function replaceFoundMatches(replaceText: string): Promise<void> { // Принимает ОДИН аргумент
    const editor = vscode.window.activeTextEditor;
    const resultsToReplace = getMatchedResults();

    console.log('[CodeReplacerTS EditorActions] Applying replace...');

    if (!editor) {
        vscode.window.showErrorMessage('No active editor found to apply replacements.');
        return;
    }
    if (resultsToReplace.length === 0) {
        vscode.window.showInformationMessage('No matches found or stored. Please use "Find" first.');
        return;
    }

    const sortedResults = [...resultsToReplace].sort((a, b) =>
        b.range.start.compareTo(a.range.start)
    );

    const originalRangesCount = sortedResults.length;
    const modesUsed = new Set(sortedResults.map(r => r.mode));

    try {
        const success = await editor.edit(editBuilder => {
            sortedResults.forEach(result => {
                console.log(`[CodeReplacerTS EditorActions] Replacing range: ${result.range.start.line+1}:${result.range.start.character}-${result.range.end.line+1}:${result.range.end.character} (Mode: ${result.mode})`);
                editBuilder.replace(result.range, replaceText);
            });
        }, { undoStopBefore: true, undoStopAfter: true });

        if (success) {
            console.log(`[CodeReplacerTS EditorActions] ${originalRangesCount} match(es) replaced successfully (Modes: ${Array.from(modesUsed).join(', ')}).`);
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
            clearHighlights(editor);
        } else {
            console.error('[CodeReplacerTS EditorActions] editor.edit() returned false. Replacement might have failed partially or concurrently modified.');
            vscode.window.showErrorMessage('Replacement failed. The editor might have been modified concurrently.');
        }
    } catch (error: any) {
        console.error("[CodeReplacerTS EditorActions] Error during replace operation:", error);
        vscode.window.showErrorMessage(`Replacement Error: ${error.message || 'Unknown error'}`);
    }
}

/**
 * Очищает подсветку найденных совпадений в редакторе(ах).
 * @param {vscode.TextEditor | undefined} [editor=vscode.window.activeTextEditor] Редактор для очистки.
 */
export function clearHighlights(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void {
    let decorationType;
    try {
        decorationType = getDecorationType();
    } catch (e) {
        console.log('[CodeReplacerTS EditorActions] Attempted to clear highlights before decoration type was initialized. Skipping.');
        clearMatchedResults();
        return;
    }

    if (editor && decorationType) {
        editor.setDecorations(decorationType, []);
        console.log(`[CodeReplacerTS EditorActions] Cleared decorations in editor: ${editor.document.fileName}`);
    } else if (!editor && decorationType) {
        vscode.window.visibleTextEditors.forEach(visibleEditor => {
            visibleEditor.setDecorations(decorationType, []);
            console.log(`[CodeReplacerTS EditorActions] Cleared decorations in visible editor: ${visibleEditor.document.fileName}`);
        });
    }
    clearMatchedResults(); // Всегда очищаем сохраненные результаты
}
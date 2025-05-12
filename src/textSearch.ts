// src/textSearch.ts
import * as vscode from 'vscode';
import stringSimilarity from 'string-similarity';
import { normalizeAndCleanText } from './textUtils';

/**
 * Выполняет текстовый поиск в документе, используя нормализацию.
 * (описание и параметры как в исходной функции)
 */
export async function performTextSearch(
    document: vscode.TextDocument,
    textToFind: string,
    languageId: string,
    textToReplace: string,
    isFallback: boolean
): Promise<{ range: vscode.Range, decoration: vscode.DecorationOptions, mode: 'text' }[]> {
    const results: { range: vscode.Range, decoration: vscode.DecorationOptions, mode: 'text' }[] = [];
    const logPrefix = `[CodeReplacerTS EditorActions Text${isFallback ? ' Fallback' : ''}]`;
    const trimmedTextToFind = textToFind.trim();
    const fuzzySearchThreshold = vscode.workspace.getConfiguration('codereplacer-ts').get<number>('fuzzySearchThreshold', 0.8);

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

        while (true) {
            matchIndex = normalizedDocument.indexOf(normalizedTarget, searchStartIndex);
            if (matchIndex === -1 && !isFallback) { // Нечеткий поиск только как fallback
                const bestMatch = stringSimilarity.findBestMatch(normalizedTarget, normalizedDocument.substring(searchStartIndex).split(' '));
                if (bestMatch.bestMatch.rating >= fuzzySearchThreshold) {
                    matchIndex = searchStartIndex + normalizedDocument.substring(searchStartIndex).indexOf(bestMatch.bestMatch.target);
                    console.log(`${logPrefix} Fuzzy match found with rating ${bestMatch.bestMatch.rating} at normalized index: ${matchIndex}`);
                }
            }

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

            if (matchIndex !== -1) {
                searchStartIndex = matchIndex + 1;
            } else {
                break;
            }
        }
    } catch (error: any) {
        console.error(`${logPrefix} Error during text processing:`, error);
        vscode.window.showErrorMessage(`Text Analysis Error: ${error.message || 'Unknown error'}`);
    }
    return results;
}

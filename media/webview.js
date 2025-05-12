// media/webview.js

(function () {
    const vscode = acquireVsCodeApi();

    // Get elements
    const findTextarea = document.getElementById('findText');
    const replaceTextarea = document.getElementById('replaceText');
    const applyButton = document.getElementById('applyButton');

    let debounceTimer;
    const DEBOUNCE_DELAY = 350; // ms delay after typing stops to trigger find

    // --- Find Text Input Handling (Debounced) ---
    if (findTextarea) {
        findTextarea.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const textToFind = findTextarea.value;
                 // Send find command even if text is empty,
                 // extension side will handle clearing highlights.
                vscode.postMessage({
                    command: 'findText',
                    text: textToFind
                });
            }, DEBOUNCE_DELAY);
        });
    } else {
        console.error('Element #findText not found.');
    }

    // --- Apply Replace Button Handling ---
    if (applyButton) {
        applyButton.addEventListener('click', () => {
            const findText = findTextarea ? findTextarea.value : '';
            const replaceText = replaceTextarea ? replaceTextarea.value : ''; // Replace text can be empty

            // Basic validation: Find text should ideally not be empty for replacement to make sense,
            // but the extension handles the 'no matches found' case if highlight wasn't run or found nothing.
            if (!findText.trim()) {
                vscode.postMessage({
                    command: 'alert',
                    text: 'Пожалуйста, введите код для поиска (хотя бы структура должна быть найдена).'
                });
                if (findTextarea) {
                    findTextarea.focus();
                    // Optional: Add temporary error style
                    // findTextarea.classList.add('error-input');
                    // setTimeout(() => findTextarea.classList.remove('error-input'), 2000);
                }
                return;
            }

            // Send command to extension
            vscode.postMessage({
                command: 'applyReplace',
                // Send both, though extension primarily uses replaceText and stored ranges
                findText: findText,
                replaceText: replaceText
            });
        });
    } else {
        console.error('Element #applyButton not found.');
    }

    // --- Optional: Handle messages from extension TO webview ---
    /*
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Webview received message:', message);
        // Handle message based on message.command
    });
    */

    console.log('webview.js loaded.');

}());
// media/webview.js

// Используем IIFE (Immediately Invoked Function Expression) для изоляции области видимости
(function () {
    // Получаем доступ к API VS Code для обмена сообщениями с расширением
    const vscode = acquireVsCodeApi();

    // --- Получение ссылок на элементы DOM ---
    const findTextarea = document.getElementById('findText');
    const replaceTextarea = document.getElementById('replaceText');
    const applyButton = document.getElementById('applyButton');
    const ignoreIdentifiersCheckbox = document.getElementById('ignoreIdentifiersCheckbox'); // Для опции "Ignore Identifiers"

    // --- Состояние и константы для Debounce ---
    let findDebounceTimer;
    let replaceDebounceTimer;
    const DEBOUNCE_DELAY = 350; // Задержка в миллисекундах после остановки ввода

    // --- Вспомогательная функция для получения текущего состояния чекбокса ---
    function getIgnoreIdentifiersState() {
        // Убедимся, что элемент найден, прежде чем обращаться к .checked
        return ignoreIdentifiersCheckbox ? ignoreIdentifiersCheckbox.checked : false;
    }

    // --- Обработка ввода в поле "Code to Find" (с Debounce) ---
    if (findTextarea) {
        findTextarea.addEventListener('input', () => {
            // Очищаем предыдущий таймер, если пользователь продолжает печатать
            clearTimeout(findDebounceTimer);
            // Устанавливаем новый таймер
            findDebounceTimer = setTimeout(() => {
                const textToFind = findTextarea.value;
                console.log('Webview: Sending findText with ignoreIdentifiers:', getIgnoreIdentifiersState());
                vscode.postMessage({
                    command: 'findText',
                    text: textToFind,
                    ignoreIdentifiers: getIgnoreIdentifiersState()
                });
            }, DEBOUNCE_DELAY);
        });
    } else {
        console.error('Webview Error: Element with ID "findText" not found.');
    }

    // --- Обработка ввода в поле "Replacement Code" (с Debounce) ---
    if (replaceTextarea) {
        replaceTextarea.addEventListener('input', () => {
            clearTimeout(replaceDebounceTimer);
            replaceDebounceTimer = setTimeout(() => {
                const textToReplace = replaceTextarea.value;
                console.log('Webview: Sending updateReplaceText with ignoreIdentifiers:', getIgnoreIdentifiersState());
                vscode.postMessage({
                    command: 'updateReplaceText',
                    text: textToReplace,
                    ignoreIdentifiers: getIgnoreIdentifiersState() // Передаем состояние чекбокса
                });
            }, DEBOUNCE_DELAY);
        });
    } else {
        console.error('Webview Error: Element with ID "replaceText" not found.');
    }

    // --- Обработка изменения состояния чекбокса "Ignore Identifiers" ---
    if (ignoreIdentifiersCheckbox) {
        ignoreIdentifiersCheckbox.addEventListener('change', () => {
            const textToFind = findTextarea ? findTextarea.value : '';
            // Если в поле поиска уже что-то есть, запускаем findText с новым состоянием чекбокса
            // или даже если пусто, чтобы сбросить предыдущие результаты, если они были
            // if (textToFind.trim()) { // Можно убрать эту проверку, чтобы всегда отправлять
            console.log('Webview: ignoreIdentifiersCheckbox changed, sending findText with new state:', getIgnoreIdentifiersState());
            // Очищаем таймер debounce для findTextarea, чтобы не было двойного вызова
            clearTimeout(findDebounceTimer);
            vscode.postMessage({
                command: 'findText', // Используем findText, так как это инициирует полный новый поиск
                text: textToFind,    // Отправляем текущий текст из поля поиска
                ignoreIdentifiers: getIgnoreIdentifiersState() // Отправляем актуальное состояние чекбокса
            });
            // }
        });
    } else {
        console.error('Webview Error: Element with ID "ignoreIdentifiersCheckbox" not found.');
    }

    // --- Обработка нажатия кнопки "Replace Found Matches" ---
    if (applyButton) {
        applyButton.addEventListener('click', () => {
            const findText = findTextarea ? findTextarea.value : '';
            const replaceText = replaceTextarea ? replaceTextarea.value : '';
            // Состояние ignoreIdentifiers для applyReplace не критично для самого действия замены,
            // так как замена идет по уже найденным диапазонам. Но если бы мы перед заменой
            // делали бы дополнительный поиск/проверку, оно могло бы понадобиться.
            // const currentIgnoreIdentifiers = getIgnoreIdentifiersState();

            if (!findText.trim()) {
                console.warn('Webview: Apply button clicked with empty find text.');
                vscode.postMessage({
                    command: 'alert',
                    text: 'Please enter the code you want to find first.'
                });
                if (findTextarea) {
                    findTextarea.focus();
                }
                return;
            }

            console.log('Webview: Sending applyReplace command.');
            vscode.postMessage({
                command: 'applyReplace',
                findText: findText,       // Передаем текущий текст поиска
                replaceText: replaceText, // Передаем текущий текст замены
                // ignoreIdentifiers: currentIgnoreIdentifiers // Можно передавать, если нужно для логики на стороне расширения
            });
        });
    } else {
        console.error('Webview Error: Element with ID "applyButton" not found.');
    }

    // --- Обработка сообщений ОТ расширения К Webview (Опционально) ---
    /*
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Webview received message from extension:', message);

        switch (message.command) {
            case 'clearInputs':
                console.log('Webview: Clearing input fields as requested by extension.');
                if (findTextarea) {
                    findTextarea.value = '';
                    // Важно! Искусственно вызываем 'input', чтобы сработал debounce и отправилось сообщение
                    // об очистке поля, что приведет к очистке подсветки в расширении.
                    findTextarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                }
                if (replaceTextarea) {
                    replaceTextarea.value = '';
                    replaceTextarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                }
                if (ignoreIdentifiersCheckbox) {
                    ignoreIdentifiersCheckbox.checked = false;
                    // Также вызываем 'change', чтобы состояние чекбокса было обработано
                     ignoreIdentifiersCheckbox.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                }
                break;
            // ... другие команды
        }
    });
    */

    console.log('webview.js loaded and listeners attached.');

}()); // Запускаем IIFE
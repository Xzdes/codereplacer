// media/webview.js

// Используем IIFE (Immediately Invoked Function Expression) для изоляции области видимости
(function () {
    // Получаем доступ к API VS Code для обмена сообщениями с расширением
    const vscode = acquireVsCodeApi();

    // --- Получение ссылок на элементы DOM ---
    const findTextarea = document.getElementById('findText');
    const replaceTextarea = document.getElementById('replaceText');
    const applyButton = document.getElementById('applyButton');

    // --- Состояние и константы для Debounce ---
    let findDebounceTimer;
    let replaceDebounceTimer;
    const DEBOUNCE_DELAY = 350; // Задержка в миллисекундах после остановки ввода

    // --- Обработка ввода в поле "Code to Find" (с Debounce) ---
    if (findTextarea) {
        findTextarea.addEventListener('input', () => {
            // Очищаем предыдущий таймер, если пользователь продолжает печатать
            clearTimeout(findDebounceTimer);
            // Устанавливаем новый таймер
            findDebounceTimer = setTimeout(() => {
                const textToFind = findTextarea.value;
                console.log('Webview: Sending findText', textToFind);
                // Отправляем команду 'findText' в расширение
                // Расширение само решает, что делать, если текст пустой (очистить подсветку)
                vscode.postMessage({
                    command: 'findText',
                    text: textToFind
                });
            }, DEBOUNCE_DELAY);
        });
    } else {
        console.error('Webview Error: Element with ID "findText" not found.');
    }

    // --- Обработка ввода в поле "Replacement Code" (с Debounce) ---
    // НОВОЕ: Добавлено для обновления предпросмотра в hover'ах подсветки
    if (replaceTextarea) {
        replaceTextarea.addEventListener('input', () => {
            // Очищаем предыдущий таймер
            clearTimeout(replaceDebounceTimer);
            // Устанавливаем новый таймер
            replaceDebounceTimer = setTimeout(() => {
                const textToReplace = replaceTextarea.value;
                console.log('Webview: Sending updateReplaceText', textToReplace);
                // Отправляем команду 'updateReplaceText' в расширение
                // Это позволит обновить hover-сообщения для уже найденных совпадений
                vscode.postMessage({
                    command: 'updateReplaceText',
                    text: textToReplace // Отправляем текущий текст для замены
                });
            }, DEBOUNCE_DELAY);
        });
    } else {
        console.error('Webview Error: Element with ID "replaceText" not found.');
    }


    // --- Обработка нажатия кнопки "Replace Found Matches" ---
    if (applyButton) {
        applyButton.addEventListener('click', () => {
            // Получаем ТЕКУЩИЕ значения из полей ввода на момент клика
            const findText = findTextarea ? findTextarea.value : '';
            const replaceText = replaceTextarea ? replaceTextarea.value : '';

            // --- Базовая валидация на стороне Webview ---
            // Проверяем, что поле "Code to Find" не пустое (после trim).
            // Хотя основная логика поиска и замены находится в расширении,
            // простая проверка здесь может улучшить пользовательский опыт.
            if (!findText.trim()) {
                console.warn('Webview: Apply button clicked with empty find text.');
                // Можно показать сообщение прямо в webview или отправить команду alert
                vscode.postMessage({
                    command: 'alert',
                    text: 'Please enter the code you want to find first.'
                });

                // Устанавливаем фокус на поле ввода
                if (findTextarea) {
                    findTextarea.focus();
                    // Можно добавить/убрать класс для визуальной индикации ошибки
                    // findTextarea.classList.add('error-input');
                    // setTimeout(() => findTextarea.classList.remove('error-input'), 2000);
                }
                return; // Прерываем выполнение, если текст для поиска пуст
            }

            // Отправляем команду 'applyReplace' в расширение
            console.log('Webview: Sending applyReplace command.');
            vscode.postMessage({
                command: 'applyReplace',
                findText: findText,       // Отправляем оба текста
                replaceText: replaceText  // для полноты контекста
            });
        });
    } else {
        console.error('Webview Error: Element with ID "applyButton" not found.');
    }

    // --- Обработка сообщений ОТ расширения К Webview (Опционально) ---
    /*
    window.addEventListener('message', event => {
        const message = event.data; // Данные, отправленные из расширения через webview.postMessage()
        console.log('Webview received message from extension:', message);

        switch (message.command) {
            case 'clearInputs':
                console.log('Webview: Clearing input fields as requested by extension.');
                if (findTextarea) {
                    findTextarea.value = '';
                    // Нужно вручную сгенерировать событие 'input', чтобы триггернуть отправку
                    // пустого текста в расширение и очистку подсветки, если это необходимо
                    findTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
                if (replaceTextarea) {
                    replaceTextarea.value = '';
                    replaceTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
                break;
            // Можно добавить обработку других команд от расширения
            // case 'setInitialData':
            //     if (findTextarea && message.findText) findTextarea.value = message.findText;
            //     if (replaceTextarea && message.replaceText) replaceTextarea.value = message.replaceText;
            //     break;
        }
    });
    */

    // --- Инициализация и логирование ---
    // Можно сохранить начальные значения, если нужно будет их восстанавливать
    // const initialState = {
    //     findText: findTextarea ? findTextarea.value : '',
    //     replaceText: replaceTextarea ? replaceTextarea.value : ''
    // };
    // vscode.setState(initialState); // Сохраняем состояние для VS Code

    console.log('webview.js loaded and listeners attached.');

}()); // Запускаем IIFE
// media/webview.js

// Эта IIFE (Immediately Invoked Function Expression) используется для создания локальной области видимости
// и предотвращения загрязнения глобального пространства имен.
(function () {
    // Получаем специальный объект API VS Code, который позволяет Webview
    // отправлять сообщения обратно в расширение.
    const vscode = acquireVsCodeApi();

    // Получаем ссылки на элементы DOM
    const findTextarea = document.getElementById('findText');
    const replaceTextarea = document.getElementById('replaceText');
    const applyButton = document.getElementById('applyButton');

    let debounceTimer; // Таймер для задержки отправки сообщений при вводе

    // --- Обработка ввода в поле "Код для поиска" ---
    if (findTextarea) {
        findTextarea.addEventListener('input', () => {
            // "Debounce" - небольшая задержка перед отправкой сообщения.
            // Это предотвращает отправку сообщения на каждое нажатие клавиши,
            // улучшая производительность, если подсветка - ресурсоемкая операция.
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                vscode.postMessage({
                    command: 'findText',
                    text: findTextarea.value
                });
            }, 300); // Задержка в 300 миллисекунд. Можете настроить.
        });
    } else {
        console.error('Элемент #findText не найден в DOM Webview.');
    }

    // --- Обработка нажатия кнопки "Применить" ---
    if (applyButton) {
        applyButton.addEventListener('click', () => {
            const findText = findTextarea ? findTextarea.value : '';
            const replaceText = replaceTextarea ? replaceTextarea.value : '';

            if (!findText) {
                // Отправляем сообщение в расширение, чтобы показать уведомление
                vscode.postMessage({
                    command: 'alert',
                    text: 'Пожалуйста, введите код для поиска в первое поле.'
                });
                // Можно также добавить визуальную обратную связь прямо в Webview,
                // например, подсветить поле findTextarea красным.
                if (findTextarea) {
                    findTextarea.focus();
                    // Пример простой подсветки границы (требует CSS)
                    // findTextarea.classList.add('error-input');
                    // setTimeout(() => findTextarea.classList.remove('error-input'), 2000);
                }
                return;
            }

            // Отправляем команду и данные в расширение
            vscode.postMessage({
                command: 'applyReplace',
                findText: findText,
                replaceText: replaceText
            });
        });
    } else {
        console.error('Элемент #applyButton не найден в DOM Webview.');
    }

    // --- Опционально: начальное состояние или логика при загрузке Webview ---
    // Например, если вы хотите автоматически очищать подсветку при открытии панели:
    // window.addEventListener('load', () => {
    //     vscode.postMessage({ command: 'findText', text: '' });
    // });

    // --- Опционально: прослушивание сообщений от расширения к Webview ---
    // Это полезно, если расширение должно отправлять данные или команды в Webview.
    /*
    window.addEventListener('message', event => {
        const message = event.data; // Данные, отправленные из расширения
        console.log('Webview received message from extension:', message);

        switch (message.command) {
            case 'updateSomethingInWebview':
                // const dataElement = document.getElementById('someDataElement');
                // if (dataElement && message.data) {
                //     dataElement.textContent = message.data;
                // }
                break;
            // Добавьте другие case по необходимости
        }
    });
    */

    // Сообщаем в консоль, что скрипт Webview загружен (для отладки)
    console.log('webview.js loaded and running.');

}());
// Функция для отправки сообщения о сохранении ключа API
function setApiKey() {
    const apiKey = document.getElementById('apiKey').value;
    vscode.postMessage({ command: 'setApiKey', apiKey: apiKey });
}

function addReplacement() {
    const find = document.getElementById('findInput').value;
    const replace = document.getElementById('replaceInput').value;
    vscode.postMessage({ command: 'addReplacement', find: find, replace: replace });
}

function generateReplacement() {
    const text = document.getElementById('generateInput').value;
    vscode.postMessage({ command: 'generateReplacement', text: text });
}

function removeReplacement(index) {
    vscode.postMessage({ command: 'removeReplacement', index: index });
}

function applyReplacements() {
    vscode.postMessage({ command: 'applyReplacements' });
}

function clearReplacements() {
    vscode.postMessage({ command: 'clearReplacements' });
}


const vscode = acquireVsCodeApi();

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'setReplacements':
            displayReplacements(message.replacements);
            break;
        case 'generatedReplacement':
            document.getElementById('replaceInput').value = message.text;
            break;
        case 'showError':
            vscode.window.showErrorMessage(message.text);
            break;
        case 'showInfo':
            vscode.window.showInformationMessage(message.text);
            break;
    }
});

function displayReplacements(replacements) {
    const list = document.getElementById('replacementList');
    list.innerHTML = '';
    replacements.forEach((pair, index) => {
        const listItem = document.createElement('li');
        listItem.textContent = `Find: "${pair.find}", Replace: "${pair.replace}"`;
        listItem.innerHTML += `<button onclick="removeReplacement(${index})">Remove</button>`;
        list.appendChild(listItem);
    });
}
# Code Replacer TS/JS

A Visual Studio Code extension for finding and replacing code snippets in TypeScript and TSX files based on their Abstract Syntax Tree (AST) structure, rather than simple text matching. This allows for more robust refactoring by ignoring differences in whitespace, comments, and trivial formatting.

## Features

*   **AST-Based Search:** Finds code segments by comparing their underlying AST structure, making it resilient to formatting changes.
*   **Sequence Matching:** Matches consecutive sequences of top-level statements/expressions provided in the "Find" input box.
*   **Sidebar View:** Provides a dedicated view in the VS Code Activity Bar/Side Bar for inputting the code to find and the replacement code.
*   **Live Highlighting:** Automatically highlights matching code sequences in the active editor as you type in the "Find" text area (with debouncing).
*   **Batch Replacement:** Replaces all found occurrences with a single button click.

## Requirements

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) (Usually included with Node.js)
*   [Visual Studio Code](https://code.visualstudio.com/)

## Setup From Source

Follow these steps to set up the extension from its source code:

1.  **Clone the repository:**
    ```bash
    git clone Xzdes/codereplacer
    ```

2.  **Install Dependencies:**
    Open a terminal in the project's root directory and run:
    ```bash
    npm install
    ```
    This command downloads and installs all the necessary dependencies listed in `package.json`, including the TypeScript compiler and VS Code extension APIs.

    *Note: Ensure your installed version of TypeScript (check `devDependencies` in `package.json`) is compatible with the VS Code API and features used (e.g., >= v4.0.0 is recommended). If you change the version in `package.json`, run `npm install` again.*

## Running for Development

To run the extension in a development environment:

1.  Open the project folder (`code-replacer-ts`) in Visual Studio Code.
2.  Press `F5`, or navigate to the "Run and Debug" view (usually on the left sidebar) and click the green play button for the "Run Extension" launch configuration.
3.  This will compile the TypeScript code (if needed) and launch a new VS Code window titled "[Extension Development Host]". This new window will have your `Code Replacer TS` extension loaded and running.
4.  You can now open TypeScript/TSX files in the "[Extension Development Host]" window and test the extension's functionality. Changes made to the extension's source code often require restarting the development host (stop debugging with `Shift+F5`, then press `F5` again) to take effect, although some changes might be picked up automatically depending on the setup.

## Compiling the Extension

To compile the TypeScript source code into JavaScript (typically for packaging or testing the final output without launching the debugger):

1.  Open a terminal in the project's root directory.
2.  Run the compile script defined in your `package.json`. Based on your previous commands, this is likely:
    ```bash
    npm run compile
    ```
3.  This command usually executes `tsc -p ./`, which invokes the TypeScript compiler (`tsc`) using the project's `tsconfig.json` configuration file.
4.  The compiled JavaScript files are typically placed in an output directory specified in `tsconfig.json` (commonly named `out` or `dist`).

## Usage

1.  Open the "Code Replacer TS" view. Look for its icon in the VS Code Activity Bar (the far left or right bar) or check the Side Bar panels.
2.  Ensure a TypeScript (`.ts`) or TSX (`.tsx`) file is the active editor.
3.  In the "Code to Find (AST Sequence Match)" text area within the extension's view, paste the code snippet (one or more statements/expressions) you want to find.
4.  As you type, the extension will parse the code and highlight any matching sequences found in the active editor based on their AST structure.
5.  In the "Replacement Code" text area, paste the code that should replace the found matches.
6.  Click the "Replace Found Matches" button to perform the replacement across all highlighted occurrences.

## License

**MIT License**
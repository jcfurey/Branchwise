/**
 * The webview API, through which the page posts its requests and keeps its own state.
 *
 * VS Code lets a page acquire the API only once, so this module does it while loading (other
 * modules read the saved state as they load) and every other module imports the result.
 */
export const vscode = acquireVsCodeApi();

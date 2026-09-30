// Globals of the webview page. This file must stay a script, so that its declarations are global
// without being imported: the types it needs are named by inline `import()` rather than imported.

/** Stylesheets are bundled by esbuild; `main.tsx` imports its own for the side effect. */
declare module "*.css";

/**
 * The API that VS Code provides to the page. It may be acquired only once per page, which
 * `lib/vscode.ts` does for everyone.
 */
declare function acquireVsCodeApi(): {
  /** Whatever the page last saved, or `undefined`; unchecked, so readers must check it. */
  getState(): unknown;
  setState(state: unknown): void;
  postMessage(message: import("@/types").RequestMessage | import("@/types").RpcRequest): void;
};

interface Window {
  /** The page's strings, set from the answer to `webview.initialize`. */
  l10n: import("@/old-extension/l10n/webviewL10n").LocalizedStrings;
}

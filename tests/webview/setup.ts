// Setup file of the `webview` project: it runs before every test file's own imports, in both the
// node and jsdom environments, so it touches nothing but `globalThis`. Tests import it to reach the
// stand-in for the VS Code API that the page acquires in `src/webview/lib/vscode.ts`.
import { type Mock, vi } from "vitest";

/**
 * What `acquireVsCodeApi` hands the page. The recorded calls are never cleared here: a file that
 * wants a clean record clears it itself. `setState` and `postMessage` stay untyped so that tests
 * may give them implementations for whichever messages they expect.
 */
export const vscodeApi: {
  getState: Mock<() => unknown>;
  setState: Mock;
  postMessage: Mock;
} = {
  getState: vi.fn<() => unknown>(),
  setState: vi.fn(),
  postMessage: vi.fn()
};

// Configurable, so that a test may put its own API in place and restore this one afterwards.
Object.defineProperty(globalThis, "acquireVsCodeApi", {
  value: vi.fn(() => vscodeApi),
  configurable: true,
  enumerable: false,
  writable: false
});

import { afterEach, expect, it, vi } from "vitest";

const standard = Object.getOwnPropertyDescriptor(globalThis, "acquireVsCodeApi");

afterEach(() => {
  if (standard !== undefined) {
    Object.defineProperty(globalThis, "acquireVsCodeApi", standard);
  }
});

it("acquires the API once, while loading, and hands out that very object", async () => {
  const api = { getState: () => null, setState: () => {}, postMessage: () => {} };
  const acquire = vi.fn(() => api);
  Object.defineProperty(globalThis, "acquireVsCodeApi", { value: acquire, configurable: true });
  vi.resetModules();

  const { vscode } = await import("@/webview/lib/vscode");
  expect(acquire).toHaveBeenCalledOnce();
  expect(acquire).toHaveBeenCalledWith();
  expect(vscode).toBe(api);

  await import("@/webview/lib/vscode");
  expect(acquire).toHaveBeenCalledOnce();
});

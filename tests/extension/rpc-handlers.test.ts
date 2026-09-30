import { beforeEach, describe, expect, expectTypeOf, test, vi } from "vitest";

import { rpcHandlers } from "@/extension/rpc/handlers";
import type { RpcMethod, RpcMethodMap } from "@/types";

const delegates = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  webviewInitialize: vi.fn(),
  initializeRepo: vi.fn(),
  scanRepos: vi.fn(),
  openExtensionSettings: vi.fn(),
  runCommand: vi.fn()
}));

vi.mock("@/extension/handlers/clipboard", () => ({ copyToClipboard: delegates.copyToClipboard }));
vi.mock("@/extension/handlers/initialize", () => ({
  webviewInitialize: delegates.webviewInitialize
}));
vi.mock("@/extension/handlers/initialize-repo", () => ({
  initializeRepo: delegates.initializeRepo
}));
vi.mock("@/extension/handlers/scan-repo", () => ({ scanRepos: delegates.scanRepos }));
vi.mock("@/extension/handlers/open-settings", () => ({
  openExtensionSettings: delegates.openExtensionSettings
}));
vi.mock("@/extension/handlers/onboarding", () => ({ runCommand: delegates.runCommand }));

beforeEach(() => {
  for (const [name, delegate] of Object.entries(delegates)) {
    delegate.mockReset();
    delegate.mockResolvedValue(`from ${name}`);
  }
});

/** Call a handler the way the RPC server does: through the loosely typed table. */
function call(method: string, params: unknown) {
  const table: Readonly<Record<string, (params: unknown) => unknown>> = rpcHandlers;
  return table[method]!(params);
}

describe("the RPC handler table", () => {
  test("is a plain object with one function per method", () => {
    expect(Object.getPrototypeOf(rpcHandlers)).toBe(Object.prototype);
    expect(Object.keys(rpcHandlers).toSorted()).toEqual([
      "clipboard.copy",
      "docs.open",
      "git.init",
      "repo.scan",
      "settings.open",
      "walkthrough.open",
      "webview.initialize"
    ]);
    for (const handler of Object.values(rpcHandlers)) {
      expect(handler).toBeTypeOf("function");
    }
  });

  test("matches the method map at compile time", () => {
    expectTypeOf(rpcHandlers).toExtend<Readonly<Record<string, (params: unknown) => unknown>>>();
    expectTypeOf<keyof typeof rpcHandlers>().toEqualTypeOf<RpcMethod>();
    expectTypeOf<Awaited<ReturnType<(typeof rpcHandlers)["repo.scan"]>>>().toEqualTypeOf<
      RpcMethodMap["repo.scan"]["result"]
    >();
  });

  test.each([
    ["clipboard.copy", delegates.copyToClipboard, ["p"]],
    ["webview.initialize", delegates.webviewInitialize, []],
    ["git.init", delegates.initializeRepo, []],
    ["repo.scan", delegates.scanRepos, []],
    ["settings.open", delegates.openExtensionSettings, []],
    ["docs.open", delegates.runCommand, ["branchwise.openDocumentation"]],
    ["walkthrough.open", delegates.runCommand, ["branchwise.openWalkthrough"]]
  ])("answers %s through its delegate", async (method, delegate, args) => {
    const answer = call(method, "p");
    expect(delegate).toHaveBeenCalledExactlyOnceWith(...args);
    await expect(answer).resolves.toBe(await delegate.mock.results[0]!.value);
  });

  test("passes a rejection on unchanged", async () => {
    const failure = new Error("x");
    delegates.scanRepos.mockRejectedValueOnce(failure);
    await expect(call("repo.scan", null)).rejects.toBe(failure);
  });

  test("passes a synchronous throw on unchanged", () => {
    const failure = new Error("sync");
    delegates.copyToClipboard.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => call("clipboard.copy", "text")).toThrow(failure);
  });

  test("ignores params for every method but clipboard.copy", () => {
    call("git.init", { x: 1 });
    call("settings.open", [1, 2]);
    expect(delegates.initializeRepo).toHaveBeenCalledExactlyOnceWith();
    expect(delegates.openExtensionSettings).toHaveBeenCalledExactlyOnceWith();
  });
});

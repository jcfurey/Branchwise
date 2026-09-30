import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

import { logger } from "@/extension/util/logger";
import { ExtensionState } from "@/old-extension/extensionState";
import { createRepoManager } from "@/old-extension/repoManager";

const removal = vi.hoisted(() => ({ refuse: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rm: (...args: Parameters<typeof real.rm>) =>
      removal.refuse
        ? Promise.reject(
            Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" })
          )
        : real.rm(...args)
  };
});
vi.mock("@/extension/util/logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

/** A Memento double over a plain record, counting what is asked of it. */
function memento(values: Record<string, unknown> = {}) {
  return {
    get: vi.fn((key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
    update: vi.fn((_key: string, _value: unknown): Promise<void> => Promise.resolve())
  };
}

let storage: string;
let unhandled: unknown[];
const noteUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  vi.clearAllMocks();
  removal.refuse = false;
  unhandled = [];
  process.on("unhandledRejection", noteUnhandled);
  storage = mkdtempSync(join(tmpdir(), "branchwise-state-"));
});
afterEach(() => {
  process.off("unhandledRejection", noteUnhandled);
  rmSync(storage, { recursive: true, force: true });
});

function open(parts: {
  globalState?: object;
  workspaceState?: object;
  globalStoragePath?: string;
}) {
  const context = {
    globalState: memento(),
    workspaceState: memento(),
    globalStoragePath: storage,
    ...parts
  };
  return new ExtensionState(context as unknown as ExtensionContext);
}

/** Give background work, such as rejections and removals, time to settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("creation", () => {
  it("removes the avatar folder only, and leaves the rest of storage alone", async () => {
    mkdirSync(join(storage, "avatars"));
    writeFileSync(join(storage, "avatars", "someone.png"), "");
    writeFileSync(join(storage, "keep.txt"), "kept");
    const globalState = memento();
    const workspaceState = memento();

    open({ globalState, workspaceState });

    await vi.waitFor(() => expect(existsSync(join(storage, "avatars"))).toBe(false));
    expect(existsSync(join(storage, "keep.txt"))).toBe(true);
    expect(globalState.get).toHaveBeenCalledExactlyOnceWith("avatarCache");
    expect(globalState.update).not.toHaveBeenCalled();
    expect(workspaceState.get).not.toHaveBeenCalled();
    expect(workspaceState.update).not.toHaveBeenCalled();
  });

  it("clears any stored avatar cache, even an empty one, without a storage folder", async () => {
    const globalState = memento({ avatarCache: null });

    expect(() => open({ globalState, globalStoragePath: join(storage, "absent") })).not.toThrow();

    expect(globalState.update).toHaveBeenCalledExactlyOnceWith("avatarCache", undefined);
    await settle();
    expect(unhandled).toEqual([]);
  });

  it("ignores an avatar folder it cannot remove", async () => {
    removal.refuse = true;
    mkdirSync(join(storage, "avatars"));

    expect(() => open({})).not.toThrow();

    await settle();
    expect(unhandled).toEqual([]);
    expect(existsSync(join(storage, "avatars"))).toBe(true);
  });

  // Decision extensionState Q1: a failed storage write is logged, not left unhandled.
  it("logs a failure to clear the avatar cache", async () => {
    const globalState = memento({ avatarCache: {} });
    const failure = new Error("storage is read-only");
    globalState.update.mockImplementationOnce(() => Promise.reject(failure));

    open({ globalState });
    await settle();

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), failure);
    expect(unhandled).toEqual([]);
  });
});

describe("repository records", () => {
  it("default to a new empty set", () => {
    const workspaceState = memento();
    const state = open({ workspaceState });

    const first = state.getRepos();
    const second = state.getRepos();

    expect(first).toEqual({});
    expect(first).not.toBe(second);
    expect(workspaceState.get).toHaveBeenCalledWith("repoStates", {});
  });

  it("come back as stored", () => {
    const stored = { "/r": { columnWidths: [10, 20] } };
    const state = open({ workspaceState: memento({ repoStates: stored }) });

    expect(state.getRepos()).toBe(stored);
  });

  it("are saved under their key without waiting", () => {
    const workspaceState = memento();
    const state = open({ workspaceState });
    const records = { "/x": { columnWidths: null } };

    expect(state.saveRepos(records)).toBeUndefined();
    expect(workspaceState.update).toHaveBeenCalledExactlyOnceWith("repoStates", records);
  });

  it("log a save that storage refuses", async () => {
    const workspaceState = memento();
    const failure = new Error("quota exceeded");
    workspaceState.update.mockImplementationOnce(() => Promise.reject(failure));
    const state = open({ workspaceState });

    state.saveRepos({});
    await settle();

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), failure);
    expect(unhandled).toEqual([]);
  });

  // Decision extensionState Q3: damaged entries are skipped, so the manager keeps working.
  it("leave out entries that are not records", () => {
    const valid = { columnWidths: null, hiddenRemotes: ["origin"] };
    const stored = { "/ok": valid, "/null": null, "/list": [1], "/text": "x", "/count": 3 };
    const state = open({ workspaceState: memento({ repoStates: stored }) });

    const records = state.getRepos();

    expect(records).toEqual({ "/ok": valid });
    expect(records["/ok"]).toBe(valid);
    expect(createRepoManager(state).getRepos()).toEqual({ "/ok": valid });
  });

  it.each([null, [], "records", 42])("read a damaged store (%j) as empty", (stored) => {
    const state = open({ workspaceState: memento({ repoStates: stored }) });

    expect(state.getRepos()).toEqual({});
    expect(() => createRepoManager(state).getRepos()).not.toThrow();
  });
});

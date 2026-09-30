import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

import { extConfig, resolveBuiltInGitPath } from "@/extension/config";

const env = vi.hoisted(() => ({
  gitPathSetting: undefined as unknown,
  lookups: [] as unknown[][],
  getExtension: vi.fn()
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: (section: string) => ({
      get: (...args: unknown[]) => {
        env.lookups.push([section, ...args]);
        return section === "git" && args[0] === "path" ? env.gitPathSetting : args[1];
      }
    })
  },
  extensions: { getExtension: env.getExtension }
}));

/** The part of the built-in Git extension that the lookup uses. */
function gitExtension(path: string, active = true) {
  const exports = { getAPI: vi.fn((_version: number) => ({ git: { path } })) };
  return {
    isActive: active,
    exports: active ? exports : undefined,
    activate: vi.fn(async () => exports),
    api: exports.getAPI
  };
}

const scratch = mkdtempSync(join(tmpdir(), "branchwise git path "));
const installed = join(scratch, "git");
writeFileSync(installed, "");

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(async () => {
  env.getExtension.mockReset();
  env.lookups.length = 0;
  env.gitPathSetting = "/other";
  // Start every test without a recorded built-in path.
  await resolveBuiltInGitPath();
});

describe("the built-in Git extension's executable", () => {
  test("wins over git.path once an active extension reports it", async () => {
    const extension = gitExtension("/builtin/git");
    env.getExtension.mockReturnValue(extension);
    await resolveBuiltInGitPath();
    expect(env.getExtension).toHaveBeenCalledWith("vscode.git");
    expect(extConfig.gitPath()).toBe("/builtin/git");
    expect(extension.api).toHaveBeenCalledExactlyOnceWith(1);
    expect(extension.activate).not.toHaveBeenCalled();
  });

  test("is read after activating an extension that was not active yet", async () => {
    const extension = gitExtension("/activated/git", false);
    env.getExtension.mockReturnValue(extension);
    await resolveBuiltInGitPath();
    expect(extension.activate).toHaveBeenCalledOnce();
    expect(extConfig.gitPath()).toBe("/activated/git");
  });

  test("leaves gitPath to git.path until the lookup has settled", async () => {
    const extension = gitExtension("/late/git", false);
    const activation = Promise.withResolvers<{ getAPI: () => unknown }>();
    extension.activate.mockReturnValueOnce(activation.promise as never);
    env.getExtension.mockReturnValue(extension);
    const lookup = resolveBuiltInGitPath();
    expect(extConfig.gitPath()).toBe("/other");
    activation.resolve({ getAPI: () => ({ git: { path: "/late/git" } }) });
    await lookup;
    expect(extConfig.gitPath()).toBe("/late/git");
  });

  test("is not needed when VS Code has no Git extension", async () => {
    env.getExtension.mockReturnValue(undefined);
    await resolveBuiltInGitPath();
    expect(extConfig.gitPath()).toBe("/other");
  });

  const failures: [string, () => unknown][] = [
    [
      "getAPI throws",
      () => ({
        isActive: true,
        exports: {
          getAPI() {
            throw new Error("Git model not found");
          }
        }
      })
    ],
    [
      "activation rejects",
      () => ({ isActive: false, activate: () => Promise.reject(new Error("no")) })
    ],
    [
      "the extension lookup throws",
      () => {
        throw new Error("lookup failed");
      }
    ],
    ["the path is empty", () => gitExtension("")],
    ["getAPI returns nothing", () => ({ isActive: true, exports: { getAPI: () => undefined } })],
    ["the exports are missing", () => ({ isActive: true, exports: undefined })]
  ];

  test.each(failures)("is forgotten again when %s", async (_case, lookUp) => {
    env.getExtension.mockReturnValueOnce(gitExtension("/builtin/git"));
    await resolveBuiltInGitPath();
    expect(extConfig.gitPath()).toBe("/builtin/git");

    env.getExtension.mockImplementationOnce(lookUp);
    await expect(resolveBuiltInGitPath()).resolves.toBeUndefined();
    expect(extConfig.gitPath()).toBe("/other");
  });
});

describe("the git.path setting", () => {
  test("is read afresh on every call, by key alone", () => {
    env.gitPathSetting = "/a";
    expect(extConfig.gitPath()).toBe("/a");
    env.gitPathSetting = [join(scratch, "missing"), installed];
    expect(extConfig.gitPath()).toBe(installed);
    expect(env.lookups).toEqual([
      ["git", "path"],
      ["git", "path"]
    ]);
  });

  test("falls back to git on the PATH when it names nothing", () => {
    env.gitPathSetting = null;
    expect(extConfig.gitPath()).toBe("git");
  });
});

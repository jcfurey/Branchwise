import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("node:path");
  vi.resetModules();
});

async function usePlatform(platform: "win32" | "posix") {
  vi.resetModules();
  const nativePath = await vi.importActual<typeof import("node:path")>("node:path");
  vi.doMock("node:path", () => nativePath[platform]);
  return import("@/backend/utils/repoPath");
}

describe("repository path normalization", () => {
  it("uses one key for Windows Git and VS Code paths", async () => {
    const { normalizeRepoPath } = await usePlatform("win32");
    expect(normalizeRepoPath("C:\\workspace\\child module")).toBe("c:/workspace/child module");
    expect(normalizeRepoPath("c:/workspace/child module")).toBe("c:/workspace/child module");
    expect(normalizeRepoPath("C:/workspace/packages/../child module")).toBe(
      "c:/workspace/child module"
    );
    expect(normalizeRepoPath("\\\\server\\share\\repo")).toBe("//server/share/repo");
  });

  it("preserves literal backslashes in POSIX repository names", async () => {
    const { normalizeRepoPath } = await usePlatform("posix");
    expect(normalizeRepoPath("/workspace/repo\\name")).toBe("/workspace/repo\\name");
  });

  it("deduplicates overlapping Windows workspace folders and filters known submodules", async () => {
    await usePlatform("win32");
    vi.doMock("@/backend/utils/git", () => ({
      workTreeRoot: async (directory: string) => directory,
      getSubmodulePaths: async (repo: string) =>
        repo === "c:/workspace" ? ["C:/workspace/child module"] : []
    }));
    try {
      const { findGitRepos } = await import("@/backend/queries/repoSearch");
      const { searchDirectoryForRepos } = await import("@/backend/utils/repoSearch");
      expect(
        await findGitRepos(["C:\\workspace", "c:\\workspace\\child module"], "git", 0)
      ).toEqual(["c:/workspace", "c:/workspace/child module"]);
      expect(
        await searchDirectoryForRepos("C:\\workspace", 0, "git", ["c:\\workspace\\child module"])
      ).toEqual(["c:/workspace"]);
    } finally {
      vi.doUnmock("@/backend/utils/git");
    }
  });

  it.each([
    ["posix", "/", "/workspace"],
    ["win32", "C:\\", "C:\\workspace"],
    ["win32", "\\\\server\\share\\", "\\\\server\\share\\workspace"],
    ["posix", "/workspace/", "/workspace/child"],
    ["win32", "C:\\workspace\\", "C:\\workspace\\child"]
  ] as const)("skips children of the %s known repo %s", async (platform, known, child) => {
    await usePlatform(platform);
    const workTreeRoot = vi.fn(async (directory: string) => directory);
    vi.doMock("@/backend/utils/git", () => ({
      workTreeRoot,
      getSubmodulePaths: async () => []
    }));
    try {
      const { searchDirectoryForRepos } = await import("@/backend/utils/repoSearch");
      expect(await searchDirectoryForRepos(child, 0, "git", [known])).toEqual([]);
      expect(workTreeRoot).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/backend/utils/git");
    }
  });

  it.each([
    ["posix", "/workspace", "/workspace-other"],
    ["win32", "C:\\", "D:\\workspace"]
  ] as const)("still scans unrelated %s paths", async (platform, known, other) => {
    const { normalizeRepoPath } = await usePlatform(platform);
    vi.doMock("@/backend/utils/git", () => ({
      workTreeRoot: async (directory: string) => directory,
      getSubmodulePaths: async () => []
    }));
    try {
      const { searchDirectoryForRepos } = await import("@/backend/utils/repoSearch");
      expect(await searchDirectoryForRepos(other, 0, "git", [known])).toEqual([
        normalizeRepoPath(other)
      ]);
    } finally {
      vi.doUnmock("@/backend/utils/git");
    }
  });
});

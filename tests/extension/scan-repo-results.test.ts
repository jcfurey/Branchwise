import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, test, vi } from "vitest";

import { scanRepos } from "@/extension/handlers/scan-repo";

const scan = vi.hoisted(() => ({
  listRepos: vi.fn(),
  info: vi.fn(),
  stored: new Map<string, unknown>()
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: (section: string) => ({
      get: (key: string, fallback?: unknown) => {
        const name = `${section}.${key}`;
        return scan.stored.has(name) ? scan.stored.get(name) : fallback;
      }
    })
  }
}));
vi.mock("@/extension/workspace-scan", () => ({ listRepos: scan.listRepos }));
vi.mock("@/extension/util/logger", () => ({ logger: { info: scan.info } }));

const scratch = mkdtempSync(join(tmpdir(), "branchwise scan "));
const customGit = join(scratch, "custom-git");
writeFileSync(customGit, "");

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  scan.listRepos.mockReset();
  scan.info.mockReset();
  scan.stored.clear();
});

test("asks for repositories with the configured Git and whole search depth", async () => {
  scan.stored.set("branchwise.maxDepthOfRepoSearch", 2.5);
  scan.stored.set("git.path", customGit);
  scan.listRepos.mockResolvedValue([]);
  await scanRepos();
  expect(scan.listRepos).toHaveBeenCalledExactlyOnceWith(customGit, 2);
  expect(scan.info).toHaveBeenCalledExactlyOnceWith(
    `Repository scan completed: 0 found; Git binary: ${customGit}`
  );
});

test("logs one line naming the count and the Git binary", async () => {
  scan.listRepos.mockResolvedValue(["/a/one", "/b/two"]);
  await scanRepos();
  expect(scan.listRepos).toHaveBeenCalledExactlyOnceWith("git", 0);
  expect(scan.info).toHaveBeenCalledExactlyOnceWith(
    "Repository scan completed: 2 found; Git binary: git"
  );
});

test("keeps the order it is given and names each repository after its folder", async () => {
  scan.listRepos.mockResolvedValue(["/b/two", "/a/one", "/x/y/", "/", "c:/w", "/p/a b"]);
  expect(await scanRepos()).toEqual({
    repos: [
      { name: "two", path: "/b/two" },
      { name: "one", path: "/a/one" },
      { name: "y", path: "/x/y/" },
      { name: "", path: "/" },
      { name: "w", path: "c:/w" },
      { name: "a b", path: "/p/a b" }
    ]
  });
});

test("passes a failed scan on without logging it", async () => {
  const broken = new Error("scan broke");
  scan.listRepos.mockRejectedValue(broken);
  await expect(scanRepos()).rejects.toBe(broken);
  expect(scan.info).not.toHaveBeenCalled();
});

test("scans again on every request", async () => {
  scan.listRepos.mockResolvedValue(["/r"]);
  await scanRepos();
  await scanRepos();
  expect(scan.listRepos).toHaveBeenCalledTimes(2);
});

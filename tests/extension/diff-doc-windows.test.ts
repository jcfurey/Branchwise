import type { SimpleGit } from "simple-git";
import { expect, test, vi } from "vitest";

import { DiffDocProvider, encodeDiffDocUri } from "@/old-extension/diffDocProvider";

// Windows path rules on any system: `\` separates folders and `C:\` starts an absolute path.
vi.mock("node:path", async (importOriginal) => {
  const { win32 } = await importOriginal<typeof import("node:path")>();
  return { ...win32, default: win32 };
});

vi.mock("vscode", () => ({
  Uri: {
    from: ({ scheme, path, query }: { scheme: string; path: string; query: string }) => ({
      scheme,
      path,
      query,
      toString: () => `${scheme}:${path}#${query}`
    })
  },
  EventEmitter: class {
    event = () => ({ dispose() {} });
    dispose() {}
  },
  workspace: { onDidCloseTextDocument: () => ({ dispose() {} }) }
}));

const id = "5c".repeat(20);

test("writes backslashes in file paths as slashes", () => {
  expect(encodeDiffDocUri("C:\\work\\one", "d\\f.txt", id).path).toBe("d/f.txt");
});

test("recognises a repository whatever the case of its drive letter or its separators", async () => {
  encodeDiffDocUri("C:\\work\\two", "f", id);
  const folders: string[] = [];
  const saved = vi.fn(() => false);
  const provider = new DiffDocProvider((folder) => {
    folders.push(folder);
    return { show: async () => "from Windows" } as unknown as SimpleGit;
  }, saved);
  const uri = {
    path: "f",
    query: `commit=${id}&repo=${encodeURIComponent("c:/work/two")}`,
    toString: () => "lowercase drive"
  } as unknown as import("vscode").Uri;

  expect(await provider.provideTextDocumentContent(uri)).toBe("from Windows");
  expect(folders).toEqual(["c:/work/two"]);
  expect(saved).not.toHaveBeenCalled();
});

test("refuses a repository without a drive or root", () => {
  const folders: string[] = [];
  const provider = new DiffDocProvider(
    (folder) => {
      folders.push(folder);
      return {} as SimpleGit;
    },
    () => true
  );
  const uri = {
    path: "f",
    query: `commit=${id}&repo=${encodeURIComponent("C:relative")}`,
    toString: () => "drive-relative"
  } as unknown as import("vscode").Uri;
  expect(provider.provideTextDocumentContent(uri)).toBe("");
  expect(folders).toEqual([]);
});

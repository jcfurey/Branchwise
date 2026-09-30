import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { normalizeRepoPath } from "@/backend/utils/repoPath";
import {
  DiffDocProvider,
  encodeDiffBlobUri,
  encodeDiffDocUri
} from "@/old-extension/diffDocProvider";

import { makeRepo } from "@tests/backend/helpers";

/**
 * A file name that needs escaping in a URI. Git for Windows refuses `?` and control characters in
 * index paths, since NTFS cannot store them, so Windows gets other awkward characters.
 */
const ODD_NAME = process.platform === "win32" ? "odd #%&[] {x}.txt" : "odd #?\tname.txt";

vi.mock("vscode", () => ({
  Uri: {
    from: (parts: { scheme: string; path: string; query: string }) => ({
      ...parts,
      toString: () => `${parts.scheme}:${encodeURIComponent(parts.path)}?${parts.query}`
    })
  },
  EventEmitter: class {
    event = () => ({ dispose() {} });
    dispose() {}
  },
  workspace: { onDidCloseTextDocument: () => ({ dispose() {} }) }
}));

/** Run Git in `cwd`, feeding it `input`, and return what it printed without the final newline. */
function run(cwd: string, args: string[], input?: string | Buffer) {
  return execFileSync("git", args, { cwd, input, stdio: ["pipe", "pipe", "pipe"] })
    .toString()
    .replace(/\n$/, "");
}

/**
 * Commit entries straight into the index, bypassing the working tree and every filter, so the
 * stored bytes are exactly the ones given whatever the platform. A `{ link }` entry is a symbolic
 * link and a `{ gitlink }` entry a submodule commit.
 */
function commitEntries(
  repo: string,
  message: string,
  entries: Record<string, string | Buffer | { link: string } | { gitlink: string }>
) {
  for (const [name, entry] of Object.entries(entries)) {
    let mode = "100644";
    let object: string;
    if (typeof entry === "object" && "gitlink" in entry) {
      mode = "160000";
      object = entry.gitlink;
    } else {
      const bytes = typeof entry === "object" && "link" in entry ? entry.link : entry;
      mode = typeof entry === "object" && "link" in entry ? "120000" : mode;
      object = run(repo, ["hash-object", "-w", "--no-filters", "--stdin"], bytes);
    }
    run(repo, ["update-index", "--add", "--cacheinfo", `${mode},${object},${name}`]);
  }
  run(repo, ["commit", "-q", "-m", message]);
  return run(repo, ["rev-parse", "HEAD"]);
}

const temporary: string[] = [];
let repo: string;
let root: string;
let second: string;
let third: string;
let merge: string;

beforeAll(() => {
  repo = makeRepo();
  temporary.push(repo);
  root = run(repo, ["rev-parse", "HEAD"]);
  run(repo, ["tag", "-a", "v1", "-m", "first release", root]);
  second = commitEntries(repo, "second", {
    ".gitattributes": "conv.txt diff=shout filter=shout\nx.eol text eol=crlf\n",
    "dir/a.txt": "A\n",
    "dir/b.txt": "B",
    "crlf.txt": "l1\r\nl2\r\n",
    "bom.txt": "﻿bom",
    "latin1.txt": Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
    "bin.dat": Buffer.from([0x00, 0x01, 0x02, 0xff, 0x0a]),
    "empty.txt": "",
    "conv.txt": "raw text\n",
    "x.eol": "e1\ne2\n",
    [ODD_NAME]: "odd",
    link: { link: "dir/a.txt" }
  });
  // Both drivers would shout; `git show` must use neither.
  run(repo, ["config", "diff.shout.textconv", "tr a-z A-Z <"]);
  run(repo, ["config", "filter.shout.smudge", "tr a-z A-Z"]);
  third = commitEntries(repo, "submodule", { sm: { gitlink: "9d".repeat(20) } });
  // A merge whose second parent changed `f`, so its first parent is told apart.
  const side = run(repo, [
    "commit-tree",
    "-p",
    root,
    "-m",
    "side",
    run(repo, ["mktree"], `100644 blob ${run(repo, ["hash-object", "-w", "--stdin"], "side")}\tf\n`)
  ]);
  merge = run(repo, ["commit-tree", "-p", third, "-p", side, "-m", "merge", `${third}^{tree}`]);
});

afterAll(() => {
  for (const folder of temporary) {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/** A provider over real Git that records each folder it makes a client for. */
function realGit(saved: (key: string) => boolean = () => false) {
  const folders: string[] = [];
  const provider = new DiffDocProvider((folder) => {
    folders.push(folder);
    return createGit(folder, "git");
  }, saved);
  return { provider, folders };
}

async function fileAt(file: string, commit: string) {
  return realGit().provider.provideTextDocumentContent(encodeDiffDocUri(repo, file, commit));
}

async function objectText(id: string) {
  return realGit().provider.provideTextDocumentContent(encodeDiffBlobUri(repo, "shown.txt", id));
}

describe("files at a commit", () => {
  test.each([
    ["crlf.txt", "l1\r\nl2\r\n"],
    ["bom.txt", "﻿bom"],
    ["latin1.txt", "caf�\n"],
    ["bin.dat", "\u0000\u0001\u0002�\n"],
    ["empty.txt", ""],
    ["conv.txt", "raw text\n"],
    ["x.eol", "e1\ne2\n"],
    [ODD_NAME, "odd"],
    ["link", "dir/a.txt"],
    ["dir/b.txt", "B"]
  ])("shows %j exactly as stored", async (file, text) => {
    expect(await fileAt(file, second)).toBe(text);
  });

  test("shows the first parent's version, which a merge takes from its first parent", async () => {
    expect(await fileAt("f", second + "^")).toBe("x");
    expect(await fileAt("f", merge + "^")).toBe("x");
    expect(await fileAt("f", `${merge}^2`)).toBe("");
  });

  test.each([
    ["the parent of a root commit", "f", () => root + "^"],
    ["a file the commit lacks", "nope.txt", () => second],
    ["an absolute path", "/f", () => second],
    ["a path through ..", "dir/../f", () => second],
    ["a submodule whose commit is missing", "sm", () => third]
  ])("shows an empty document for %s", async (_name, file, commit) => {
    expect(await fileAt(file, commit())).toBe("");
  });

  // Git takes a revision it cannot resolve for a path when a file of that name exists, and then
  // shows HEAD. Windows cannot name a file with `:`; there `dir/../f` above reaches `f` instead.
  test.skipIf(process.platform === "win32")(
    "shows an empty document when the revision also names a file in the working tree",
    async () => {
      const decoy = path.join(repo, `${second}:nope.txt`);
      fs.writeFileSync(decoy, "decoy");
      try {
        expect(await fileAt("nope.txt", second)).toBe("");
      } finally {
        fs.rmSync(decoy);
      }
    }
  );

  test("resolves ./ from the repository root, and lists a folder", async () => {
    expect(await fileAt("./f", second)).toBe("x");
    expect(await fileAt("dir", second)).toBe(`tree ${second}:dir\n\na.txt\nb.txt\n`);
  });

  test("refuses an empty path instead of listing the whole tree", async () => {
    const { provider, folders } = realGit();
    expect(provider.provideTextDocumentContent(encodeDiffDocUri(repo, "", second))).toBe("");
    expect(folders).toEqual([]);
  });

  test("reads through a tree or an annotated tag, but not through a blob", async () => {
    expect(await fileAt("f", run(repo, ["rev-parse", `${second}^{tree}`]))).toBe("x");
    expect(await fileAt("f", run(repo, ["rev-parse", "v1"]))).toBe("x");
    expect(await fileAt("f", run(repo, ["rev-parse", `${second}:f`]))).toBe("");
  });

  test("lets Git reject an ID of the wrong length for the repository", async () => {
    const { provider, folders } = realGit();
    const uri = encodeDiffDocUri(repo, "f", "e".repeat(64));
    expect(await provider.provideTextDocumentContent(uri)).toBe("");
    expect(folders).toEqual([repo]);
  });
});

describe("objects by ID", () => {
  test("shows a blob's bytes", async () => {
    expect(await objectText(run(repo, ["rev-parse", `${second}:dir/a.txt`]))).toBe("A\n");
  });

  test("shows Git's rendering of other objects", async () => {
    const tree = run(repo, ["rev-parse", `${second}^{tree}`]);
    expect(await objectText(tree)).toMatch(new RegExp(`^tree ${tree}\n\n\\.gitattributes\n`));
    expect(await objectText(root)).toContain("diff --git a/f b/f");
  });
});

describe("where Git runs", () => {
  test("serves a repository nothing was built for when it has saved state", async () => {
    const elsewhere = makeRepo();
    temporary.push(elsewhere);
    const head = run(elsewhere, ["rev-parse", "HEAD"]);
    const asked: string[] = [];
    const { provider, folders } = realGit((key) => {
      asked.push(key);
      return key === normalizeRepoPath(elsewhere);
    });
    const spelled = path.join(elsewhere, "gone", "..");
    const uri = {
      path: "f",
      query: `commit=${head}&repo=${encodeURIComponent(spelled)}`,
      toString: () => "saved elsewhere"
    } as unknown as import("vscode").Uri;
    fs.mkdirSync(path.join(elsewhere, "gone"));

    expect(await provider.provideTextDocumentContent(uri)).toBe("x");
    expect(asked).toEqual([normalizeRepoPath(elsewhere)]);
    // The client is made for the folder exactly as the URI spells it.
    expect(folders).toEqual([spelled]);
  });

  test("asks nothing about repositories it built URIs for", async () => {
    const saved = vi.fn(() => false);
    const { provider, folders } = realGit(saved);
    expect(await provider.provideTextDocumentContent(encodeDiffDocUri(repo, "f", root))).toBe("x");
    expect(saved).not.toHaveBeenCalled();
    expect(folders).toEqual([repo]);
  });

  test("shows an empty document when the folder or Git is missing", async () => {
    const missing = path.join(os.tmpdir(), `branchwise-missing-${process.pid}-${Date.now()}`);
    const { provider } = realGit();
    expect(provider.provideTextDocumentContent(encodeDiffDocUri(missing, "f", root))).toBe("");

    const noGit = new DiffDocProvider(
      (folder) => createGit(folder, path.join(missing, "git")),
      () => false
    );
    expect(await noGit.provideTextDocumentContent(encodeDiffDocUri(repo, "f", root))).toBe("");
  });

  test("shows an empty document for a folder that is not a repository", async () => {
    const plain = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "branchwise-plain-"))
    );
    temporary.push(plain);
    const { provider } = realGit();
    expect(await provider.provideTextDocumentContent(encodeDiffDocUri(plain, "f", root))).toBe("");
  });
});

const [major = 0, minor = 0] = run(os.tmpdir(), ["--version"])
  .replace(/^git version /, "")
  .split(".")
  .map(Number);

describe.skipIf(major < 2 || (major === 2 && minor < 29))("SHA-256 repositories", () => {
  test("serve files and blobs by their 64-character IDs, and nothing by 40", async () => {
    const sha256 = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "branchwise-256-"))
    );
    temporary.push(sha256);
    run(sha256, ["init", "-q", "--object-format=sha256"]);
    run(sha256, ["config", "user.name", "T"]);
    run(sha256, ["config", "user.email", "t@t.com"]);
    const head = commitEntries(sha256, "only", { f: "long ids" });
    const blob = run(sha256, ["rev-parse", "HEAD:f"]);
    expect(head).toHaveLength(64);

    const { provider } = realGit();
    expect(await provider.provideTextDocumentContent(encodeDiffDocUri(sha256, "f", head))).toBe(
      "long ids"
    );
    expect(await provider.provideTextDocumentContent(encodeDiffBlobUri(sha256, "f", blob))).toBe(
      "long ids"
    );
    expect(
      await provider.provideTextDocumentContent(encodeDiffDocUri(sha256, "f", "7".repeat(40)))
    ).toBe("");
  });
});

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { selectWatchedRepo, watchGitRepo } from "@/extension/watchers/git-repo.watcher";

import { git, makeRepo } from "@tests/backend/helpers";

type FileHandler = (uri: { fsPath: string }) => void;

const host = vi.hoisted(() => {
  const watchers: { base: string; handlers: Partial<Record<string, FileHandler>> }[] = [];
  return {
    watchers,
    createFileSystemWatcher: (pattern: { base: string }) => {
      const entry = { base: pattern.base, handlers: {} as Partial<Record<string, FileHandler>> };
      watchers.push(entry);
      const on = (kind: string) => (handler: FileHandler) => {
        entry.handlers[kind] = handler;
      };
      return {
        onDidCreate: on("created"),
        onDidChange: on("changed"),
        onDidDelete: on("deleted"),
        dispose() {}
      };
    },
    sent: [] as string[]
  };
});
vi.mock("vscode", () => ({
  workspace: { createFileSystemWatcher: host.createFileSystemWatcher },
  RelativePattern: class {
    readonly base: string;
    constructor(base: string) {
      this.base = base;
    }
  }
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({
  rpcNotify: { notify: (name: string) => void host.sent.push(name) }
}));
vi.mock("@/extension/util/logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

let repo = "";
let lifetime: ReturnType<typeof watchGitRepo>;

/** Report a change to `relative`, below the work tree, as the file system would. */
function touch(relative: string) {
  const watcher = host.watchers.find((entry) => entry.base === repo)!;
  watcher.handlers["changed"]!({ fsPath: path.join(repo, relative) });
}
/** Long enough for the quiet time after an event and for Git to answer about the paths. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 900));

beforeEach(() => {
  repo = makeRepo();
  fs.writeFileSync(path.join(repo, ".gitignore"), "out/\n*.log\n");
  fs.mkdirSync(path.join(repo, "out"));
  fs.writeFileSync(path.join(repo, "out", "bundle.js"), "built");
  fs.writeFileSync(path.join(repo, "server.log"), "line");
  git(["add", ".gitignore"], repo);
  git(["commit", "-q", "-m", "ignore the build"], repo);
  host.watchers.length = 0;
  host.sent = [];
  lifetime = watchGitRepo();
  selectWatchedRepo(repo, "git");
});
afterEach(() => {
  lifetime.dispose();
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("sends no refresh for changes to files that Git ignores", async () => {
  // A build that writes its output, or a server its log, changes nothing the graph shows.
  // Each refresh for it is a round of Git processes, and with steady output they never stop.
  touch("out/bundle.js");
  touch("server.log");
  await settled();
  expect(host.sent).toEqual([]);
});

it("refreshes when any of the changed files is one Git does not ignore", async () => {
  touch("out/bundle.js");
  touch("f");
  await settled();
  expect(host.sent).toEqual(["repo.updated"]);
});

it("refreshes for an ignored name that is tracked all the same, and for the ignore file itself", async () => {
  fs.writeFileSync(path.join(repo, "kept.log"), "tracked");
  git(["add", "--force", "kept.log"], repo);
  git(["commit", "-q", "-m", "a log that is tracked"], repo);

  touch("kept.log");
  await settled();
  expect(host.sent).toEqual(["repo.updated"]);

  touch(".gitignore");
  await settled();
  expect(host.sent).toEqual(["repo.updated", "repo.updated"]);
});

it("asks about a folder inside the work tree from that folder", async () => {
  // The graph can show a repository from one of its folders; the paths are then given from it.
  const inner = path.join(repo, "web");
  fs.mkdirSync(path.join(inner, "out"), { recursive: true });
  fs.writeFileSync(path.join(inner, "page.ts"), "tracked");
  git(["add", "web/page.ts"], repo);
  git(["commit", "-q", "-m", "a page"], repo);
  lifetime.dispose();
  host.watchers.length = 0;
  lifetime = watchGitRepo();
  selectWatchedRepo(inner, "git");
  const report = (relative: string) =>
    host.watchers.find((entry) => entry.base === inner)!.handlers["changed"]!({
      fsPath: path.join(inner, relative)
    });

  report("out/page.js");
  await settled();
  expect(host.sent).toEqual([]);

  report("page.ts");
  await settled();
  expect(host.sent).toEqual(["repo.updated"]);
});

it("refreshes without asking when more files changed than is worth asking about", async () => {
  for (let index = 0; index < 150; index++) {
    touch(`out/chunk-${index}.js`);
  }
  await settled();
  expect(host.sent).toEqual(["repo.updated"]);
});

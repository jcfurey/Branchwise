import * as fs from "node:fs";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createWorkspaceStatus } from "@/backend/queries/workspace";

import { git } from "@tests/backend/helpers";
import { scratchTree } from "@tests/backend/utils/scratchTree";

/**
 * The repositories read, one per read, and an optional wait after each Git command a read runs,
 * before its output reaches the listing.
 */
const reads = vi.hoisted(() => ({
  repos: [] as string[],
  after: undefined as ((repo: string, command: string[]) => Promise<void> | undefined) | undefined
}));

vi.mock("@/backend/gitClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/gitClient")>();
  return {
    ...actual,
    gitClientFactory: (...args: Parameters<typeof actual.gitClientFactory>) => {
      reads.repos.push(args[0]);
      const factory = actual.gitClientFactory(...args);
      const client = factory.getInstance();
      const raw = client.raw.bind(client);
      client.raw = (async (command: string[]) => {
        const output = await raw(command);
        await reads.after?.(args[0], command);
        return output;
      }) as typeof client.raw;
      return { ...factory, getInstance: () => client };
    }
  };
});

let tree: ReturnType<typeof scratchTree>;
/** What the workspace lists: `o` with its submodule `o/lib` and a clone inside it, and `other`. */
let listed: string[];
beforeEach(() => {
  tree = scratchTree("workspace-refresh");
  tree.repo("lib", true);
  tree.repo("o", true);
  git(
    ["-c", "protocol.file.allow=always", "submodule", "add", "-q", tree.at("lib"), "lib"],
    tree.at("o")
  );
  git(["commit", "-q", "-m", "add lib"], tree.at("o"));
  tree.repo("o/tools/inner", true);
  tree.repo("other", true);
  listed = ["o", "o/tools/inner", "other"].map((repo) => tree.at(repo));
  reads.repos = [];
  reads.after = undefined;
});
afterEach(() => tree.remove());

const keys = (...repos: string[]) => repos.map((repo) => tree.key(repo)).toSorted();
const readSince = () => reads.repos.splice(0).toSorted();
const dirty = (entries: { path: string; dirty: number }[], repo: string) =>
  entries.find((entry) => entry.path === tree.key(repo))?.dirty;

it("reads only the selected repository, those holding it and those inside it", async () => {
  const status = createWorkspaceStatus();
  const everything = await status.list(listed, "git");
  expect(everything.map((entry) => entry.path)).toStrictEqual(
    keys("o", "o/lib", "o/tools/inner", "other")
  );
  expect(readSince()).toStrictEqual(keys("o", "o/lib", "o/tools/inner", "other"));

  // A submodule is read with the repository holding it, which records its revision.
  expect(await status.list(listed, "git", { around: tree.at("o/lib") })).toStrictEqual(everything);
  expect(readSince()).toStrictEqual(keys("o", "o/lib"));

  expect(await status.list(listed, "git", { around: tree.at("o") })).toStrictEqual(everything);
  expect(readSince()).toStrictEqual(keys("o", "o/lib", "o/tools/inner"));

  expect(await status.list(listed, "git", { around: tree.at("other") })).toStrictEqual(everything);
  expect(readSince()).toStrictEqual(keys("other"));
});

it("lists the other repositories as their last read left them, and leaves out one never read", async () => {
  const status = createWorkspaceStatus();
  const first = await status.list(listed, "git", { around: tree.at("other") });
  expect(first.map((entry) => entry.path)).toStrictEqual(keys("other"));

  await status.list(listed, "git");
  fs.writeFileSync(tree.at("o/tools/inner/new"), "new");
  fs.writeFileSync(tree.at("other/new"), "new");
  const nearby = await status.list(listed, "git", { around: tree.at("other") });
  expect(dirty(nearby, "other")).toBe(1);
  expect(dirty(nearby, "o/tools/inner")).toBe(0);

  expect(dirty(await status.list(listed, "git"), "o/tools/inner")).toBe(1);
});

it("keeps the later read of a repository when an earlier read of it finishes after it", async () => {
  const status = createWorkspaceStatus();
  let reached = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  reads.after = (repo, command) => {
    if (repo === tree.key("other") && command[0] === "status" && !reached) {
      reached = true;
      return held;
    }
    return undefined;
  };
  // This listing has read `other` as clean, and is held before it records that.
  const everything = status.list(listed, "git");
  await vi.waitFor(() => expect(reached).toBe(true), { timeout: 20_000 });

  fs.writeFileSync(tree.at("other/new"), "new");
  expect(dirty(await status.list(listed, "git", { around: tree.at("other") }), "other")).toBe(1);

  release();
  expect(dirty(await everything, "other")).toBe(1);
});

it("forgets a repository that left the workspace once every repository is read again", async () => {
  const status = createWorkspaceStatus();
  await status.list(listed, "git");
  await status.list(listed.slice(0, 2), "git");
  readSince();

  const nearby = await status.list(listed, "git", { around: tree.at("o") });
  expect(nearby.map((entry) => entry.path)).toStrictEqual(keys("o", "o/lib", "o/tools/inner"));
  expect(readSince()).toStrictEqual(keys("o", "o/lib", "o/tools/inner"));
});

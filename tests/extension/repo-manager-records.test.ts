import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionState } from "@/old-extension/extensionState";
import { createRepoManager } from "@/old-extension/repoManager";
import type { GitRepoSet, GitRepoState } from "@/types";

/** Paths whose existence check fails with the given error code, whatever the disk says. */
const refusals = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    access: async (target: string, mode?: number) => {
      const code = refusals.get(target);
      if (code !== undefined) {
        throw Object.assign(new Error(`${code}: refused, access '${target}'`), { code });
      }
      return real.access(target, mode);
    }
  };
});

/** Storage double: `stored` is what it hands out, `saves` what the manager wrote back. */
function storage(stored: GitRepoSet) {
  const saves: GitRepoSet[] = [];
  const getRepos = vi.fn(() => stored);
  const state = { getRepos, saveRepos: (set: GitRepoSet) => saves.push(set) };
  return { manager: createRepoManager(state as unknown as ExtensionState), saves, getRepos };
}

const blank = (): GitRepoState => ({ columnWidths: null });

let scratch: string;
beforeEach(() => {
  refusals.clear();
  scratch = mkdtempSync(join(tmpdir(), "branchwise-records-"));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("reading records", () => {
  it("lists them in code-unit order, in a new object each time", () => {
    const records: GitRepoSet = {
      "/z": blank(),
      "/ä": blank(),
      "/a/b": blank(),
      "/A": blank(),
      "/a-b": blank()
    };
    const { manager } = storage(records);

    const first = manager.getRepos();
    const second = manager.getRepos();

    expect(Object.keys(first)).toEqual(["/A", "/a-b", "/a/b", "/z", "/ä"]);
    expect(first).not.toBe(second);
    for (const repo of Object.keys(records)) {
      expect(second[repo]).toBe(records[repo]);
    }
    delete first["/z"];
    expect(Object.keys(manager.getRepos())).toHaveLength(5);
  });

  it("reads storage only when created", () => {
    const { manager, getRepos } = storage({ "/r": blank() });

    manager.getRepos();
    manager.getRepos();
    manager.getRepos();

    expect(getRepos).toHaveBeenCalledOnce();
  });
});

describe("saving records", () => {
  it("keeps the given record itself and writes on every call", () => {
    const { manager, saves } = storage({ "/ws/a": blank() });
    const record = blank();

    manager.setRepoState("/set", record);
    manager.setRepoState("/set", record);

    expect(manager.getRepos()["/set"]).toBe(record);
    expect(saves).toHaveLength(2);
    expect(saves[1]).toEqual({ "/ws/a": blank(), "/set": record });
  });
});

describe("hidden remotes", () => {
  it("are stored sorted and unique, and only a change is saved", () => {
    const original = { columnWidths: [1], hiddenRemotes: ["b", "a"] };
    const { manager, saves } = storage({ "/r": original });

    const sorted = manager.updateHiddenRemotes("/r", ["b", "a"]);
    expect(sorted).toEqual({ columnWidths: [1], hiddenRemotes: ["a", "b"] });
    expect(sorted).not.toBe(original);
    expect(manager.updateHiddenRemotes("/r", ["a", "b", "b"])).toBeUndefined();
    const cleared = manager.updateHiddenRemotes("/r", []);
    expect(cleared).toEqual({ columnWidths: [1], hiddenRemotes: [] });
    expect(cleared).not.toBe(sorted);

    expect(saves).toHaveLength(2);
    expect(manager.getRepos()["/r"]).toBe(cleared);
  });

  it("create a record only when some remote is hidden", () => {
    const { manager, saves } = storage({});

    expect(manager.updateHiddenRemotes("/none", [])).toBeUndefined();
    expect("/none" in manager.getRepos()).toBe(false);
    expect(saves).toEqual([]);

    expect(manager.updateHiddenRemotes("/none", ["x", "B", "a"])).toEqual({
      columnWidths: null,
      hiddenRemotes: ["B", "a", "x"]
    });
  });
});

describe("pruning", () => {
  it("forgets missing folders in the order they were saved and keeps files", async () => {
    const file = join(scratch, "file");
    writeFileSync(file, "");
    const later = join(scratch, "later");
    const earlier = join(scratch, "earlier");
    const { manager, saves } = storage({
      [later]: blank(),
      [file]: blank(),
      [earlier]: blank(),
      [scratch]: blank()
    });

    expect(await manager.pruneMissing()).toEqual([later, earlier]);
    expect(Object.keys(manager.getRepos()).toSorted()).toEqual([file, scratch].toSorted());
    expect(saves).toHaveLength(1);
  });

  it("does nothing without records", async () => {
    const { manager, saves } = storage({});

    expect(await manager.pruneMissing()).toEqual([]);
    expect(saves).toEqual([]);
  });

  // Decision repoManager Q2: only a path that certainly does not exist is forgotten.
  it("keeps folders it cannot reach and forgets those that cannot exist", async () => {
    const denied = join(scratch, "denied");
    const offline = join(scratch, "offline");
    mkdirSync(denied);
    refusals.set(denied, "EACCES");
    refusals.set(offline, "EIO");
    const file = join(scratch, "file");
    writeFileSync(file, "");
    const belowFile = join(file, "repo");
    const { manager, saves } = storage({
      [denied]: blank(),
      [belowFile]: blank(),
      [offline]: blank()
    });

    expect(await manager.pruneMissing()).toEqual([belowFile]);
    expect(Object.keys(manager.getRepos()).toSorted()).toEqual([denied, offline].toSorted());
    expect(saves).toHaveLength(1);
  });

  // Creating symbolic links needs extra rights on Windows.
  it.skipIf(process.platform === "win32")("forgets a link whose folder is gone", async () => {
    const linked = join(scratch, "linked");
    mkdirSync(linked);
    const link = join(scratch, "link");
    symlinkSync(linked, link);
    const { manager } = storage({ [link]: blank() });

    expect(await manager.pruneMissing()).toEqual([]);
    rmSync(linked, { recursive: true });
    expect(await manager.pruneMissing()).toEqual([link]);
  });
});

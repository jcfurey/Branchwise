import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import * as gitHelpers from "@/backend/utils/git";
import { normalizeRepoPath } from "@/backend/utils/repoPath";

import { onWindows, run, sandbox } from "@tests/backend/sandbox";

const { getSubmodulePaths, workTreeRoot } = gitHelpers;
const box = sandbox();

/** Add `source` to `repo` as a submodule at `where`, cloning it over the file protocol. */
function addSubmodule(repo: string, source: string, where: string) {
  run(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", source, where);
}

/**
 * A superproject with the submodule `lib/kid module`, which has its own submodule `deep one`,
 * and the submodule `zz`, all initialized.
 */
function superproject() {
  const parent = box.repo();
  const kid = box.repo();
  addSubmodule(kid, box.repo(), "deep one");
  run(kid, "commit", "-q", "-m", "add deep one");
  addSubmodule(parent, kid, "lib/kid module");
  addSubmodule(parent, box.repo(), "zz");
  run(
    parent,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "update",
    "-q",
    "--init",
    "--recursive"
  );
  run(parent, "commit", "-q", "-m", "add submodules");
  const key = (relative: string) => normalizeRepoPath(path.join(parent, relative));
  return {
    parent,
    kid: key("lib/kid module"),
    deep: key("lib/kid module/deep one"),
    zz: key("zz")
  };
}

describe("workTreeRoot", () => {
  it("is null when Git cannot run", async () => {
    const repo = box.repo();
    expect(await workTreeRoot(repo, path.join(repo, "missing-git"))).toBeNull();
  });

  it("is null for a bare repository and for a file", async () => {
    const repo = box.repo();
    expect(await workTreeRoot(box.bare(), "git")).toBeNull();
    expect(await workTreeRoot(path.join(repo, "f"), "git")).toBeNull();
    expect(await workTreeRoot(path.join(repo, ".git", "refs"), "git")).toBeNull();
  });

  it("gives a linked worktree its own top level", async () => {
    const repo = box.repo();
    const linked = path.join(box.folder("worktrees"), "linked");
    run(repo, "worktree", "add", "-q", "--detach", linked);
    expect(await workTreeRoot(linked, "git")).toBe(normalizeRepoPath(linked));
  });

  it("gives a submodule folder the submodule's top level", async () => {
    const { parent, kid } = superproject();
    expect(await workTreeRoot(path.join(parent, "lib", "kid module"), "git")).toBe(kid);
  });

  it.skipIf(onWindows)("removes only Git's own newline from the top level", async () => {
    const repo = path.join(box.folder("odd"), "name\n");
    fs.mkdirSync(repo);
    run(repo, "init", "-q");
    const root = await workTreeRoot(repo, "git");
    expect(root).toBe(normalizeRepoPath(repo));
    expect(root?.endsWith("name\n")).toBe(true);
  });
});

describe("getSubmodulePaths", () => {
  it("lists every initialized submodule, nested ones after their parent", async () => {
    const { parent, kid, deep, zz } = superproject();
    expect(await getSubmodulePaths(parent, "git")).toEqual([kid, deep, zz]);
  });

  it("lists the whole superproject from any of its folders", async () => {
    const { parent, kid, deep, zz } = superproject();
    expect(await getSubmodulePaths(path.join(parent, "lib"), "git")).toEqual([kid, deep, zz]);
  });

  it.skipIf(onWindows)("reports real paths when reached through a symlink", async () => {
    const { parent, kid, deep, zz } = superproject();
    const link = path.join(box.folder("links"), "parent link");
    fs.symlinkSync(parent, link);
    expect(await getSubmodulePaths(link, "git")).toEqual([kid, deep, zz]);
  });

  it("is empty outside a repository", async () => {
    expect(await getSubmodulePaths(box.folder("empty"), "git")).toEqual([]);
  });

  it("leaves out a submodule whose folder was deleted", async () => {
    const { parent, zz } = superproject();
    fs.rmSync(path.join(parent, "lib"), { recursive: true, force: true });
    expect(await getSubmodulePaths(parent, "git")).toEqual([zz]);
  });

  it("is empty when any initialized submodule is broken", async () => {
    const { parent } = superproject();
    const link = path.join(parent, "zz", ".git");
    // Git for Windows hides this file, and Windows refuses to overwrite a hidden file.
    fs.rmSync(link);
    fs.writeFileSync(link, "gitdir: /nonexistent/modules/zz\n");
    expect(await getSubmodulePaths(parent, "git")).toEqual([]);
  });
});

describe("the module", () => {
  it("offers only the two folder queries", () => {
    expect(Object.keys(gitHelpers).toSorted()).toEqual(["getSubmodulePaths", "workTreeRoot"]);
  });
});

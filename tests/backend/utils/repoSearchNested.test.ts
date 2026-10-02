import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { searchDirectoryForRepos } from "@/backend/utils/repoSearch";

import { git } from "@tests/backend/helpers";
import { scratchTree } from "@tests/backend/utils/scratchTree";

let tree: ReturnType<typeof scratchTree>;
beforeEach(() => {
  tree = scratchTree("nested");
});
afterEach(() => tree.remove());

const search = (relative: string, nestedDepth: number, depth = 0, known: string[] = []) =>
  searchDirectoryForRepos(tree.at(relative), depth, "git", known, nestedDepth);

const sorted = (paths: string[]) => paths.toSorted();

describe("repositories cloned inside a work tree", () => {
  it("are left out when the nested depth is 0", async () => {
    tree.repo("o");
    tree.repo("o/a");
    expect(await search("o", 0)).toEqual([tree.key("o")]);
  });

  it("are found up to the nested depth, after their parent", async () => {
    tree.repo("o");
    tree.repo("o/a");
    tree.repo("o/lib/b");
    tree.repo("o/x/y/c");
    tree.repo("o/x/y/z/d");
    const found = await search("o", 3);
    expect(found[0]).toBe(tree.key("o"));
    expect(sorted(found)).toEqual(
      sorted([tree.key("o"), tree.key("o/a"), tree.key("o/lib/b"), tree.key("o/x/y/c")])
    );
    expect(sorted(await search("o", 1))).toEqual(sorted([tree.key("o"), tree.key("o/a")]));
  });

  it("are searched in turn for repositories cloned inside them", async () => {
    tree.repo("o");
    tree.repo("o/a");
    tree.repo("o/a/inner");
    expect(await search("o", 1)).toEqual([tree.key("o"), tree.key("o/a"), tree.key("o/a/inner")]);
  });

  it("are found below a workspace folder that is not a repository", async () => {
    tree.repo("ws/o");
    tree.repo("ws/o/a");
    expect(await search("ws", 1, 1)).toEqual([tree.key("ws/o"), tree.key("ws/o/a")]);
  });

  it("are not looked for in hidden folders or dependency stores", async () => {
    tree.repo("o");
    tree.repo("o/.cache/a");
    tree.repo("o/node_modules/b");
    tree.repo("o/bower_components/c");
    expect(await search("o", 3)).toEqual([tree.key("o")]);
  });

  it("are not reached through symlinks", async () => {
    tree.repo("o");
    tree.repo("elsewhere");
    tree.link("o/link", "elsewhere");
    expect(await search("o", 3)).toEqual([tree.key("o")]);
  });

  it("do not include worktrees, and a stray .git folder does not stop the search", async () => {
    tree.repo("o", true);
    git(["worktree", "add", "-q", "--detach", tree.at("o/w")], tree.at("o"));
    tree.folder("o/stray/.git");
    tree.repo("o/stray/real");
    expect(await search("o", 3)).toEqual([tree.key("o"), tree.key("o/stray/real")]);
  });

  it("are dropped when already known", async () => {
    tree.repo("o");
    tree.repo("o/a");
    tree.repo("o/b");
    expect(await search("o", 1, 0, [tree.key("o/a")])).toEqual([tree.key("o"), tree.key("o/b")]);
  });

  it("are found inside submodules, which are listed first", async () => {
    tree.repo("lib", true);
    tree.repo("o", true);
    git(
      ["-c", "protocol.file.allow=always", "submodule", "add", "-q", tree.at("lib"), "lib"],
      tree.at("o")
    );
    tree.repo("o/lib/inner");
    expect(await search("o", 2)).toEqual([
      tree.key("o"),
      tree.key("o/lib"),
      tree.key("o/lib/inner")
    ]);
  });
});

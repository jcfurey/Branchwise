import { afterEach, beforeEach, expect, it } from "vitest";

import { loadWorkspace } from "@/backend/queries/workspace";

import { git } from "@tests/backend/helpers";
import { scratchTree } from "@tests/backend/utils/scratchTree";

let tree: ReturnType<typeof scratchTree>;
beforeEach(() => {
  tree = scratchTree("workspace-nested");
});
afterEach(() => tree.remove());

it("puts a repository cloned inside another under the innermost one holding it", async () => {
  tree.repo("lib", true);
  tree.repo("o", true);
  git(
    ["-c", "protocol.file.allow=always", "submodule", "add", "-q", tree.at("lib"), "lib"],
    tree.at("o")
  );
  tree.repo("o/a", true);
  tree.repo("o/a/b/inner");
  tree.repo("o/lib/deep");
  tree.repo("other");
  const entries = await loadWorkspace(
    ["o", "o/a", "o/a/b/inner", "o/lib/deep", "other"].map((repo) => tree.at(repo)),
    "git"
  );
  const parents = Object.fromEntries(
    entries.map((entry) => [
      entry.path.slice(tree.key().length + 1),
      [entry.parent && entry.parent.slice(tree.key().length + 1), entry.submodulePath]
    ])
  );
  expect(parents).toStrictEqual({
    o: [null, null],
    "o/a": ["o", null],
    "o/a/b/inner": ["o/a", null],
    "o/lib": ["o", "lib"],
    "o/lib/deep": ["o/lib", null],
    other: [null, null]
  });
});

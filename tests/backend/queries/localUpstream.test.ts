import { expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadRemotes } from "@/backend/queries/loadRemotes";

import { freshRepo, git } from "@tests/backend/helpers";

const repo = freshRepo((dir) => {
  git(["branch", "feature"], dir);
  git(["branch", "--set-upstream-to=main", "feature"], dir);
});

it("reports a local upstream under the remote name '.'", async () => {
  // Git spells "this repository" as `.`, which is not among the configured remotes.
  expect(await loadRemotes(createGit(repo(), "git"), "feature")).toStrictEqual({
    remotes: [],
    upstream: { remote: ".", branchName: "main" },
    pushRemote: "."
  });
});

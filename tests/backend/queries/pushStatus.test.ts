import { rmSync } from "node:fs";

import { afterEach, beforeEach, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { repositoryQuery } from "@/backend/queries/repository";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

let repo: string;
beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const commit = (message: string) => {
  git(["commit", "-q", "--allow-empty", "-m", message], repo);
  return gitOutput(["rev-parse", "HEAD"], repo);
};
const status = () => repositoryQuery(createGit(repo, "git"), { kind: "pushStatus" });

it("reports nothing in a repository that has no remote-tracking branches", async () => {
  commit("local only");
  expect(await status()).toEqual({ kind: "pushStatus", unpushed: [], unpulled: [] });
});

it("finds the commits only this computer has and the tracked commits it has not pulled", async () => {
  const base = gitOutput(["rev-parse", "HEAD"], repo);
  const fetched = commit("on the remote");
  git(["update-ref", "refs/remotes/origin/main", fetched], repo);
  git(["reset", "-q", "--hard", base], repo);
  git(["remote", "add", "origin", "https://example.invalid/repo.git"], repo);
  git(["branch", "-q", "--set-upstream-to=origin/main"], repo);
  const first = commit("first local");
  const second = commit("second local");
  // A branch never pushed counts as local, and an untracked remote branch as nobody's to pull.
  git(["checkout", "-q", "-b", "topic", base], repo);
  const topic = commit("topic only");
  const other = gitOutput(["commit-tree", `${base}^{tree}`, "-p", base, "-m", "other"], repo);
  git(["update-ref", "refs/remotes/origin/other", other], repo);
  // A tracked branch that is gone is skipped.
  git(["checkout", "-q", "-b", "orphaned", base], repo);
  git(["config", "branch.orphaned.remote", "origin"], repo);
  git(["config", "branch.orphaned.merge", "refs/heads/gone"], repo);

  const result = await status();
  expect(result).toMatchObject({ kind: "pushStatus", unpulled: [fetched] });
  expect(result.kind === "pushStatus" && result.unpushed.toSorted()).toEqual(
    [first, second, topic].toSorted()
  );
});

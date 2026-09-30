import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";

import { gitOutput, makeRepo } from "@tests/backend/helpers";

const HIDDEN_REFS = 2000;
let repo: string;

/** Visible refs: `upstream/mirror` sits below the hidden `upstream` remote. */
const VISIBLE = ["origin/main", "upstream/mirror/main", "upstream/mirror/feature/deep"];
/** `upstream/mirror/private` sits below the visible `upstream/mirror` but is hidden too. */
const HIDDEN = ["upstream/mirror/private/secret"];

beforeAll(() => {
  repo = makeRepo();
  // Git 2.55 refuses to add a remote named below another, but older repositories have them.
  for (const remote of ["origin", "upstream", "upstream/mirror", "upstream/mirror/private"]) {
    execFileSync("git", ["config", `remote.${remote}.url`, "."], { cwd: repo });
  }
  // One fast-import process creates every commit and ref.
  const refs = [
    ...Array.from({ length: HIDDEN_REFS }, (_, i) => `upstream/branch-${i}`),
    ...VISIBLE,
    ...HIDDEN
  ];
  const stream = refs
    .map(
      (ref, i) =>
        `commit refs/remotes/${ref}\ncommitter T <t@t.com> ${1_700_000_000 + i} +0000\n` +
        `data ${ref.length}\n${ref}\nfrom refs/heads/main^0\n`
    )
    .join("\n");
  execFileSync("git", ["fast-import", "--quiet"], { cwd: repo, input: stream });
}, 60_000);

afterAll(() => rmSync(repo, { recursive: true, force: true }));

it("hides thousands of remote branches with a short command line and the same graph", async () => {
  const client = createGit(repo, "git");
  const raw = vi.spyOn(client, "raw");
  const result = await loadCommits(client, {
    branchName: "",
    maxCommits: 3000,
    showRemoteBranches: true,
    hiddenRemotes: ["upstream", "upstream/mirror/private"],
    hard: true,
    dateType: "Author Date",
    showUncommittedChanges: false
  });

  const log = raw.mock.calls
    .map(([args]) => args as unknown as string[])
    .find((args) => args[0] === "log")!;
  expect(log.join(" ").length).toBeLessThan(500);

  // The visible tips and local history, and nothing else.
  const expected = gitOutput(
    [
      "rev-list",
      "--date-order",
      "--branches",
      "--tags",
      ...VISIBLE.map((ref) => `refs/remotes/${ref}`)
    ],
    repo
  ).split("\n");
  expect(result.commits.map((commit) => commit.hash)).toEqual(expected);
  expect(result.commits.map((commit) => commit.message).toSorted()).toEqual(
    [...VISIBLE, "init"].toSorted()
  );
  expect(
    result.commits
      .flatMap((commit) => commit.refs.filter((ref) => ref.type === "remote"))
      .map((ref) => ref.name)
      .toSorted()
  ).toEqual(VISIBLE.toSorted());
});

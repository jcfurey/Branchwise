import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadHistory } from "@/backend/queries/history";
import type { HistoryFilter } from "@/backend/types";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

const ANY: HistoryFilter = {
  text: "",
  author: "",
  since: "",
  until: "",
  path: "",
  revision: "",
  follow: false
};

/** Each commit's subject, newest first. */
const subjects = (page: { entries: { message: string }[] }) =>
  page.entries.map((entry) => entry.message);

/**
 * Only read. After `init` on `main`:
 * - `fix one`, authored by Ann and committed by Cid, tagged `v1.0` (lightweight);
 * - `fix 2.0`, authored and committed by Bob, tagged `V2.0` (annotated), and the tip of `release`;
 * - `feature work`, by T, the tip of `main`;
 * - `remote only`, by T, the tip of `refs/remotes/origin/topic` and of the hidden
 *   `refs/remotes/mirror/topic`, and on no local branch.
 */
describe("searching history by committer, branch and tag names", () => {
  let repo = "";
  const ids: Record<string, string> = {};

  function commit(subject: string, author: string, committer: string) {
    fs.writeFileSync(path.join(repo, "f"), subject + "\n");
    git(["add", "f"], repo);
    git(
      [
        "-c",
        `user.name=${committer}`,
        "-c",
        `user.email=${committer.toLowerCase()}@example.com`,
        "commit",
        "-q",
        `--author=${author} <${author.toLowerCase()}@example.com>`,
        "-m",
        subject
      ],
      repo
    );
    ids[subject] = gitOutput(["rev-parse", "HEAD"], repo);
  }

  beforeAll(() => {
    repo = makeRepo();
    commit("fix one", "Ann", "Cid");
    git(["tag", "v1.0"], repo);
    commit("fix 2.0", "Bob", "Bob");
    git(["tag", "-a", "V2.0", "-m", "second"], repo);
    git(["branch", "release"], repo);
    commit("feature work", "T", "T");
    git(["checkout", "-q", "-b", "scratch"], repo);
    commit("remote only", "T", "T");
    git(["update-ref", "refs/remotes/origin/topic", "HEAD"], repo);
    git(["update-ref", "refs/remotes/mirror/topic", "HEAD"], repo);
    git(["checkout", "-q", "main"], repo);
    git(["branch", "-D", "scratch"], repo);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("matches the committer, not the author", async () => {
    const client = createGit(repo, "git");
    expect(subjects(await loadHistory(client, { ...ANY, committer: "cid" }, 0))).toStrictEqual([
      "fix one"
    ]);
    expect(subjects(await loadHistory(client, { ...ANY, committer: "ann" }, 0))).toStrictEqual([]);
  });

  it("lists the commits that matching tags point to, annotated or not, ignoring case", async () => {
    const client = createGit(repo, "git");
    const page = await loadHistory(client, { ...ANY, tag: "v" }, 0);
    expect(subjects(page)).toStrictEqual(["fix 2.0", "fix one"]);
    expect(subjects(await loadHistory(client, { ...ANY, tag: "2.0" }, 0))).toStrictEqual([
      "fix 2.0"
    ]);
  });

  it("lists the commits that matching branches point to, local and visible remote", async () => {
    const client = createGit(repo, "git");
    expect(subjects(await loadHistory(client, { ...ANY, branch: "topic" }, 0))).toStrictEqual([
      "remote only"
    ]);
    expect(
      subjects(
        await loadHistory(client, { ...ANY, branch: "topic" }, 0, { hiddenRemotes: ["origin"] })
      )
    ).toStrictEqual(["remote only"]);
    expect(
      subjects(
        await loadHistory(client, { ...ANY, branch: "topic" }, 0, {
          hiddenRemotes: ["origin", "mirror"]
        })
      )
    ).toStrictEqual([]);
    expect(
      subjects(
        await loadHistory(client, { ...ANY, branch: "topic" }, 0, { showRemoteBranches: false })
      )
    ).toStrictEqual([]);
  });

  it("joins branch and tag matches, and narrows them with the other fields", async () => {
    const client = createGit(repo, "git");
    expect(
      subjects(await loadHistory(client, { ...ANY, branch: "main", tag: "v1" }, 0))
    ).toStrictEqual(["feature work", "fix one"]);
    expect(
      subjects(await loadHistory(client, { ...ANY, tag: "v", author: "bob" }, 0))
    ).toStrictEqual(["fix 2.0"]);
    expect(subjects(await loadHistory(client, { ...ANY, tag: "v", text: "one" }, 0))).toStrictEqual(
      ["fix one"]
    );
  });

  it("finds nothing when no name matches", async () => {
    const client = createGit(repo, "git");
    expect(await loadHistory(client, { ...ANY, tag: "nope" }, 0)).toStrictEqual({
      entries: [],
      more: false
    });
  });

  it("reads the fields as literal text unless regular expressions are asked for", async () => {
    const client = createGit(repo, "git");
    expect(subjects(await loadHistory(client, { ...ANY, text: "fix [0-9]" }, 0))).toStrictEqual([]);
    expect(
      subjects(await loadHistory(client, { ...ANY, text: "fix [0-9]", regex: true }, 0))
    ).toStrictEqual(["fix 2.0"]);
    expect(
      subjects(await loadHistory(client, { ...ANY, tag: "^v1", regex: true }, 0))
    ).toStrictEqual(["fix one"]);
  });

  it("rejects a branch or tag pattern that is not a regular expression", async () => {
    const client = createGit(repo, "git");
    await expect(loadHistory(client, { ...ANY, tag: "(", regex: true }, 0)).rejects.toThrow(
      "'(' is not a valid regular expression."
    );
  });

  it("offers the branch and tag names that contain the search text on its first page", async () => {
    const client = createGit(repo, "git");
    const page = await loadHistory(client, { ...ANY, text: "o" }, 0);
    expect(page.refs?.toSorted()).toStrictEqual([
      "refs/remotes/mirror/topic",
      "refs/remotes/origin/topic"
    ]);
    expect(
      (await loadHistory(client, { ...ANY, text: "o" }, 0, { hiddenRemotes: ["mirror"] })).refs
    ).toStrictEqual(["refs/remotes/origin/topic"]);
    expect((await loadHistory(client, { ...ANY, text: "V2" }, 0)).refs).toStrictEqual([
      "refs/tags/V2.0"
    ]);
    expect((await loadHistory(client, { ...ANY, text: "o" }, 100)).refs).toBeUndefined();
    expect((await loadHistory(client, ANY, 0)).refs).toBeUndefined();
    // A commit ID shows that commit alone.
    expect(
      (await loadHistory(client, { ...ANY, text: ids["fix one"]!.slice(0, 10) }, 0)).refs
    ).toBeUndefined();
  });
});

describe("a tag search over many tags", () => {
  /** Enough tagged commits that their IDs, 41 characters a line, exceed Windows' 32,767. */
  const COUNT = 1000;
  let repo = "";

  beforeAll(() => {
    repo = makeRepo();
    // One fast-import builds every commit and tag: a thousand Git processes would take minutes
    // on Windows. Each commit is a second newer than the last, so the order is certain.
    const parent = gitOutput(["rev-parse", "HEAD"], repo);
    const stream = Array.from({ length: COUNT }, (_, index) =>
      [
        "commit refs/heads/bulk",
        `mark :${index + 1}`,
        `committer T <t@t.com> ${1_700_000_000 + index} +0000`,
        `data ${String(index).length + 1}`,
        `c${index}`,
        index === 0 ? `from ${parent}` : `from :${index}`,
        `reset refs/tags/release-${"x".repeat(40)}-${index}`,
        `from :${index + 1}`,
        ""
      ].join("\n")
    ).join("\n");
    execFileSync("git", ["fast-import", "--quiet"], { cwd: repo, input: stream + "\n" });
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("pages through every matching tag's commit, newest first", async () => {
    const client = createGit(repo, "git");
    const offsets = Array.from({ length: COUNT / 100 }, (_, page) => page * 100);
    const pages = await Promise.all(
      offsets.map((offset) => loadHistory(client, { ...ANY, tag: "release-" }, offset))
    );
    expect(pages.map((page) => page.more)).toStrictEqual(
      offsets.map((offset) => offset + 100 < COUNT)
    );
    expect(pages.flatMap((page) => subjects(page))).toStrictEqual(
      Array.from({ length: COUNT }, (_, index) => `c${COUNT - 1 - index}`)
    );
  });
});

describe("a tag search in a bare repository", () => {
  let source = "";
  let bare = "";

  beforeAll(() => {
    source = makeRepo();
    git(["tag", "v1"], source);
    bare = source + "-bare.git";
    git(["clone", "-q", "--bare", source, bare], source);
  });

  afterAll(() => {
    for (const dir of [source, bare]) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("runs Git in the repository, which has no work tree", async () => {
    const client = createGit(bare, "git");
    expect(subjects(await loadHistory(client, { ...ANY, tag: "v1" }, 0))).toStrictEqual(["init"]);
  });
});

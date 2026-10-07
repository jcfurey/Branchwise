import { execFileSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";
import {
  COMMIT_BODY_LINES,
  COMMIT_STATS_BATCH,
  COMMIT_STATS_LIMIT,
  loadCommitStats
} from "@/backend/queries/commitStats";
import { repositoryQuery } from "@/backend/queries/repository";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

const repo = freshRepo();

const head = () => gitOutput(["rev-parse", "HEAD"], repo());

/** Write each file, stage everything and commit it with `message`; the new commit's ID. */
function commitFiles(message: string, files: Record<string, string | Buffer>) {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(repo(), name), content);
  }
  git(["add", "-A"], repo());
  git(["commit", "-q", "-m", message], repo());
  return head();
}

/** A client of its own each time, so that only the cache in the module carries answers over. */
const stats = (hashes: string[]) => loadCommitStats(createGit(repo(), "git"), hashes);

/** The counts alone, without the body. */
async function counts(hash: string) {
  const { files, additions, deletions } = (await stats([hash]))[hash]!;
  return { files, additions, deletions };
}

/** What the commit details list for `hash`, summed as the counts sum it. */
async function detailsCounts(hash: string) {
  const { commitDetails: details } = await commitDetails(createGit(repo(), "git"), {
    commitHash: hash,
    dateType: "Author Date"
  });
  const changes = details!.fileChanges;
  return {
    files: changes.length,
    additions: changes.reduce((sum, change) => sum + (change.additions ?? 0), 0),
    deletions: changes.reduce((sum, change) => sum + (change.deletions ?? 0), 0)
  };
}

/** The work tree, the index and the refs. Status is told not to refresh the index itself. */
const snapshot = () => [
  statSync(path.join(repo(), ".git", "index")).mtimeMs,
  gitOutput(["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], repo()),
  gitOutput(["for-each-ref", "--format=%(refname) %(objectname)"], repo())
];

describe("change counts", () => {
  it("counts the files, added and deleted lines of an ordinary commit", async () => {
    writeFileSync(path.join(repo(), "f"), "one\ntwo\nthree\n");
    git(["commit", "-q", "-am", "three lines"], repo());
    const hash = commitFiles("edit", { f: "one\n2\nthree\nfour\n", g: "new\n" });

    expect(await counts(hash)).toEqual({ files: 2, additions: 3, deletions: 1 });
    expect(await counts(hash)).toEqual(await detailsCounts(hash));
  });

  it("counts a root commit against the empty tree", async () => {
    const root = gitOutput(["rev-list", "--max-parents=0", "HEAD"], repo());
    // makeRepo's first commit adds `f` holding `x`.
    expect(await counts(root)).toEqual({ files: 1, additions: 1, deletions: 0 });
    expect(await counts(root)).toEqual(await detailsCounts(root));
  });

  it("counts a merge against its first parent, as the details list it", async () => {
    git(["checkout", "-q", "-b", "topic"], repo());
    commitFiles("topic one", { t: "a\nb\n" });
    commitFiles("topic two", { u: "c\n" });
    git(["checkout", "-q", "main"], repo());
    commitFiles("main", { m: "main\n" });
    git(["merge", "-q", "--no-ff", "--no-edit", "topic"], repo());
    const merge = head();

    // What the topic brought in, not what main brought into the topic.
    expect(await counts(merge)).toEqual({ files: 2, additions: 3, deletions: 0 });
    expect(await counts(merge)).toEqual(await detailsCounts(merge));
  });

  it("counts a merge that brought nothing new, and an empty commit, as no changes", async () => {
    git(["checkout", "-q", "-b", "same"], repo());
    git(["commit", "-q", "--allow-empty", "-m", "nothing"], repo());
    const empty = head();
    git(["checkout", "-q", "main"], repo());
    git(["merge", "-q", "--no-ff", "-s", "ours", "--no-edit", "same"], repo());
    const merge = head();

    const answer = await stats([empty, merge]);
    expect(answer[empty]).toMatchObject({ files: 0, additions: 0, deletions: 0 });
    expect(answer[merge]).toMatchObject({ files: 0, additions: 0, deletions: 0 });
  });

  it("counts a binary file as a file without lines", async () => {
    const hash = commitFiles("binary", {
      "image.bin": Buffer.from([0, 1, 2, 3, 0, 255]),
      notes: "one\ntwo\n"
    });
    expect(await counts(hash)).toEqual({ files: 2, additions: 2, deletions: 0 });
    expect(await counts(hash)).toEqual(await detailsCounts(hash));
  });

  it("counts a rename as one file, with only the lines that changed", async () => {
    commitFiles("long", { old: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n" });
    git(["mv", "old", "new name"], repo());
    const hash = commitFiles("rename", { "new name": "1\n2\n3\n4\n5\n6\n7\n8\n9\nten\n" });

    expect(await counts(hash)).toEqual({ files: 1, additions: 1, deletions: 1 });
    expect(await counts(hash)).toEqual(await detailsCounts(hash));
  });

  it("answers for several commits in one call, leaving out one Git does not have", async () => {
    const first = commitFiles("first", { a: "a\n" });
    const second = commitFiles("second", { a: "b\n", b: "b\n" });
    const gone = "0123456789".repeat(4);

    const answer = await stats([second, first, gone, first]);
    expect(Object.keys(answer).toSorted()).toEqual([first, second].toSorted());
    expect(answer[first]).toMatchObject({ files: 1, additions: 1, deletions: 0 });
    expect(answer[second]).toMatchObject({ files: 2, additions: 2, deletions: 1 });
  });

  it("keeps the first lines of the body, without the subject or blank lines around it", async () => {
    const lines = Array.from({ length: COMMIT_BODY_LINES + 2 }, (_, at) => `line ${at + 1}`);
    git(["commit", "-q", "--allow-empty", "-m", "Subject", "-m", lines.join("\n")], repo());
    const long = head();
    git(["commit", "-q", "--allow-empty", "-m", "Short", "-m", "Only\r\n\r\nbody"], repo());
    const short = head();
    git(["commit", "-q", "--allow-empty", "-m", "No body"], repo());
    const none = head();

    const answer = await stats([long, short, none]);
    expect(answer[long]).toMatchObject({
      body: lines.slice(0, COMMIT_BODY_LINES).join("\n"),
      bodyCut: true
    });
    expect(answer[short]).toMatchObject({ body: "Only\n\nbody", bodyCut: false });
    expect(answer[none]).toMatchObject({ body: "", bodyCut: false });
  });

  it("asks Git once per batch, and remembers every answer", async () => {
    const parent = head();
    const count = COMMIT_STATS_BATCH + 5;
    // One fast-import builds every commit; a Git process for each would take long on Windows.
    const stream = Array.from({ length: count }, (_, index) =>
      [
        "commit refs/heads/main",
        `mark :${index + 1}`,
        `committer T <t@t.com> ${1_700_000_000 + index} +0000`,
        `data ${String(index).length + 1}`,
        `c${index}`,
        index === 0 ? `from ${parent}` : `from :${index}`,
        `M 100644 inline file${index}`,
        "data 2",
        "x",
        ""
      ].join("\n")
    ).join("\n");
    execFileSync("git", ["fast-import", "--quiet"], { cwd: repo(), input: stream + "\n" });
    const hashes = gitOutput(["rev-list", "--reverse", `${parent}..main`], repo()).split("\n");
    expect(hashes).toHaveLength(count);

    const client = createGit(repo(), "git");
    const raw = vi.spyOn(client, "raw");
    const answer = await loadCommitStats(client, hashes);
    const asked = raw.mock.calls.map(([args]) =>
      [args].flat().filter((arg) => /^[0-9a-f]{40}$/.test(String(arg)))
    );
    expect(asked.map((batch) => batch.length)).toEqual([COMMIT_STATS_BATCH, 5]);
    expect(Object.keys(answer)).toHaveLength(count);
    expect(Object.values(answer).every((each) => each.files === 1 && each.additions === 1)).toBe(
      true
    );

    raw.mockClear();
    expect(await loadCommitStats(client, hashes.slice(0, 10))).toEqual(
      Object.fromEntries(hashes.slice(0, 10).map((hash) => [hash, answer[hash]]))
    );
    expect(raw).not.toHaveBeenCalled();
  });

  it("refuses anything but full commit IDs, and too many of them", async () => {
    await expect(stats(["HEAD"])).rejects.toThrow("HEAD is not a full commit ID.");
    await expect(stats(["--all"])).rejects.toThrow("--all is not a full commit ID.");
    const many = Array.from({ length: COMMIT_STATS_LIMIT + 1 }, () => head());
    await expect(stats(many)).rejects.toThrow(
      `Ask for the changes of at most ${COMMIT_STATS_LIMIT} commits at a time.`
    );
  });

  it("stops when the request is cancelled", async () => {
    const hash = commitFiles("cancelled", { c: "c\n" });
    const controller = new AbortController();
    controller.abort();
    const client = createGit(repo(), "git", controller.signal);
    const raw = vi.spyOn(client, "raw");
    await expect(loadCommitStats(client, [hash])).rejects.toThrow();
    expect(raw).not.toHaveBeenCalled();
  });

  it("reads the same counts whatever the user's diff and log settings say", async () => {
    git(["checkout", "-q", "-b", "side"], repo());
    commitFiles("side", { s: "s\n" });
    git(["checkout", "-q", "main"], repo());
    commitFiles("long", { old: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n" });
    git(["mv", "old", "renamed"], repo());
    const rename = commitFiles("rename", { renamed: "1\n2\n3\n4\n5\n6\n7\n8\n9\nten\n" });
    git(["merge", "-q", "--no-ff", "--no-edit", "side"], repo());
    const merge = head();
    const root = gitOutput(["rev-list", "--max-parents=0", "HEAD"], repo());
    for (const [key, value] of [
      ["diff.renames", "false"],
      ["diff.algorithm", "patience"],
      ["diff.relative", "true"],
      ["diff.noprefix", "true"],
      ["log.showRoot", "false"],
      ["log.diffMerges", "separate"],
      ["log.showSignature", "true"],
      ["format.pretty", "oneline"],
      ["color.ui", "always"],
      ["core.quotePath", "true"]
    ]) {
      git(["config", key!, value!], repo());
    }

    const answer = await stats([rename, merge, root]);
    expect(answer[rename]).toMatchObject({ files: 1, additions: 1, deletions: 1 });
    expect(answer[merge]).toMatchObject({ files: 1, additions: 1, deletions: 0 });
    expect(answer[root]).toMatchObject({ files: 1, additions: 1, deletions: 0 });
  });

  it("changes nothing on disk, and answers through the repository query", async () => {
    const hash = commitFiles("query", { q: "q\n" });
    writeFileSync(path.join(repo(), "untracked"), "left alone\n");
    writeFileSync(path.join(repo(), "f"), "edited\n");
    const before = snapshot();

    expect(
      await repositoryQuery(createGit(repo(), "git"), { kind: "commitStats", hashes: [hash] })
    ).toStrictEqual({
      kind: "commitStats",
      stats: { [hash]: { files: 1, additions: 1, deletions: 0, body: "", bodyCut: false } }
    });
    expect(snapshot()).toEqual(before);
  });
});

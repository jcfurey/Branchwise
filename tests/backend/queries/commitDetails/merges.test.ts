import { describe, expect, it } from "vitest";

import { change, tempRepo, type Repo } from "@tests/backend/queries/commitDetails/repo";

/** Commit `files` on the current branch with the porcelain, and return the new commit. */
function commitFiles(repo: Repo, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    repo.write(file, content);
  }
  repo.git(["add", "--", ...Object.keys(files)]);
  repo.git(["commit", "-q", "-m", Object.keys(files).join(" ")]);
  return repo.line(["rev-parse", "HEAD"]);
}

describe("commitDetails for merges", () => {
  it("lists a merge's changes and line counts against its first parent", async () => {
    const repo = tempRepo();
    commitFiles(repo, { f: "a\nb\nc\nd\ne\n" });
    repo.git(["checkout", "-q", "-b", "side"]);
    const side = commitFiles(repo, { f: "a\nb\nc\nd\ne\nS1\nS2\nS3\n", s: "s\n" });
    repo.git(["checkout", "-q", "main"]);
    const main = commitFiles(repo, { f: "M1\nb\nc\nd\ne\n", m: "m\n" });
    repo.git(["merge", "-q", "--no-edit", "side"]);

    // Against the second parent, f would read +1 -1 and m would be added.
    expect((await repo.details("HEAD")).commitDetails).toMatchObject({
      parents: [main, side],
      body: "Merge branch 'side'",
      fileChanges: [change("M", "f", "f", 3, 0), change("A", "s", "s", 1, 0)]
    });
  });

  it("lists nothing for a merge that keeps its first parent's tree", async () => {
    const repo = tempRepo();
    commitFiles(repo, { f: "f\n" });
    repo.git(["checkout", "-q", "-b", "side"]);
    const side = commitFiles(repo, { t: "t\n" });
    repo.git(["checkout", "-q", "main"]);
    const main = commitFiles(repo, { m: "m\n" });
    repo.git(["merge", "-q", "-s", "ours", "--no-edit", "side"]);

    expect((await repo.details("HEAD")).commitDetails).toMatchObject({
      parents: [main, side],
      fileChanges: []
    });
  });

  it("lists a merge's type change against its first parent, not the other parent's changes", async () => {
    const repo = tempRepo();
    const base = repo.commit("base", { f: "f\n", t: "t\n" });
    const link = { mode: "120000", content: "t" } as const;
    const typeChange = repo.commit("type change", { f: link, t: "t\n" }, [base]);
    const main = repo.commit("add s", { f: "f\n", s: "s\n", t: "t\n" }, [base]);
    const merge = repo.commit("merge", { f: link, s: "s\n", t: "t\n" }, [main, typeChange]);

    expect((await repo.details(merge)).commitDetails).toMatchObject({
      parents: [main, typeChange],
      fileChanges: [change("M", "f", "f", 1, 1)]
    });
  });

  it("lists an octopus merge's changes against its first parent", async () => {
    const repo = tempRepo();
    const base = commitFiles(repo, { f: "f\n" });
    repo.git(["checkout", "-q", "-b", "o1"]);
    const o1 = commitFiles(repo, { o1: "o1\n" });
    repo.git(["checkout", "-q", "-b", "o2", base]);
    const o2 = commitFiles(repo, { o2: "o2\n" });
    repo.git(["checkout", "-q", "main"]);
    const main = commitFiles(repo, { m: "m\n" });
    repo.git(["merge", "-q", "--no-edit", "o1", "o2"]);

    expect((await repo.details("HEAD")).commitDetails).toMatchObject({
      parents: [main, o1, o2],
      body: "Merge branches 'o1' and 'o2'",
      fileChanges: [change("A", "o1", "o1", 1, 0), change("A", "o2", "o2", 1, 0)]
    });
  });
});

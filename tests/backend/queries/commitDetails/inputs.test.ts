import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";

import { tempDir, tempRepo, type Repo } from "@tests/backend/queries/commitDetails/repo";

/** `main` at a second commit that changes b.txt, with b.txt also in the work tree. */
function twoCommits() {
  const repo = tempRepo();
  const root = repo.commit("root", { "b.txt": "one\ntwo\n" });
  const head = repo.commit("second", { "b.txt": "one\nTWO\nthree\n" }, [root]);
  repo.write("b.txt", "one\nTWO\nthree\n");
  return { repo, root, head };
}

/** The details for each of `names`, by name, so a failure names its input. */
async function detailsByName(repo: Repo, names: string[]) {
  return Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, (await repo.details(name)).commitDetails]))
  );
}

/** `value` for each of `names`, by name. */
function each<T>(names: string[], value: () => T) {
  return Object.fromEntries(names.map((name) => [name, value()]));
}

describe("commitDetails input", () => {
  it("describes the commit a name, an abbreviation or an upper-case ID gives", async () => {
    const { repo, root, head } = twoCommits();
    repo.git(["tag", "light"]);

    const names = ["HEAD", "main", "light", head.slice(0, 7), head.toUpperCase()];

    expect(await detailsByName(repo, names)).toMatchObject(
      each(names, () => ({ hash: head, parents: [root], body: "second" }))
    );
    expect((await repo.details("HEAD~1")).commitDetails).toMatchObject({
      hash: root,
      parents: []
    });
  });

  it("gives null for an annotated tag and for objects that are not commits", async () => {
    const { repo } = twoCommits();
    repo.git(["tag", "-a", "-m", "annotated", "ann"]);
    const tree = repo.line(["rev-parse", "HEAD^{tree}"]);
    const blob = repo.line(["rev-parse", "HEAD:b.txt"]);

    const names = ["ann", tree, blob, "0".repeat(40), "deadbeef1234"];

    expect(await detailsByName(repo, names)).toEqual(each(names, () => null));
  });

  it("gives null for ranges, several revisions, a file name and an empty string", async () => {
    const { repo } = twoCommits();

    const names = [
      "HEAD~1..HEAD",
      "HEAD~1...HEAD",
      "^HEAD~1",
      "HEAD^!",
      "HEAD^-",
      "HEAD^@",
      "HEAD HEAD~1",
      "b.txt",
      ""
    ];

    expect(await detailsByName(repo, names)).toEqual(each(names, () => null));
  });

  it("never passes the revision to Git as an option", async () => {
    const { repo } = twoCommits();
    const leak = path.join(tempDir(), "leak.txt");

    expect(await repo.details(`--output=${leak}`)).toEqual({ commitDetails: null });
    expect(fs.existsSync(leak)).toBe(false);
  });

  it("resolves every failure to null without an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    onTestFinished(() => {
      process.off("unhandledRejection", unhandled);
    });
    const { repo, head } = twoCommits();
    const input = { commitHash: head, dateType: "Author Date" } as const;
    const cancelled = new AbortController();
    cancelled.abort();
    const cancelling = new AbortController();

    const results = [
      commitDetails(createGit(repo.dir, "git", cancelled.signal), input),
      commitDetails(createGit(repo.dir, "git", cancelling.signal), input),
      commitDetails(createGit(tempDir(), "git"), input),
      commitDetails(createGit(repo.dir, path.join(tempDir(), "no-git")), input)
    ];
    cancelling.abort();

    expect(await Promise.all(results)).toEqual(
      Array.from({ length: 4 }, () => ({ commitDetails: null }))
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(unhandled).not.toHaveBeenCalled();
  });

  // The wrapper that records Git's command lines is a shell script.
  it.skipIf(process.platform === "win32")(
    "starts one show and two diff-tree processes, and none for a refused call",
    async () => {
      const { repo, head } = twoCommits();
      const log = path.join(tempDir(), "commands.log");
      const wrapper = path.join(tempDir(), "git");
      fs.writeFileSync(wrapper, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec git "$@"\n`, {
        mode: 0o755
      });
      const cancelled = new AbortController();
      cancelled.abort();

      const refused = [
        commitDetails(createGit(repo.dir, wrapper), {
          commitHash: "HEAD~1..HEAD",
          dateType: "Author Date"
        }),
        commitDetails(createGit(repo.dir, wrapper, cancelled.signal), {
          commitHash: head,
          dateType: "Author Date"
        })
      ];
      expect(await Promise.all(refused)).toEqual([
        { commitDetails: null },
        { commitDetails: null }
      ]);
      expect(fs.existsSync(log)).toBe(false);

      const result = await commitDetails(createGit(repo.dir, wrapper), {
        commitHash: head,
        dateType: "Author Date"
      });
      expect(result.commitDetails?.hash).toBe(head);
      const commands = fs
        .readFileSync(log, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => / (show|diff-tree) (\S+)/.exec(line)?.slice(1).join(" "));
      expect(commands.toSorted()).toEqual([
        "diff-tree --name-status",
        "diff-tree --numstat",
        "show --quiet"
      ]);
    }
  );
});

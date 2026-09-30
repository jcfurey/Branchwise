import { describe, expect, it } from "vitest";

import { change, lines, tempRepo, type Snapshot } from "@tests/backend/queries/commitDetails/repo";

const ROOT: Snapshot = {
  "-dash": "x\n",
  "b.txt": "one\ntwo\n",
  "bin.dat": Buffer.from([0, 1, 2]),
  "dir/sub/z.txt": "1\n2\n3\n",
  empty: "",
  link: { mode: "120000", content: "b.txt" },
  nonl: "no newline",
  "run.sh": { mode: "100755", content: "#!/bin/sh\n" }
};

/** Four renames and a copy on top of one base commit, as the rename tests need them. */
function renames() {
  const repo = tempRepo();
  const bin = Buffer.from("\0bin".repeat(50), "latin1");
  const base = repo.commit("base", {
    "ten.txt": lines(1, 10),
    "low.txt": lines(201, 10),
    "blob.bin": bin,
    "src.txt": lines(100, 21)
  });
  const hash = repo.commit(
    "renames",
    {
      "zz-renamed.txt": lines(1, 8) + "NINE\nTEN\n",
      "a-low.txt": "201\n" + lines(2, 9, (n) => `rewritten ${n}`),
      "blob2.bin": bin,
      "src.txt": lines(100, 21),
      "copy.txt": lines(100, 21)
    },
    [base]
  );
  return { repo, hash };
}

describe("commitDetails file changes", () => {
  it("lists every file of a root commit as added, in Git's path order", async () => {
    const repo = tempRepo();
    const hash = repo.commit("root", ROOT);

    expect(await repo.details(hash)).toEqual({
      commitDetails: {
        hash,
        parents: [],
        author: "Ann Author",
        email: "ann@example.com",
        date: 1600000100,
        committer: "Cal Committer",
        body: "root",
        fileChanges: [
          change("A", "-dash", "-dash", 1, 0),
          change("A", "b.txt", "b.txt", 2, 0),
          change("A", "bin.dat", "bin.dat", null, null),
          change("A", "dir/sub/z.txt", "dir/sub/z.txt", 3, 0),
          change("A", "empty", "empty", 0, 0),
          change("A", "link", "link", 1, 0),
          change("A", "nonl", "nonl", 1, 0),
          change("A", "run.sh", "run.sh", 1, 0)
        ]
      }
    });
  });

  it("lists modifications, deletions, a rename and a type change in Git's path order", async () => {
    const repo = tempRepo();
    const root = repo.commit("root", ROOT);
    const hash = repo.commit(
      "second",
      {
        "-dash": { mode: "100755", content: "x\n" },
        "b.txt": "one\nTWO\nthree\n",
        "bin.dat": Buffer.from([0, 9, 9]),
        link: { mode: "120000", content: "dir/sub/z.txt" },
        "moved.txt": "1\n2\n3\n",
        nonl: { mode: "120000", content: "b.txt" }
      },
      [root]
    );

    expect((await repo.details(hash)).commitDetails?.fileChanges).toEqual([
      // A mode change alone.
      change("M", "-dash", "-dash", 0, 0),
      change("M", "b.txt", "b.txt", 2, 1),
      change("M", "bin.dat", "bin.dat", null, null),
      change("D", "empty", "empty", 0, 0),
      change("M", "link", "link", 1, 1),
      change("R", "dir/sub/z.txt", "moved.txt", 0, 0),
      // A file that became a symlink.
      change("M", "nonl", "nonl", 1, 1),
      change("D", "run.sh", "run.sh", 0, 1)
    ]);
  });

  it("reports a deleted binary file without line counts", async () => {
    const repo = tempRepo();
    const root = repo.commit("root", { "bin.dat": Buffer.from([0, 1, 2]), keep: "k\n" });
    const hash = repo.commit("delete", { keep: "k\n" }, [root]);

    expect((await repo.details(hash)).commitDetails?.fileChanges).toEqual([
      change("D", "bin.dat", "bin.dat", null, null)
    ]);
  });

  it("lists type changes as modifications with Git's line counts", async () => {
    const repo = tempRepo();
    const submodule = "1".repeat(40);
    const base = repo.commit("base", { f: "one\ntwo\nthree\n", s: "s\n", t: "t\n" });
    const toLink = repo.commit(
      "to link and submodule",
      {
        f: { mode: "120000", content: "t" },
        s: "s\n",
        t: { mode: "160000", commit: submodule }
      },
      [base]
    );
    const toFile = repo.commit(
      "back to a file",
      { f: "new\ncontent\n", s: "s\n", t: { mode: "160000", commit: submodule } },
      [toLink]
    );

    expect((await repo.details(toLink)).commitDetails?.fileChanges).toEqual([
      change("M", "f", "f", 1, 3),
      change("M", "t", "t", 1, 1)
    ]);
    expect((await repo.details(toFile)).commitDetails?.fileChanges).toEqual([
      change("M", "f", "f", 2, 1)
    ]);
  });

  it("finds renames of at least half similarity but not copies", async () => {
    const { repo, hash } = renames();

    expect((await repo.details(hash)).commitDetails?.fileChanges).toEqual([
      change("A", "a-low.txt", "a-low.txt", 10, 0),
      change("R", "blob.bin", "blob2.bin", null, null),
      change("A", "copy.txt", "copy.txt", 21, 0),
      change("D", "low.txt", "low.txt", 0, 10),
      change("R", "ten.txt", "zz-renamed.txt", 2, 2)
    ]);
  });

  it("keeps exact renames only when the rename limit is exceeded", async () => {
    const { repo, hash } = renames();
    repo.git(["config", "diff.renameLimit", "1"]);

    expect((await repo.details(hash)).commitDetails?.fileChanges).toEqual([
      change("A", "a-low.txt", "a-low.txt", 10, 0),
      change("R", "blob.bin", "blob2.bin", null, null),
      change("A", "copy.txt", "copy.txt", 21, 0),
      change("D", "low.txt", "low.txt", 0, 10),
      change("D", "ten.txt", "ten.txt", 0, 10),
      change("A", "zz-renamed.txt", "zz-renamed.txt", 10, 0)
    ]);
  });

  it("follows the work tree's attributes to decide what is binary", async () => {
    const repo = tempRepo();
    const hash = repo.commit("root", { "a.txt": "a\n", "b.txt": "one\ntwo\n" });
    repo.write(".gitattributes", "b.txt -diff\n");

    expect((await repo.details(hash)).commitDetails?.fileChanges).toEqual([
      change("A", "a.txt", "a.txt", 1, 0),
      change("A", "b.txt", "b.txt", null, null)
    ]);
  });

  it("counts one line for a submodule that is added or moved", async () => {
    const repo = tempRepo();
    const root = repo.commit("root", { f: "x\n" });
    const modules = '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n';
    const added = repo.commit(
      "add",
      { ".gitmodules": modules, f: "x\n", sub: { mode: "160000", commit: "1".repeat(40) } },
      [root]
    );
    const moved = repo.commit(
      "move",
      { ".gitmodules": modules, f: "x\n", sub: { mode: "160000", commit: "2".repeat(40) } },
      [added]
    );

    expect((await repo.details(added)).commitDetails?.fileChanges).toEqual([
      change("A", ".gitmodules", ".gitmodules", 3, 0),
      change("A", "sub", "sub", 1, 0)
    ]);
    expect((await repo.details(moved)).commitDetails?.fileChanges).toEqual([
      change("M", "sub", "sub", 1, 1)
    ]);
  });

  it("lists a file replaced by a directory as a deletion and an addition", async () => {
    const repo = tempRepo();
    const root = repo.commit("root", { p: "p\n" });
    const hash = repo.commit("directory", { "p/inner": "i\n" }, [root]);

    expect((await repo.details(hash)).commitDetails?.fileChanges).toEqual([
      change("D", "p", "p", 0, 1),
      change("A", "p/inner", "p/inner", 1, 0)
    ]);
  });

  // Windows does not allow tabs, quotes or a trailing space in file names.
  it.skipIf(process.platform === "win32")(
    "keeps names that look like Git's own records or need quoting",
    async () => {
      const repo = tempRepo();
      const root = repo.commit("root", { "3\t4\told": lines(1, 5) });
      const hash = repo.commit(
        "names",
        {
          " sp ace \r": lines(1, 6),
          "1\t2\tx": "q\n",
          R100: "q\n",
          '"quoted"': "q\n",
          ["a".repeat(40)]: "q\n",
          "目录/新.txt": "q\n"
        },
        [root]
      );

      expect((await repo.details(hash)).commitDetails?.fileChanges).toEqual([
        change("R", "3\t4\told", " sp ace \r", 1, 0),
        change("A", '"quoted"', '"quoted"', 1, 0),
        change("A", "1\t2\tx", "1\t2\tx", 1, 0),
        change("A", "R100", "R100", 1, 0),
        change("A", "a".repeat(40), "a".repeat(40), 1, 0),
        change("A", "目录/新.txt", "目录/新.txt", 1, 0)
      ]);
    }
  );
});

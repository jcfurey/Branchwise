import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";

import { change, tempDir, tempRepo } from "@tests/backend/queries/commitDetails/repo";

describe("commitDetails header", () => {
  it("reports the author date or the commit date in Unix seconds", async () => {
    const repo = tempRepo();
    const hash = repo.commit("dated", { f: "x\n" });

    expect((await repo.details(hash, "Author Date")).commitDetails?.date).toBe(1600000100);
    expect((await repo.details(hash, "Commit Date")).commitDetails?.date).toBe(1650000100);
  });

  it("reports the recorded author, email and committer without the mailmap", async () => {
    const repo = tempRepo();
    const hash = repo.commit("people", { f: "x\n" });
    repo.write(
      ".mailmap",
      "Mapped Name <mapped@example.com> Ann Author <ann@example.com>\n" +
        "Mapped Committer <other@example.com> Cal Committer <cal@example.com>\n"
    );
    repo.git(["config", "log.mailmap", "true"]);

    expect((await repo.details(hash)).commitDetails).toMatchObject({
      author: "Ann Author",
      email: "ann@example.com",
      committer: "Cal Committer"
    });
  });

  it("lists no parents for a root commit and the parent of the next commit", async () => {
    const repo = tempRepo();
    const root = repo.commit("root", { f: "x\n" });
    const next = repo.commit("next", { f: "y\n" }, [root]);

    expect(await repo.details(root)).toEqual({
      commitDetails: {
        hash: root,
        parents: [],
        author: "Ann Author",
        email: "ann@example.com",
        date: 1600000100,
        committer: "Cal Committer",
        body: "root",
        fileChanges: [change("A", "f", "f", 1, 0)]
      }
    });
    expect((await repo.details(next)).commitDetails).toMatchObject({
      hash: next,
      parents: [root],
      fileChanges: [change("M", "f", "f", 1, 1)]
    });
  });

  it("lists no parents and adds every file for the boundary of a shallow clone", async () => {
    const repo = tempRepo();
    const root = repo.commit("root", { f: "x\n" });
    const next = repo.commit("next", { f: "y\n", g: "g\n" }, [root]);
    const clone = path.join(tempDir(), "clone");
    repo.git(["clone", "-q", "--depth", "1", pathToFileURL(repo.dir).href, clone]);

    const result = await commitDetails(createGit(clone, "git"), {
      commitHash: next,
      dateType: "Author Date"
    });

    expect(result.commitDetails).toMatchObject({
      hash: next,
      parents: [],
      fileChanges: [change("A", "f", "f", 1, 0), change("A", "g", "g", 1, 0)]
    });
  });

  it.each([
    ["subject only", "subject only"],
    [
      "Second commit\n\nFirst paragraph.\n\nSecond paragraph,\ntwo lines.\n",
      "Second commit\n\nFirst paragraph.\n\nSecond paragraph,\ntwo lines."
    ],
    ["subj\r\n\r\nbody crlf\r\nline2\r\n", "subj\n\nbody crlf\nline2"],
    ["subj\rbody-cr\r", "subj\nbody-cr"],
    ["\n\nleading blank lines\n", "\n\nleading blank lines"],
    ["trailing blanks\n\n\n\n", "trailing blanks"],
    ["trailing ws line\n   \n\t\n", "trailing ws line\n   \n\t"],
    ["", ""],
    ["tabs\tin\tmsg\n\n  indented body\n", "tabs\tin\tmsg\n\n  indented body"],
    ["unicode: 中文 café ✓\n", "unicode: 中文 café ✓"]
  ])("normalises the stored message %j", async (message, body) => {
    const repo = tempRepo();
    const hash = repo.rawCommit(
      { f: "x\n" },
      [
        "author Ann Author <ann@example.com> 1600000100 +0200",
        "committer Cal Committer <cal@example.com> 1650000100 -0500"
      ],
      message
    );

    expect((await repo.details(hash)).commitDetails?.body).toBe(body);
  });

  it("keeps the paragraphs of a message given in parts", async () => {
    const repo = tempRepo();
    repo.git([
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Second commit",
      "-m",
      "First paragraph.",
      "-m",
      "Second paragraph,\ntwo lines."
    ]);

    expect((await repo.details("HEAD")).commitDetails?.body).toBe(
      "Second commit\n\nFirst paragraph.\n\nSecond paragraph,\ntwo lines."
    );
  });

  it("reads names and message in UTF-8 whatever the log output encoding", async () => {
    const repo = tempRepo();
    const hash = repo.commit("café", { f: "x\n" }, [], {
      GIT_AUTHOR_NAME: "Zoë",
      GIT_COMMITTER_NAME: "Zoë Committer"
    });
    repo.git(["config", "i18n.logOutputEncoding", "ISO-8859-1"]);
    // The setting really changes Git's output: Latin-1 bytes are not UTF-8.
    expect(repo.line(["-c", "log.showSignature=false", "show", "-s", "--format=%an", hash])).toBe(
      "Zo�"
    );

    expect((await repo.details(hash)).commitDetails).toMatchObject({
      author: "Zoë",
      committer: "Zoë Committer",
      body: "café"
    });
  });

  it("re-encodes a commit stored in another encoding", async () => {
    const repo = tempRepo();
    const hash = repo.rawCommit(
      { f: "x\n" },
      [
        "author José <j@example.com> 1600000100 +0200",
        "committer José <j@example.com> 1650000100 -0500",
        "encoding ISO-8859-1"
      ],
      "café latin1\n",
      "latin1"
    );

    expect((await repo.details(hash)).commitDetails).toMatchObject({
      author: "José",
      email: "j@example.com",
      committer: "José",
      body: "café latin1"
    });
  });

  it("describes commits of a SHA-256 repository", async () => {
    const repo = tempRepo("--object-format=sha256");
    const root = repo.commit("root", { f: "x\n" });
    const next = repo.commit("move", { g: "x\ny\n" }, [root]);

    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect((await repo.details(root)).commitDetails).toMatchObject({
      hash: root,
      parents: [],
      fileChanges: [change("A", "f", "f", 1, 0)]
    });
    expect((await repo.details(next)).commitDetails).toMatchObject({
      hash: next,
      parents: [root],
      fileChanges: [change("R", "f", "g", 1, 0)]
    });
  });
});

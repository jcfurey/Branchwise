import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { loadHistory } from "@/backend/queries/history";
import {
  LINE_HISTORY_LIMIT,
  lineFileState,
  lineLogRecords,
  lineOrigin
} from "@/backend/queries/lineHistory";
import type { HistoryFilter } from "@/backend/types";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

const repo = freshRepo();
const client = () => createGit(repo(), "git");

/** Write `files` and commit them as `message`; the new commit's ID. */
function commit(message: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo(), name)), { recursive: true });
    fs.writeFileSync(path.join(repo(), name), content);
  }
  git(["add", "-A"], repo());
  git(["commit", "-q", "-m", message], repo());
  return gitOutput(["rev-parse", "HEAD"], repo());
}

/** Five numbered lines, with `changes` in place of some of them. */
const lines = (changes: Record<number, string> = {}) =>
  [1, 2, 3, 4, 5].map((line) => (changes[line] ?? `line ${line}`) + "\n").join("");

/** A line history's filter, as the page sends it. */
const lineFilter = (file: string, span: string, revision = ""): HistoryFilter => ({
  text: "",
  author: "",
  since: "",
  until: "",
  path: file,
  revision,
  follow: false,
  lines: span
});

const messagesOf = async (filter: HistoryFilter, offset = 0) =>
  (await loadHistory(client(), filter, offset)).entries.map((entry) => entry.message);

/**
 * Everything a read could change: the index file, the work tree and index, and the refs. The
 * status itself must not refresh the index it reports on.
 */
const diskState = () => [
  fs.readFileSync(path.join(repo(), ".git", "index")).toString("base64"),
  fs.statSync(path.join(repo(), ".git", "index")).mtimeMs,
  gitOutput(["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"], repo()),
  gitOutput(["for-each-ref", "--format=%(refname) %(objectname)"], repo())
];

describe("the commit that last changed a line", () => {
  it("is the older commit that changed it, not the latest commit to the file", async () => {
    commit("first", { "a.txt": lines() });
    const second = commit("second", { "a.txt": lines({ 2: "changed two" }) });
    commit("third", { "a.txt": lines({ 2: "changed two", 4: "changed four" }) });
    expect(await lineOrigin(client(), "a.txt", 2)).toEqual({ kind: "commit", hash: second });
  });

  it("counts lines in unsaved text, where an inserted line moves the rest down", async () => {
    commit("first", { "a.txt": lines() });
    const second = commit("second", { "a.txt": lines({ 2: "changed two" }) });
    const unsaved = Buffer.from("inserted\n" + lines({ 2: "changed two" }));
    // Line 3 of the editor's text is line 2 of the file on disk.
    expect(await lineOrigin(client(), "a.txt", 3, { contents: unsaved })).toEqual({
      kind: "commit",
      hash: second
    });
    expect(await lineOrigin(client(), "a.txt", 1, { contents: unsaved })).toEqual({
      kind: "uncommitted"
    });
    // Without the text, line 3 is the file's own third line.
    expect(await lineOrigin(client(), "a.txt", 3)).not.toEqual({ kind: "commit", hash: second });
  });

  it("is none for a line changed on disk but not committed", async () => {
    commit("first", { "a.txt": lines() });
    fs.writeFileSync(path.join(repo(), "a.txt"), lines({ 3: "edited" }));
    expect(await lineOrigin(client(), "a.txt", 3)).toEqual({ kind: "uncommitted" });
    expect((await lineOrigin(client(), "a.txt", 2)).kind).toBe("commit");
  });

  it("is none for every line of a new file that is only staged", async () => {
    fs.writeFileSync(path.join(repo(), "new.txt"), "fresh\n");
    git(["add", "new.txt"], repo());
    expect(await lineOrigin(client(), "new.txt", 1)).toEqual({ kind: "uncommitted" });
  });

  it("tells an untracked file apart from an uncommitted line", async () => {
    fs.writeFileSync(path.join(repo(), "loose.txt"), "loose\n");
    expect(await lineOrigin(client(), "loose.txt", 1)).toEqual({ kind: "untracked" });
    expect(await lineOrigin(client(), "missing.txt", 1)).toEqual({ kind: "untracked" });
  });

  it("counts lines in the file at a revision for a file shown as it was then", async () => {
    const first = commit("first", { "a.txt": lines() });
    commit("second", { "a.txt": "new top\n" + lines() });
    expect(await lineOrigin(client(), "a.txt", 1, { revision: first })).toEqual({
      kind: "commit",
      hash: first
    });
    await expect(lineOrigin(client(), "f", 1, { revision: first })).resolves.toMatchObject({
      kind: "commit"
    });
    await expect(lineOrigin(client(), "nowhere.txt", 1, { revision: first })).rejects.toThrow(
      "This revision does not contain that file."
    );
  });

  it("refuses a line number that is not a positive whole number", async () => {
    commit("first", { "a.txt": lines() });
    await Promise.all(
      [0, -1, 1.5, Number.NaN].map((line) =>
        expect(lineOrigin(client(), "a.txt", line)).rejects.toThrow("Choose a line of the file.")
      )
    );
    await expect(lineOrigin(client(), "../a.txt", 1)).rejects.toThrow();
  });
});

describe("the history of a range of lines", () => {
  it("lists only the commits that changed those lines, newest first", async () => {
    commit("first", { "a.txt": lines() });
    commit("second", { "a.txt": lines({ 2: "two again" }) });
    commit("elsewhere", { "a.txt": lines({ 2: "two again", 5: "five again" }) });
    commit("third", { "a.txt": lines({ 2: "two again", 3: "three again", 5: "five again" }) });
    expect(await messagesOf(lineFilter("a.txt", "2,3"))).toEqual(["third", "second", "first"]);
    expect(await messagesOf(lineFilter("a.txt", "5,5"))).toEqual(["elsewhere", "first"]);
  });

  it("follows the lines back across a rename", async () => {
    commit("first", { "old.txt": lines() });
    commit("before rename", { "old.txt": lines({ 2: "renamed soon" }) });
    git(["mv", "old.txt", "new.txt"], repo());
    git(["commit", "-q", "-m", "rename"], repo());
    commit("after rename", { "new.txt": lines({ 2: "renamed" }) });
    expect(await messagesOf(lineFilter("new.txt", "2,2"))).toEqual([
      "after rename",
      "before rename",
      "first"
    ]);
  });

  it("follows the lines into the branch a merge brought them from", async () => {
    commit("base", { "a.txt": lines() });
    git(["checkout", "-q", "-b", "side"], repo());
    commit("side changes two", { "a.txt": lines({ 2: "side two" }) });
    git(["checkout", "-q", "main"], repo());
    commit("main changes five", { "a.txt": lines({ 5: "main five" }) });
    git(["merge", "-q", "--no-edit", "side"], repo());
    const two = await messagesOf(lineFilter("a.txt", "2,2"));
    expect(two).toContain("side changes two");
    expect(two).toContain("base");
    expect(two).not.toContain("main changes five");
    const five = await messagesOf(lineFilter("a.txt", "5,5"));
    expect(five).toContain("main changes five");
    expect(five).not.toContain("side changes two");
  });

  it("starts at the revision of a file shown as it was then", async () => {
    commit("first", { "a.txt": lines() });
    const second = commit("second", { "a.txt": lines({ 1: "one" }) });
    commit("third", { "a.txt": lines({ 1: "uno" }) });
    expect(await messagesOf(lineFilter("a.txt", "1,1", second))).toEqual(["second", "first"]);
  });

  it(`lists at most ${LINE_HISTORY_LIMIT} commits, a page at a time`, async () => {
    const file = path.join(repo(), "a.txt");
    for (let index = 0; index < LINE_HISTORY_LIMIT + 5; index++) {
      fs.writeFileSync(file, `version ${index}\n`);
      git(["add", "a.txt"], repo());
      git(["commit", "-q", "-m", `version ${index}`], repo());
    }
    const filter = lineFilter("a.txt", "1,1");
    const first = await loadHistory(client(), filter, 0);
    const second = await loadHistory(client(), filter, 100);
    const third = await loadHistory(client(), filter, 200);
    expect([first.entries.length, first.more]).toEqual([100, true]);
    expect([second.entries.length, second.more]).toEqual([100, false]);
    expect(third.entries).toEqual([]);
    expect(first.entries[0]!.message).toBe(`version ${LINE_HISTORY_LIMIT + 4}`);
    expect(second.entries.at(-1)!.message).toBe("version 5");
  }, 60_000);

  it("narrows by message and author, and is never narrowed to a branch's tip", async () => {
    commit("first", { "a.txt": lines() });
    commit("fix two", { "a.txt": lines({ 2: "fixed" }) });
    git(["branch", "other"], repo());
    const filter = { ...lineFilter("a.txt", "2,2"), text: "fix", branch: "other" };
    expect(await messagesOf(filter)).toEqual(["fix two"]);
    expect(await messagesOf({ ...lineFilter("a.txt", "2,2"), author: "nobody" })).toEqual([]);
  });

  it("refuses lines that are not a range of a named file", async () => {
    commit("first", { "a.txt": lines() });
    await Promise.all(
      [
        lineFilter("a.txt", "3,2"),
        lineFilter("a.txt", "0,2"),
        lineFilter("a.txt", "2"),
        lineFilter("a.txt", "-L1,2"),
        lineFilter("", "1,2")
      ].map((filter) =>
        expect(loadHistory(client(), filter, 0)).rejects.toThrow(
          "Choose a range of lines in a file."
        )
      )
    );
    await expect(loadHistory(client(), lineFilter("../a.txt", "1,1"), 0)).rejects.toThrow();
  });

  it("shows how one listed commit changed the lines, counted where history moved them", async () => {
    commit("first", { "a.txt": lines() });
    const second = commit("second", { "a.txt": lines({ 3: "three changed" }) });
    commit("third", { "a.txt": "top\n" + lines({ 3: "three changed" }) });
    // Line 4 at HEAD was line 3 when the second commit changed it.
    const effect = await runRepositoryAction(client(), {
      kind: "viewLineChanges",
      hash: second,
      path: "a.txt",
      lines: "4,4",
      revision: ""
    });
    expect(effect).toMatchObject({ kind: "document" });
    const text = (effect as { text: string }).text;
    expect(text).toContain(`commit ${second}`);
    expect(text).toContain("-line 3\n+three changed\n");
    expect(text).not.toContain("+top");
    await expect(
      runRepositoryAction(client(), {
        kind: "viewLineChanges",
        hash: second,
        path: "a.txt",
        lines: "1,1",
        revision: ""
      })
    ).rejects.toThrow("This commit did not change those lines.");
  });
});

describe("whether a file has a line history", () => {
  it("names untracked, uncommitted, changed and committed files", async () => {
    const first = commit("first", { "a.txt": lines() });
    fs.writeFileSync(path.join(repo(), "loose.txt"), "loose\n");
    fs.writeFileSync(path.join(repo(), "staged.txt"), "staged\n");
    git(["add", "staged.txt"], repo());
    expect(await lineFileState(client(), "loose.txt")).toBe("untracked");
    expect(await lineFileState(client(), "staged.txt")).toBe("uncommitted");
    expect(await lineFileState(client(), "a.txt")).toBe("committed");
    fs.writeFileSync(path.join(repo(), "a.txt"), "top\n" + lines());
    expect(await lineFileState(client(), "a.txt")).toBe("changed");
    expect(await lineFileState(client(), "a.txt", first)).toBe("committed");
    expect(await lineFileState(client(), "staged.txt", first)).toBe("uncommitted");
  });
});

describe("the records of a line log", () => {
  it("keeps only the commit records when Git adds each commit's patch", () => {
    const hash = "a".repeat(40);
    const record = ["NGG-HISTORY", hash, "", "T", "t@t.com", "1", "subject"];
    const output = [
      ...record,
      "\n\ndiff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-NGG-HISTORY\n+x\n",
      ...record.map((field, index) => (index === 0 ? "\n" + field : field)),
      ""
    ].join("\0");
    expect(lineLogRecords(output, "NGG-HISTORY", 6)).toBe([...record, ...record].join("\0"));
  });
});

describe("reading lines", () => {
  it("changes nothing on disk, among the refs or in the index", async () => {
    commit("first", { "a.txt": lines() });
    const second = commit("second", { "a.txt": lines({ 2: "two" }) });
    fs.writeFileSync(path.join(repo(), "a.txt"), lines({ 2: "two", 4: "edited" }));
    fs.writeFileSync(path.join(repo(), "loose.txt"), "loose\n");
    // An index whose stat data is out of date is one a careless read would refresh.
    fs.utimesSync(path.join(repo(), "a.txt"), new Date(), new Date(Date.now() + 5000));
    const before = diskState();

    await lineOrigin(client(), "a.txt", 2);
    await lineOrigin(client(), "a.txt", 2, { contents: Buffer.from("x\n" + lines()) });
    await lineOrigin(client(), "loose.txt", 1);
    await lineFileState(client(), "a.txt");
    await loadHistory(client(), lineFilter("a.txt", "1,5"), 0);
    await runRepositoryAction(client(), {
      kind: "viewLineChanges",
      hash: second,
      path: "a.txt",
      lines: "2,2",
      revision: ""
    });

    expect(diskState()).toEqual(before);
  });

  it("reads Git's output whatever the repository's own configuration says", async () => {
    const first = commit("first", { "a.txt": lines() });
    const second = commit("second", { "a.txt": lines({ 2: "two" }) });
    for (const [key, value] of [
      ["blame.showEmail", "true"],
      ["blame.date", "relative"],
      ["blame.blankBoundary", "true"],
      ["blame.showRoot", "true"],
      ["color.blame.highlightRecent", "red,12 month ago,blue"],
      ["color.ui", "always"],
      ["diff.noprefix", "true"],
      ["diff.mnemonicPrefix", "true"],
      ["log.abbrevCommit", "true"],
      ["log.decorate", "full"],
      ["log.follow", "true"],
      ["log.showSignature", "true"],
      ["format.pretty", "oneline"],
      ["core.quotePath", "true"]
    ] as const) {
      git(["config", key, value], repo());
    }
    expect(await lineOrigin(client(), "a.txt", 2)).toEqual({ kind: "commit", hash: second });
    expect(await lineOrigin(client(), "a.txt", 1)).toEqual({ kind: "commit", hash: first });
    expect(await messagesOf(lineFilter("a.txt", "2,2"))).toEqual(["second", "first"]);
    const effect = await runRepositoryAction(client(), {
      kind: "viewLineChanges",
      hash: second,
      path: "a.txt",
      lines: "2,2",
      revision: ""
    });
    expect((effect as { text: string }).text).toContain("-line 2\n+two\n");
  });
});

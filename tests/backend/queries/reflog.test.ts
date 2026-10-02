import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadReflog, reflogAction } from "@/backend/queries/history";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

describe("the operation a reflog message records", () => {
  it.each([
    ["commit: add parser", "commit", ""],
    ["commit (amend): add parser", "commit", "amend"],
    ["commit (initial): init", "commit", "initial"],
    ["checkout: moving from main to topic", "checkout", ""],
    ["rebase (pick): step", "rebase", "pick"],
    ["rebase -i (finish): returning to refs/heads/topic", "rebase", "finish"],
    ["pull --rebase (start): checkout origin/main", "pull", "start"],
    ["merge topic: Fast-forward", "merge", ""],
    ["reset: moving to HEAD~1", "reset", ""],
    ["cherry-pick: fix", "cherry-pick", ""],
    ["branch: Created from HEAD", "branch", ""],
    ["update by push", "other", ""],
    ["", "other", ""]
  ])("%j is %s (%s)", (message, action, detail) => {
    expect(reflogAction(message)).toStrictEqual({ action, detail });
  });
});

/**
 * Only read. `main` gets `init`, then `second`; `topic` is created and checked out, gets
 * `on topic` and is amended to `on topic, amended`; `scratch` gets `scratch work` and is deleted,
 * leaving that commit only in HEAD's reflog; `main` is checked out again.
 */
describe("a repository's reflog", () => {
  let repo = "";
  const ids: Record<string, string> = {};

  function commit(message: string, ...extra: string[]) {
    fs.writeFileSync(path.join(repo, "f"), message + "\n");
    git(["add", "f"], repo);
    git(["commit", "-q", ...extra, "-m", message], repo);
    ids[message] = gitOutput(["rev-parse", "HEAD"], repo);
  }

  beforeAll(() => {
    repo = makeRepo();
    commit("second");
    git(["checkout", "-q", "-b", "topic"], repo);
    commit("on topic");
    commit("on topic, amended", "--amend");
    git(["checkout", "-q", "-b", "scratch"], repo);
    commit("scratch work");
    git(["checkout", "-q", "main"], repo);
    git(["branch", "-q", "-D", "scratch"], repo);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("walks every ref by default, newest first, naming the ref and operation of each entry", async () => {
    const page = await loadReflog(createGit(repo, "git"), { offset: 0 });
    expect(page.refs).toStrictEqual(["HEAD", "refs/heads/main", "refs/heads/topic"]);
    // `topic`'s reflog starts with `branch: Created from HEAD`.
    expect(page.actions).toStrictEqual(["branch", "checkout", "commit"]);
    const head = page.entries.filter((entry) => entry.ref === "HEAD");
    expect(head.map((entry) => [entry.action, entry.detail, entry.subject])).toStrictEqual([
      ["checkout", "", "second"],
      ["commit", "", "scratch work"],
      ["checkout", "", "on topic, amended"],
      ["commit", "amend", "on topic, amended"],
      ["commit", "", "on topic"],
      ["checkout", "", "second"],
      ["commit", "", "second"],
      ["commit", "initial", "init"]
    ]);
    expect(page.entries.some((entry) => entry.ref === "refs/heads/topic")).toBe(true);
    expect(page.more).toBe(false);
  });

  it("shows one ref's reflog", async () => {
    const page = await loadReflog(createGit(repo, "git"), {
      offset: 0,
      ref: "refs/heads/topic"
    });
    expect(new Set(page.entries.map((entry) => entry.ref))).toStrictEqual(
      new Set(["refs/heads/topic"])
    );
    expect(page.entries.map((entry) => entry.subject)).toStrictEqual([
      "on topic, amended",
      "on topic",
      "second"
    ]);
  });

  it("refuses a ref without a reflog of its own", async () => {
    await expect(loadReflog(createGit(repo, "git"), { offset: 0, ref: "--all" })).rejects.toThrow(
      "--all has no reflog. Choose HEAD or a local branch."
    );
  });

  it("narrows to one operation and to text in the message, the subject or the ID", async () => {
    const client = createGit(repo, "git");
    const checkouts = await loadReflog(client, { offset: 0, ref: "HEAD", action: "checkout" });
    expect(checkouts.entries.map((entry) => entry.message)).toStrictEqual([
      "checkout: moving from scratch to main",
      "checkout: moving from topic to scratch",
      "checkout: moving from main to topic"
    ]);
    // The list of operations still offers every one, so the filter can be changed back.
    expect(checkouts.actions).toStrictEqual(["checkout", "commit"]);
    const amended = await loadReflog(client, { offset: 0, ref: "HEAD", text: "AMENDED" });
    expect(amended.entries.every((entry) => entry.subject === "on topic, amended")).toBe(true);
    const byId = await loadReflog(client, {
      offset: 0,
      ref: "HEAD",
      text: ids["scratch work"]!.slice(0, 9)
    });
    expect(byId.entries.map((entry) => entry.subject)).toStrictEqual(["scratch work"]);
  });

  it("marks commits that only the reflog still reaches", async () => {
    const page = await loadReflog(createGit(repo, "git"), { offset: 0, ref: "HEAD" });
    const lost = new Set(page.entries.filter((entry) => entry.lost).map((entry) => entry.subject));
    // The amended-away commit and the deleted branch's commit.
    expect(lost).toStrictEqual(new Set(["on topic", "scratch work"]));
  });
});

describe("a long reflog", () => {
  let repo = "";

  beforeAll(() => {
    repo = makeRepo();
    for (let index = 0; index < 120; index++) {
      git(["commit", "-q", "--allow-empty", "-m", `c${index}`], repo);
    }
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("pages a hundred entries at a time", async () => {
    const client = createGit(repo, "git");
    const first = await loadReflog(client, { offset: 0, ref: "HEAD" });
    const second = await loadReflog(client, { offset: 100, ref: "HEAD" });
    expect([first.entries.length, first.more]).toStrictEqual([100, true]);
    expect([second.entries.length, second.more]).toStrictEqual([21, false]);
    expect(first.entries[0]?.subject).toBe("c119");
    expect(second.entries.at(-1)?.subject).toBe("init");
  });
});

describe("a repository without commits", () => {
  let repo = "";

  beforeAll(() => {
    repo = makeRepo();
    git(["checkout", "-q", "--orphan", "empty"], repo);
    git(["branch", "-q", "-D", "main"], repo);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("has an empty reflog", async () => {
    const page = await loadReflog(createGit(repo, "git"), { offset: 0 });
    expect(page.entries).toStrictEqual([]);
    expect(page.more).toBe(false);
  });
});

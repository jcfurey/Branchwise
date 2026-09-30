import * as cp from "node:child_process";
import * as fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits, parseLog } from "@/backend/queries/loadCommits";

import { gitOutput, makeRepo } from "@tests/backend/helpers";

const input = {
  branchName: "",
  maxCommits: 300,
  showRemoteBranches: true,
  hard: true,
  dateType: "Author Date" as const,
  showUncommittedChanges: false
};
const hash = "a".repeat(40);
const INCOMPLETE = "Git returned an incomplete graph record.";

let repo: string | undefined;
afterEach(() => {
  // Some tests parse text and create no repository; in a shuffled run they can come first.
  if (repo !== undefined) {
    fs.rmSync(repo, { recursive: true, force: true });
    repo = undefined;
  }
});

function commit(message: string, author = "T") {
  cp.execFileSync("git", ["commit", "--allow-empty", "-m", message], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_NAME: author }
  });
}

describe("graph log records", () => {
  it("keeps every commit when a subject or author contains a carriage return", async () => {
    repo = makeRepo();
    commit("carriage\rreturn subject");
    commit("line feed\r\nsubject");
    commit("plain", "Carriage\rReturn Author");
    commit("last");
    const result = await loadCommits(createGit(repo, "git"), { ...input, maxCommits: 4 });
    expect(result.commits.map(({ message, author }) => [message, author])).toEqual([
      ["last", "T"],
      ["plain", "Carriage\rReturn Author"],
      ["line feed subject", "T"],
      ["carriage\rreturn subject", "T"]
    ]);
    expect(result.moreCommitsAvailable).toBe(true);
    expect(result.commits.map((entry) => entry.hash)).toEqual(
      gitOutput(["rev-list", "--max-count=4", "HEAD"], repo).split("\n")
    );
  });

  it("gives a root commit no parents", async () => {
    repo = makeRepo();
    const [root] = (await loadCommits(createGit(repo, "git"), input)).commits;
    expect(root?.parentHashes).toEqual([]);
  });

  it("parses whole records and refuses partial ones", () => {
    const record = [hash, `${"b".repeat(40)} ${"c".repeat(40)}`, "A", "a@x", "10", "s"];
    expect(parseLog("")).toEqual([]);
    expect(parseLog(record.join("\0") + "\0")).toEqual([
      {
        hash,
        parentHashes: ["b".repeat(40), "c".repeat(40)],
        author: "A",
        email: "a@x",
        date: 10,
        message: "s"
      }
    ]);
    for (const output of [
      record.join("\0"),
      record.slice(0, 5).join("\0") + "\0",
      [...record, ...record.slice(0, 3)].join("\0") + "\0",
      ["not a hash", ...record.slice(1)].join("\0") + "\0"
    ]) {
      expect(() => parseLog(output), JSON.stringify(output)).toThrow(INCOMPLETE);
    }
    // A whole record keeps its commit even when Git gives no usable timestamp.
    expect(parseLog([hash, "", "A", "a@x", "yesterday", "s"].join("\0") + "\0")).toEqual([
      { hash, parentHashes: [], author: "A", email: "a@x", date: Number.NaN, message: "s" }
    ]);
  });

  it("reports a malformed log instead of showing a truncated graph", async () => {
    repo = makeRepo();
    const client = createGit(repo, "git");
    const raw = client.raw.bind(client);
    vi.spyOn(client, "raw").mockImplementation((...args) =>
      Array.isArray(args[0]) && args[0][0] === "log"
        ? (Promise.resolve(`${hash}\0\0A\0`) as ReturnType<typeof client.raw>)
        : raw(...args)
    );
    await expect(loadCommits(client, input)).rejects.toThrow(INCOMPLETE);
  });
});

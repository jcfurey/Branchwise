import * as cp from "node:child_process";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits, parseLog } from "@/backend/queries/loadCommits";

import {
  commit,
  defaults,
  git,
  identify,
  repoI,
  useTempDirs
} from "@tests/backend/queries/loadCommits/fixtures";

const tempDir = useTempDirs();

const INCOMPLETE = "Git returned an incomplete graph record.";
const h = "a".repeat(40);
const g = "b".repeat(64);

/** One log record: hash, parents, author, email, timestamp and subject, each ending in NUL. */
const record = (fields: Partial<Record<"hash" | "parents" | "date", string>> = {}) =>
  [fields.hash ?? h, fields.parents ?? "", "A", "a@x", fields.date ?? "10", "s"].join("\0") + "\0";

describe("parseLog", () => {
  it("reads records with SHA-1 and SHA-256 IDs", () => {
    expect(
      parseLog(
        record({ parents: `${"c".repeat(40)} ${g}` }) + record({ hash: g, parents: h, date: "0" })
      )
    ).toEqual([
      {
        hash: h,
        parentHashes: ["c".repeat(40), g],
        author: "A",
        email: "a@x",
        date: 10,
        message: "s"
      },
      { hash: g, parentHashes: [h], author: "A", email: "a@x", date: 0, message: "s" }
    ]);
  });

  it.each([
    ["a lone NUL", "\0"],
    ["a record followed by a newline", record() + "\n"],
    ["a missing final NUL", record().slice(0, -1)],
    ["a partial second record", record() + [h, "", "A"].join("\0") + "\0"]
  ])("refuses %s", (_, output) => {
    expect(() => parseLog(output)).toThrow(INCOMPLETE);
  });

  it.each([
    "",
    "not a hash",
    "A".repeat(40),
    "a".repeat(39),
    "a".repeat(41),
    "a".repeat(63),
    "a".repeat(65),
    `${h} `
  ])("refuses the commit ID %j", (hash) => {
    expect(() => parseLog(record({ hash }))).toThrow(INCOMPLETE);
  });

  it.each([
    "xyz  q",
    `${h} `,
    ` ${h}`,
    `${h}  ${h}`,
    "a".repeat(41),
    "C".repeat(40),
    `${h} ${"a".repeat(63)}`
  ])("refuses the parent IDs %j", (parents) => {
    expect(() => parseLog(record({ parents }))).toThrow(INCOMPLETE);
  });

  it("refuses the whole output when any record is malformed", () => {
    expect(() => parseLog(record() + record({ hash: "x".repeat(40) }) + record())).toThrow(
      INCOMPLETE
    );
  });

  it.each([
    ["007", 7],
    ["0", 0],
    ["1700000000", 1_700_000_000],
    ["99999999999999999999", 1e20]
  ])("reads the timestamp %j as %d", (date, expected) => {
    expect(parseLog(record({ date }))[0]?.date).toBe(expected);
  });

  it.each(["", "-5", "1.5", " 10", "yesterday", "１２"])(
    "keeps a commit whose timestamp %j is not digits, with an unknown date",
    (date) => {
      const [entry] = parseLog(record({ date }));
      expect(entry?.hash).toBe(h);
      expect(entry?.date).toBeNaN();
    }
  );

  it("keeps names, emails and subjects as Git gives them", () => {
    const fields = [h, "", 'Zoë\t"Z"\r', "", "5", "a\nb\r\nc <b>&amp; 🎉"];
    expect(parseLog(fields.join("\0") + "\0")).toEqual([
      {
        hash: h,
        parentHashes: [],
        author: 'Zoë\t"Z"\r',
        email: "",
        date: 5,
        message: "a\nb\r\nc <b>&amp; 🎉"
      }
    ]);
  });
});

describe("commit content", () => {
  it("keeps an empty subject, Unicode, quotes and an empty email", async () => {
    const { repo, I } = repoI(tempDir());
    git(repo, ["commit", "-q", "--allow-empty", "--allow-empty-message", "-m", ""], {
      author: 1_700_000_100
    });
    const subject = 'tab\there émoji 🎉 "quotes" <b>&amp;';
    git(repo, ["commit", "-q", "--allow-empty", "--author", 'Zoë "Z" Ünïcode <>', "-m", subject], {
      author: 1_700_000_200
    });
    const result = await loadCommits(createGit(repo, "git"), defaults);
    expect(
      result.commits.map(({ author, email, message }) => ({ author, email, message }))
    ).toEqual([
      { author: 'Zoë "Z" Ünïcode', email: "", message: subject },
      { author: "T", email: "t@t.com", message: "" },
      { author: "T", email: "t@t.com", message: "init" }
    ]);
    expect(result.commits[2]?.hash).toBe(I);
  });

  it("reads SHA-256 repositories", async () => {
    const repo = tempDir();
    git(repo, ["init", "-q", "--object-format=sha256", "-b", "main"]);
    identify(repo);
    const parent = commit(repo, "first", 1_700_000_000);
    const child = commit(repo, "second", 1_700_000_100);
    const result = await loadCommits(createGit(repo, "git"), defaults);
    expect(result.commits.map((entry) => [entry.hash, entry.parentHashes])).toEqual([
      [child, [parent]],
      [parent, []]
    ]);
    expect(child).toHaveLength(64);
    expect(result.head).toBe(child);
  });

  it("gives the boundary commits of a shallow clone no parents", async () => {
    const { repo: source } = repoI(tempDir());
    for (let index = 1; index < 5; index++) {
      commit(source, `commit ${index}`, 1_700_000_000 + index * 100);
    }
    const clone = tempDir();
    git(clone, ["clone", "-q", "--depth", "2", pathToFileURL(source).href, "."]);
    const result = await loadCommits(createGit(clone, "git"), defaults);
    expect(result.commits.map((entry) => entry.message)).toEqual(["commit 4", "commit 3"]);
    expect(result.commits[1]?.parentHashes).toEqual([]);
    expect(result.moreCommitsAvailable).toBe(false);
  });

  it.each([
    ["Author Date" as const, Number.NaN],
    ["Commit Date" as const, 1_700_000_050]
  ])("keeps a commit with a malformed author line, with %s %d", async (dateType, date) => {
    const { repo, I } = repoI(tempDir());
    const object = [
      `tree ${git(repo, ["rev-parse", "HEAD^{tree}"])}`,
      `parent ${I}`,
      "author NoEmail 1700000000 +0000",
      "committer T <t@t.com> 1700000050 +0000",
      "",
      "broken author",
      ""
    ].join("\n");
    const broken = cp
      .execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"], {
        cwd: repo,
        input: object
      })
      .toString()
      .trim();
    git(repo, ["update-ref", "refs/heads/broken", broken]);
    const result = await loadCommits(createGit(repo, "git"), { ...defaults, dateType });
    expect(result.commits).toEqual([
      {
        hash: broken,
        parentHashes: [I],
        author: "",
        email: "",
        date,
        message: "broken author",
        refs: [{ hash: broken, name: "broken", type: "head" }]
      },
      expect.objectContaining({ hash: I, message: "init" })
    ]);
  });
});

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";
import { loadBatchPlan, loadComparison, loadHistory, loadReflog } from "@/backend/queries/history";
import { loadCommits } from "@/backend/queries/loadCommits";
import { repositoryQuery } from "@/backend/queries/repository";
import { loadSyncPlan } from "@/backend/queries/workflows";
import type { HistoryEntry } from "@/backend/types";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

/**
 * Git settings that the environment can inject into every Git process. One of them could name an
 * allowed-signers file, and then Git would verify the signatures below with `ssh-keygen`.
 */
const INJECTED_CONFIG = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/;

const saved = new Map<string, string>();
beforeAll(() => {
  for (const [name, value] of Object.entries(process.env)) {
    if (INJECTED_CONFIG.test(name) && value !== undefined) {
      saved.set(name, value);
      delete process.env[name];
    }
  }
});
afterAll(() => {
  for (const [name, value] of saved) {
    process.env[name] = value;
  }
});

const AT = "1700000000 +0000";

/**
 * Commits `file`, holding the subject, on HEAD with a signature header in the commit object. The
 * signature is an SSH armour that Git cannot check, so Git reports it in any log that shows
 * signatures; no signing program runs.
 */
function signedCommit(repo: string, file: string, subject: string) {
  fs.writeFileSync(path.join(repo, file), `${subject}\n`);
  git(["add", "--", file], repo);
  const object = [
    `tree ${gitOutput(["write-tree"], repo)}`,
    `parent ${gitOutput(["rev-parse", "HEAD"], repo)}`,
    `author T <t@t.com> ${AT}`,
    `committer T <t@t.com> ${AT}`,
    "gpgsig -----BEGIN SSH SIGNATURE-----",
    " U1NIU0lHAAAAAQ==",
    " -----END SSH SIGNATURE-----",
    "",
    subject,
    ""
  ].join("\n");
  const id = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
    cwd: repo,
    input: object,
    stdio: "pipe"
  })
    .toString()
    .trim();
  git(["update-ref", "HEAD", id], repo);
  return id;
}

type Signed = { repo: string; I: string; F: string; G: string };

/**
 * `init` (`I`), pushed to a bare clone that the repository fetches as `origin`, then the signed
 * `first signed` (`F`, adding `a`) and `second signed` (`G`, adding `b`) on `main`. The repository
 * asks every log to show signatures, in colour. Returns the folders to delete as well.
 */
function signedRepository(): Signed & { folders: string[] } {
  const repo = makeRepo();
  const remote = fs.realpathSync.native(
    fs.mkdtempSync(path.join(path.dirname(repo), "ngg-remote-"))
  );
  const I = gitOutput(["rev-parse", "HEAD"], repo);
  git(["clone", "-q", "--bare", repo, remote], repo);
  git(["remote", "add", "origin", remote], repo);
  git(["fetch", "-q", "origin"], repo);
  git(["config", "log.showSignature", "true"], repo);
  git(["config", "color.ui", "always"], repo);
  const F = signedCommit(repo, "a", "first signed");
  const G = signedCommit(repo, "b", "second signed");
  return { repo, I, F, G, folders: [repo, remote] };
}

function removeFolders(folders: string[]) {
  for (const dir of folders) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const messages = (entries: HistoryEntry[]) => entries.map((entry) => entry.message);

describe("queries that read logs, in a repository whose logs show signatures", () => {
  let signed: Signed = { repo: "", I: "", F: "", G: "" };
  let folders: string[] = [];
  const client = () => createGit(signed.repo, "git");

  beforeAll(() => {
    ({ folders, ...signed } = signedRepository());
  });
  afterAll(() => {
    removeFolders(folders);
  });

  it("start from a fixture that changes Git's own log output", () => {
    // Without that, the checks below would pass for the wrong reason.
    expect(gitOutput(["log", "--format=%s", "-2"], signed.repo)).not.toBe(
      "second signed\nfirst signed"
    );
    expect(gitOutput(["status", "--porcelain"], signed.repo)).toBe("");
  });

  it("give the graph plain subjects, and no uncommitted row", async () => {
    const { I, F, G } = signed;
    const request = {
      branchName: "",
      maxCommits: 10,
      showRemoteBranches: true,
      hard: false,
      dateType: "Author Date" as const,
      showUncommittedChanges: true
    };
    const result = await loadCommits(client(), request);
    expect(result).toMatchObject({ head: G, moreCommitsAvailable: false, uncommittedChanges: 0 });
    expect(result.commits.map((entry) => [entry.hash, entry.message])).toStrictEqual([
      [G, "second signed"],
      [F, "first signed"],
      [I, "init"]
    ]);
    expect(result.commits.slice(0, 2).map((entry) => entry.date)).toStrictEqual([
      1_700_000_000, 1_700_000_000
    ]);
    expect(result.commits[0]!.refs).toStrictEqual([{ hash: G, name: "main", type: "head" }]);

    const onMain = await loadCommits(client(), { ...request, branchName: "main" });
    expect(onMain.commits.map((entry) => entry.message)).toStrictEqual([
      "second signed",
      "first signed",
      "init"
    ]);
  });

  it("give the details panel the plain header and message", async () => {
    const { F, G } = signed;
    expect(await commitDetails(client(), { commitHash: G, dateType: "Author Date" })).toStrictEqual(
      {
        commitDetails: {
          hash: G,
          parents: [F],
          author: "T",
          email: "t@t.com",
          date: 1_700_000_000,
          committer: "T",
          body: "second signed",
          fileChanges: [
            { oldFilePath: "b", newFilePath: "b", type: "A", additions: 1, deletions: 0 }
          ]
        }
      }
    );
  });

  it("give the history view plain subjects", async () => {
    const page = await loadHistory(
      client(),
      { text: "", author: "", since: "", until: "", path: "", revision: "", follow: false },
      0
    );
    expect(page.entries.map((entry) => entry.hash)).toStrictEqual([signed.G, signed.F, signed.I]);
    expect(messages(page.entries)).toStrictEqual(["second signed", "first signed", "init"]);
    expect(page.more).toBe(false);
  });

  it("give a batch plan plain subjects, in the order asked", async () => {
    const plan = await loadBatchPlan(client(), [signed.F, signed.G]);
    expect(messages(plan.entries)).toStrictEqual(["first signed", "second signed"]);
    expect(plan).toMatchObject({ head: signed.G, branch: "main" });
  });

  it("give an interactive rebase plan plain subjects", async () => {
    const { I, F, G } = signed;
    expect(
      await repositoryQuery(client(), { kind: "rebasePlan", base: I, autosquash: false })
    ).toStrictEqual({
      kind: "rebasePlan",
      plan: {
        base: I,
        head: G,
        branch: "main",
        entries: [
          { hash: F, action: "pick", message: "first signed" },
          { hash: G, action: "pick", message: "second signed" }
        ]
      }
    });
  });

  it("give a sync plan the outgoing commits' plain subjects", async () => {
    const plan = await loadSyncPlan(client(), "main", "origin", "main");
    expect(messages(plan.outgoing.entries)).toStrictEqual(["second signed", "first signed"]);
    expect(plan).toMatchObject({
      local: signed.G,
      remoteHead: signed.I,
      incoming: { entries: [], more: false },
      ahead: 2,
      behind: 0,
      canFastForward: false
    });
  });

  it("give a comparison the files and plain subjects between two commits", async () => {
    const comparison = await loadComparison(client(), signed.I, signed.G, false);
    expect(comparison.files).toStrictEqual([
      { status: "A", before: "a", after: "a" },
      { status: "A", before: "b", after: "b" }
    ]);
    expect(messages(comparison.rightOnly.entries)).toStrictEqual(["second signed", "first signed"]);
    expect(comparison.leftOnly.entries).toStrictEqual([]);
  });

  it("give the reflog whole object IDs", async () => {
    const { entries } = await loadReflog(client(), { offset: 0 });
    const hashes = new Set(entries.map((entry) => entry.hash));
    expect([...hashes].toSorted()).toStrictEqual([signed.I, signed.F, signed.G].toSorted());
  });
});

describe("a bisect over signed commits", () => {
  let signed: Signed & { folders: string[] } = { repo: "", I: "", F: "", G: "", folders: [] };
  const client = () => createGit(signed.repo, "git");

  beforeEach(() => {
    signed = signedRepository();
  });
  afterEach(() => {
    removeFolders(signed.folders);
  });

  it("reports the plain subject of the commit under test, then of the first bad one", async () => {
    const { repo, I, F, G } = signed;
    git(["bisect", "start", G, I], repo);
    const testing = await repositoryQuery(client(), { kind: "bisect" });
    expect(testing).toStrictEqual({
      kind: "bisect",
      head: F,
      state: {
        id: expect.stringMatching(/^[0-9a-f]{64}$/),
        original: "main",
        head: F,
        subject: "first signed",
        good: [I],
        bad: G,
        skipped: [],
        remaining: 2,
        firstBad: null,
        ambiguous: false,
        terms: { good: "good", bad: "bad" }
      }
    });

    git(["bisect", "good"], repo);
    const found = await repositoryQuery(client(), { kind: "bisect" });
    expect(found.kind === "bisect" ? found.state : null).toMatchObject({
      head: F,
      subject: "second signed",
      bad: G,
      remaining: 1,
      firstBad: G,
      ambiguous: false
    });
    expect(found.kind === "bisect" ? found.state?.good.toSorted() : null).toStrictEqual(
      [I, F].toSorted()
    );
  });
});

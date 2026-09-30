import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";

import {
  defaults,
  type GraphInput,
  recordingGit,
  repoA,
  useTempDirs
} from "@tests/backend/queries/loadCommits/fixtures";

const tempDir = useTempDirs();
const posix = process.platform !== "win32";

const FORMAT = "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s";
const STATUS = "status --porcelain -b -u --null --untracked-files=all";

/** The Git processes one load runs, through a Git executable that records them. */
async function processes(input: GraphInput, dirty = false) {
  const { repo, S } = repoA(tempDir());
  if (dirty) {
    fs.writeFileSync(path.join(repo, "untracked"), "");
  }
  const recorder = recordingGit(tempDir());
  const result = await loadCommits(createGit(repo, recorder.gitPath), input);
  return { S, result, runs: recorder.runs() };
}

describe.runIf(posix)("Git processes", () => {
  it("runs show-ref, log and status once each, through the client", async () => {
    const { S, result, runs } = await processes(defaults);
    expect(result.commits).toHaveLength(2);
    expect(runs).toEqual([
      "show-ref -d --head",
      `log -z --max-count=301 ${FORMAT} --date-order --branches --tags --remotes ${S} --`,
      STATUS
    ]);
  });

  it("runs no status when the row is off", async () => {
    const { S, runs } = await processes(
      { ...defaults, showRemoteBranches: false, showUncommittedChanges: false },
      true
    );
    expect(runs).toEqual([
      "show-ref --heads --tags -d --head",
      `log -z --max-count=301 ${FORMAT} --date-order --branches --tags ${S} --`
    ]);
  });

  it("asks for the commit date and names a filtered branch by its full ref", async () => {
    const { runs } = await processes({
      ...defaults,
      branchName: "main",
      dateType: "Commit Date",
      maxCommits: 1
    });
    expect(runs).toEqual([
      "show-ref -d --head",
      `log -z --max-count=2 ${FORMAT.replace("%at", "%ct")} --date-order refs/heads/main --`,
      STATUS
    ]);
  });

  it("adds the two visibility processes only when a remote is hidden", async () => {
    const { S, runs } = await processes({ ...defaults, hiddenRemotes: ["origin"] });
    expect(runs.slice(0, 3).toSorted()).toEqual(
      ["for-each-ref --format=%(refname) refs/remotes/", "remote", "show-ref -d --head"].toSorted()
    );
    expect(runs.slice(3)).toEqual([
      `log -z --max-count=301 ${FORMAT} --date-order --branches --tags --exclude=origin/* --remotes ${S} --`,
      STATUS
    ]);
    const off = await processes({
      ...defaults,
      showRemoteBranches: false,
      hiddenRemotes: ["origin"],
      showUncommittedChanges: false
    });
    expect(off.runs).toHaveLength(2);
  });
});

describe("cancellation", () => {
  it("starts no Git process for a request that was already cancelled", async () => {
    const { repo } = repoA(tempDir());
    const recorder = posix ? recordingGit(tempDir()) : undefined;
    const client = createGit(repo, recorder?.gitPath ?? "git", AbortSignal.abort());
    await expect(loadCommits(client, defaults)).rejects.toThrow("Abort already signaled");
    expect(recorder?.runs() ?? []).toEqual([]);
  });

  it("rejects when the request is cancelled while Git runs", async () => {
    const { repo } = repoA(tempDir());
    const controller = new AbortController();
    const load = loadCommits(createGit(repo, "git", controller.signal), defaults);
    controller.abort();
    await expect(load).rejects.toThrow(/^Abort (already signaled|signal received)$/);
  });
});

import { describe, expect, it, vi } from "vitest";

import { checkoutBranch } from "@/backend/actions/branch";
import { createGit } from "@/backend/gitClient";

import { recordingGit } from "@tests/backend/queries/loadCommits/fixtures";
import {
  allRefs,
  commitFile,
  isRunning,
  onWindows,
  readFile,
  run,
  sandbox,
  stalledOrigin,
  succeeds,
  withoutPromptSetting,
  writeFile
} from "@tests/backend/sandbox";

const box = sandbox();

/** A published repository and a clone of it with a second local branch, `other`. */
function published() {
  const origin = box.repo();
  const local = box.clone(origin);
  run(local, "branch", "other");
  return {
    origin,
    local,
    /** Commit on the published `main` without fetching it; returns the new commit. */
    publish: (text: string) => commitFile(origin, "f", text, `publish ${text}`),
    tracked: () => run(local, "rev-parse", "refs/remotes/origin/main")
  };
}

const upstreamOf = (repo: string, branch: string) =>
  run(repo, "rev-parse", "--abbrev-ref", `${branch}@{upstream}`);

describe("checking out a remote branch without a fetch", () => {
  it("starts the new branch at the last fetched revision and still tracks it", async () => {
    const { local, publish, tracked } = published();
    const lastFetched = tracked();
    publish("unseen");
    await expect(
      checkoutBranch(createGit(local, "git"), { branchName: "x", remoteBranch: "origin/main" })
    ).resolves.toBeUndefined();
    expect(run(local, "rev-parse", "refs/heads/x")).toBe(lastFetched);
    expect(tracked()).toBe(lastFetched);
    expect(upstreamOf(local, "x")).toBe("origin/main");
  });

  it("refuses a new branch whose checkout would overwrite local changes", async () => {
    const { local, publish } = published();
    const head = run(local, "rev-parse", "HEAD");
    publish("remote text");
    run(local, "fetch", "-q", "origin");
    writeFile(local, "f", "local text");
    await expect(
      checkoutBranch(createGit(local, "git"), {
        branchName: "nb",
        remoteBranch: "origin/main",
        fetch: false
      })
    ).rejects.toThrow();
    expect(succeeds(local, "rev-parse", "--verify", "--quiet", "refs/heads/nb")).toBe(false);
    expect(run(local, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(run(local, "rev-parse", "HEAD")).toBe(head);
    expect(readFile(local, "f")).toBe("local text");
  });

  it("switches before a refused fast-forward and stays switched", async () => {
    const { local, publish } = published();
    const localWork = commitFile(local, "local.txt", "mine", "local work");
    publish("theirs");
    run(local, "fetch", "-q", "origin");
    run(local, "checkout", "-q", "other");
    await expect(
      checkoutBranch(createGit(local, "git"), { branchName: "main", remoteBranch: "origin/main" })
    ).rejects.toThrow();
    expect(run(local, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(run(local, "rev-parse", "HEAD")).toBe(localWork);
  });
});

describe("checking out a remote branch with a fetch", () => {
  it("updates only the chosen remote-tracking branch and fetches no tags", async () => {
    const { origin, local, publish } = published();
    const latest = publish("latest");
    run(origin, "checkout", "-q", "-b", "side");
    commitFile(origin, "side.txt", "side", "side work");
    run(origin, "tag", "v1");
    run(origin, "checkout", "-q", "main");

    await checkoutBranch(createGit(local, "git"), {
      branchName: "x",
      remoteBranch: "origin/main",
      fetch: true
    });
    expect(run(local, "rev-parse", "refs/heads/x")).toBe(latest);
    expect(run(local, "for-each-ref", "--format=%(refname)", "refs/tags/")).toBe("");
    expect(run(local, "for-each-ref", "--format=%(refname)", "refs/remotes/origin/side")).toBe("");
  });

  it("refuses an invalid local name before looking up or fetching anything", async () => {
    const { local, publish } = published();
    publish("not fetched");
    const before = allRefs(local);
    await expect(
      checkoutBranch(createGit(local, "git"), {
        branchName: "bad name",
        remoteBranch: "origin/main",
        fetch: true
      })
    ).rejects.toThrow(/Enter a valid branch name/);
    expect(allRefs(local)).toBe(before);
  });

  it("fetches from the remote with the longest matching name", async () => {
    const { origin, local } = published();
    const shortRemote = box.bare();
    const longRemote = box.bare();
    run(origin, "push", "-q", shortRemote, "main");
    const longTip = commitFile(origin, "f", "long", "only on the long remote");
    run(origin, "push", "-q", longRemote, "main");
    run(local, "remote", "add", "up", shortRemote);
    run(local, "config", "remote.up.fetch", "+refs/heads/*:refs/remotes/up-only/*");
    // Git 2.55 and later refuse to add a remote named inside another one, but repositories
    // that have one still work, so write the configuration `remote add` would have written.
    run(local, "config", "remote.up/stream.url", longRemote);
    run(local, "config", "remote.up/stream.fetch", "+refs/heads/*:refs/remotes/up/stream/*");

    await checkoutBranch(createGit(local, "git"), {
      branchName: "y",
      remoteBranch: "up/stream/main",
      fetch: true
    });
    expect(run(local, "rev-parse", "refs/heads/y")).toBe(longTip);
    expect(run(local, "config", "branch.y.remote")).toBe("up/stream");
    expect(run(local, "config", "branch.y.merge")).toBe("refs/heads/main");
  });

  it.skipIf(onWindows)("runs the lookup, fetch and checkout in order", async () => {
    const { local } = published();
    const recorder = recordingGit(box.folder("bin"));
    await checkoutBranch(createGit(local, recorder.gitPath), {
      branchName: "nb",
      remoteBranch: "origin/main",
      fetch: true
    });
    expect(recorder.runs()).toEqual([
      "check-ref-format --normalize refs/heads/nb",
      "remote",
      "check-ref-format --normalize refs/heads/main",
      "rev-parse --show-toplevel",
      "fetch --no-tags -- origin +refs/heads/main:refs/remotes/origin/main",
      "for-each-ref --format=%(if)%(symref)%(then)%(else)%(refname)%(end) refs/heads/",
      "checkout --track -b nb refs/remotes/origin/main"
    ]);
  });

  it.skipIf(onWindows)(
    "stops a stalled fetch without prompting and creates no branch",
    async () => {
      const repo = box.repo();
      const origin = stalledOrigin(repo);
      run(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
      const controller = new AbortController();

      await withoutPromptSetting(async () => {
        const checkout = checkoutBranch(createGit(repo, "git", controller.signal), {
          branchName: "x",
          remoteBranch: "origin/main",
          fetch: true
        }).then(
          () => "resolved",
          () => "rejected"
        );
        const ssh = await origin.connected();
        expect(ssh.prompt).toBe("0");
        const abortedAt = Date.now();
        controller.abort();
        expect(await checkout).toBe("rejected");
        expect(Date.now() - abortedAt).toBeLessThan(5000);
        await vi.waitFor(() => expect(isRunning(ssh.pid)).toBe(false));
      });
      expect(succeeds(repo, "rev-parse", "--verify", "--quiet", "refs/heads/x")).toBe(false);
    },
    20_000
  );
});

import type { SimpleGit } from "simple-git";
import { describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadBranches } from "@/backend/queries/loadBranches";

import { freshRepo, git } from "@tests/backend/helpers";

const repo = freshRepo();

type Request = Parameters<typeof loadBranches>[1];

/** The branch list of the current repository, with remote branches off unless `request` says. */
function branchList(request: Partial<Request> = {}, client: SimpleGit = createGit(repo(), "git")) {
  return loadBranches(client, {
    showRemoteBranches: false,
    hard: false,
    repo: repo(),
    gitPath: "git",
    ...request
  });
}

/** Adds remote-tracking refs at HEAD for `names`, such as `team/topic`, without fetching. */
function trackRefs(...names: string[]) {
  for (const name of names) {
    git(["update-ref", `refs/remotes/${name}`, "HEAD"], repo());
  }
}

/** A client whose `raw` calls are logged by their first argument and may be made to fail. */
function watchedClient(fail?: string) {
  const client = createGit(repo(), "git");
  const passThrough = client.raw.bind(client);
  const commands: string[][] = [];
  const running: PromiseLike<unknown>[] = [];
  vi.spyOn(client, "raw").mockImplementation((...args) => {
    const command = Array.isArray(args[0]) ? (args[0] as string[]) : [];
    commands.push(command);
    if (command[0] === fail) {
      return Promise.reject(new Error("Git read denied")) as ReturnType<SimpleGit["raw"]>;
    }
    const pending = passThrough(...args);
    running.push(pending);
    return pending;
  });
  return { client, commands, settled: () => Promise.allSettled(running) };
}

describe("branch order", () => {
  it.each(["-committerdate", "-refname"])(
    "lists the head, then Git's ref-name order, whatever branch.sort=%s says",
    async (sort) => {
      for (const branch of ["alpha", "Beta", "zeta"]) {
        git(["branch", branch], repo());
      }
      git(["config", "branch.sort", sort], repo());
      git(["checkout", "-q", "zeta"], repo());
      expect((await branchList()).branches).toEqual(["zeta", "Beta", "alpha", "main"]);
    }
  );
});

describe("result shape", () => {
  it("has exactly the five response keys, and no visibilityKey", async () => {
    const result = await branchList();
    expect(Object.keys(result).toSorted()).toEqual(["branches", "hard", "head", "isRepo", "repo"]);
    expect("visibilityKey" in result).toBe(false);
  });

  it("echoes the repo string without resolving it", async () => {
    const result = await branchList({ repo: "not/a/real/path", gitPath: "ignored", hard: true });
    expect(result).toMatchObject({ repo: "not/a/real/path", hard: true, head: "main" });
  });
});

describe("the head", () => {
  it("is null on an orphan branch, whose siblings are still listed", async () => {
    git(["branch", "other"], repo());
    git(["checkout", "-q", "--orphan", "fresh"], repo());
    expect(await branchList()).toMatchObject({ head: null, branches: ["main", "other"] });
  });

  it("skips symbolic branches, and resolves a HEAD that points at one", async () => {
    git(["symbolic-ref", "refs/heads/alias", "refs/heads/main"], repo());
    git(["branch", "side"], repo());
    expect((await branchList()).branches).toEqual(["main", "side"]);

    git(["checkout", "-q", "side"], repo());
    git(["symbolic-ref", "HEAD", "refs/heads/alias"], repo());
    const result = await branchList();
    expect(result.head).toBe("main");
    expect(result.branches).toEqual(["main", "side"]);
  });

  it("is null when the HEAD read fails, which is not an error", async () => {
    const { client, settled } = watchedClient("symbolic-ref");
    try {
      expect(await branchList({}, client)).toMatchObject({ head: null, branches: ["main"] });
    } finally {
      await settled();
    }
  });
});

describe("remote-tracking branches", () => {
  it("hides a remote without hiding a configured remote named below it", async () => {
    git(["remote", "add", "team", "."], repo());
    // Git 2.55 and later refuse to add a remote named inside another one, but repositories
    // that have one still work, so write the configuration `remote add` would have written.
    git(["config", "remote.team/upstream.url", "."], repo());
    git(
      ["config", "remote.team/upstream.fetch", "+refs/heads/*:refs/remotes/team/upstream/*"],
      repo()
    );
    trackRefs("team/topic", "team/upstream/topic");

    const hideTeam = await branchList({ showRemoteBranches: true, hiddenRemotes: ["team"] });
    expect(hideTeam.branches).toContain("remotes/team/upstream/topic");
    expect(hideTeam.branches).not.toContain("remotes/team/topic");

    const hideUpstream = await branchList({
      showRemoteBranches: true,
      hiddenRemotes: ["team/upstream"]
    });
    expect(hideUpstream.branches).toContain("remotes/team/topic");
    expect(hideUpstream.branches).not.toContain("remotes/team/upstream/topic");
  });

  it("lists refs of a remote that is not configured, until that name is hidden", async () => {
    trackRefs("stale/topic", "loner");
    const shown = await branchList({ showRemoteBranches: true });
    expect(shown.branches).toEqual(["main", "remotes/loner", "remotes/stale/topic"]);

    const hidden = await branchList({ showRemoteBranches: true, hiddenRemotes: ["stale"] });
    expect(hidden.branches).toEqual(["main", "remotes/loner"]);
  });

  it("does not read remotes at all when remote branches are off", async () => {
    git(["remote", "add", "origin", "."], repo());
    trackRefs("origin/main");
    const { client, commands, settled } = watchedClient();
    const hiddenRemotes = ["origin"];
    const result = await branchList({ hiddenRemotes }, client);
    await settled();
    expect(commands.map((command) => command[0]).toSorted()).toEqual([
      "for-each-ref",
      "symbolic-ref"
    ]);
    expect(commands.find((command) => command[0] === "for-each-ref")?.at(-1)).toBe("refs/heads/");
    expect(result.branches).toEqual(["main"]);
    expect(hiddenRemotes).toEqual(["origin"]);
  });

  it("rejects when the remote-visibility read fails", async () => {
    git(["remote", "add", "origin", "."], repo());
    const { client, settled } = watchedClient("remote");
    try {
      await expect(
        branchList({ showRemoteBranches: true, hiddenRemotes: ["origin"] }, client)
      ).rejects.toThrow("Git read denied");
    } finally {
      await settled();
    }
  });

  it("keeps a local branch that looks like a remote one apart from the remote branch", async () => {
    git(["remote", "add", "origin", "."], repo());
    trackRefs("origin/main");
    git(["branch", "origin/main"], repo());
    expect((await branchList({ showRemoteBranches: true })).branches).toEqual([
      "main",
      "origin/main",
      "remotes/origin/main"
    ]);
  });

  it("lists an entry once when a local branch is named like a remote-tracking entry", async () => {
    trackRefs("solo");
    git(["branch", "remotes/solo"], repo());
    expect((await branchList({ showRemoteBranches: true })).branches).toEqual([
      "main",
      "remotes/solo"
    ]);
  });
});

it("rejects when the client's signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(branchList({}, createGit(repo(), "git", controller.signal))).rejects.toThrow();
});

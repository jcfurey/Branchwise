import { describe, expect, it } from "vitest";

import type * as Types from "@/backend/types";
import type {
  ActionPayload,
  ActionRequest,
  ActionResponse,
  DateType,
  GitCommitNode,
  GitFileChangeType,
  GitLogEntry,
  GitRef,
  GitResetMode,
  GraphQueryCommand,
  QueryRequest,
  QueryResponse,
  QueryResult
} from "@/backend/types";

// Each sample below compiles only when it fits the type named with it. A line marked
// `@ts-expect-error` must fail to compile, so `pnpm typecheck` fails if the shapes loosen.

/** Returns `value` once the compiler accepts it as a `T`. */
const fits = <T>(value: T) => value;

/** Drops `repo` member by member, as the webview does before it knows the repository. */
type WithoutRepo<T> = T extends unknown ? Omit<T, "repo"> : never;

const repo = "/work/tree";
const sha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

describe("action messages", () => {
  it("require a request id exactly where the payload does", () => {
    const addTag = fits<ActionRequest>({
      command: "addTag",
      repo,
      tagName: "v1",
      commitHash: sha,
      lightweight: true,
      message: ""
    });
    const withoutRepo = fits<WithoutRepo<ActionRequest>>({ command: "deleteTag", tagName: "v1" });
    const open = { kind: "openWorktree", path: repo } as const;
    fits<ActionRequest>({ command: "repositoryAction", repo, requestId: "w", action: open });
    // @ts-expect-error: repository actions are always correlated.
    fits<ActionRequest>({ command: "repositoryAction", repo, action: open });
    // @ts-expect-error: a branch push is always correlated.
    fits<ActionRequest>({
      command: "pushBranch",
      repo,
      branchName: "main",
      remote: "origin",
      remoteBranch: "main",
      setUpstream: false
    });
    // @ts-expect-error: a pull is always correlated.
    fits<ActionRequest>({
      command: "pullBranch",
      repo,
      branchName: "main",
      remote: "origin",
      remoteBranch: "main"
    });
    // @ts-expect-error: a fetch is always correlated.
    fits<ActionRequest>({ command: "fetchRemote", repo, remote: null, prune: false });
    // @ts-expect-error: dropping `repo` must not make the id optional.
    fits<WithoutRepo<ActionRequest>>({ command: "fetchRemote", remote: null, prune: true });

    expect([addTag.command, withoutRepo.command]).toEqual(["addTag", "deleteTag"]);
  });

  it("let optional fields be left out but never set to undefined", () => {
    const local = fits<ActionRequest>({
      command: "checkoutBranch",
      repo,
      branchName: "topic",
      remoteBranch: null
    });
    // @ts-expect-error: an absent id is spelt by leaving the key out.
    fits<ActionRequest>({ command: "deleteTag", repo, tagName: "v1", requestId: undefined });
    const checkout = {
      command: "checkoutBranch",
      repo,
      branchName: "b",
      remoteBranch: null
    } as const;
    // @ts-expect-error: `fetch` is a boolean when present.
    fits<ActionRequest>({ ...checkout, fetch: undefined });
    const push = {
      command: "pushBranch",
      repo,
      requestId: "r",
      branchName: "main",
      remote: "origin",
      remoteBranch: "main",
      setUpstream: true
    } as const;
    // @ts-expect-error: a lease names a hash when present.
    fits<ActionRequest>({ ...push, expectedRemoteHash: undefined });

    expect(Object.keys(local)).not.toContain("fetch");
  });

  it("give each backend function its own fields only", () => {
    const checkout = fits<ActionPayload<"checkoutBranch">>({ branchName: "b", remoteBranch: null });
    const tagPush = fits<ActionPayload<"pushTag">>({ tagName: "v1", remote: "o", requestId: "t" });
    // @ts-expect-error: the backend fetch still takes the id.
    fits<ActionPayload<"fetchRemote">>({ remote: null, prune: false });
    const tag = { tagName: "v1", commitHash: sha, lightweight: false, message: "" } as const;
    // @ts-expect-error: a tag's input has no id.
    fits<ActionPayload<"addTag">>({ ...tag, requestId: "x" });
    // @ts-expect-error: the envelope is not part of a payload.
    fits<ActionPayload<"deleteTag">>({ tagName: "v1", repo });
    // @ts-expect-error: only the 17 commands have payloads.
    const stash: ActionPayload<"stash"> | null = null;

    const reset = { command: "resetToCommit", repo, commitHash: sha, resetMode: "hard" } as const;
    const request: Extract<ActionRequest, { command: "resetToCommit" }> = reset;
    const payload: ActionPayload<"resetToCommit"> = request;

    expect([checkout.remoteBranch, tagPush.requestId, stash]).toEqual([null, "t", null]);
    expect(payload.resetMode).toBe("hard");
  });

  it("answer each of the 17 commands with a status", () => {
    const titles: Record<ActionResponse["command"], true> = {
      repositoryAction: true,
      addTag: true,
      deleteTag: true,
      pushTag: true,
      createBranch: true,
      deleteBranch: true,
      renameBranch: true,
      checkoutBranch: true,
      checkoutCommit: true,
      cherrypickCommit: true,
      revertCommit: true,
      resetToCommit: true,
      mergeBranch: true,
      mergeCommit: true,
      pushBranch: true,
      pullBranch: true,
      fetchRemote: true
    };
    const extra: Record<ActionRequest["command"], true> = {
      ...titles,
      // @ts-expect-error: there is no 18th command.
      stashChanges: true
    };
    const bare = fits<ActionResponse>({ command: "mergeBranch", status: null });
    const failed = fits<ActionResponse>({
      command: "addTag",
      status: "tag exists",
      repo,
      requestId: "a"
    });
    // @ts-expect-error: every answer carries a status.
    fits<ActionResponse>({ command: "deleteTag", repo, requestId: "a" });
    // @ts-expect-error: the echoed repository is left out, not undefined.
    fits<ActionResponse>({ command: "deleteTag", status: null, repo: undefined });
    // @ts-expect-error: queries are not actions.
    fits<ActionResponse>({ command: "loadRemotes", status: null });

    expect(Object.keys(titles)).toHaveLength(17);
    expect(Object.keys(extra)).toHaveLength(18);
    expect([bare.status, failed.status]).toEqual([null, "tag exists"]);
  });
});

describe("Git records", () => {
  it("close each literal set", () => {
    const changes: GitFileChangeType[] = ["A", "M", "D", "R"];
    const labels: GitRef["type"][] = ["head", "tag", "remote"];
    const dates: DateType[] = ["Author Date", "Commit Date"];
    const modes: GitResetMode[] = ["soft", "mixed", "hard"];
    // @ts-expect-error: type changes are reported as "M".
    const typeChange: GitFileChangeType = "T";
    // @ts-expect-error: copies are never reported.
    const copy: GitFileChangeType = "C";
    // @ts-expect-error: a local branch label is "head".
    const branch: GitRef["type"] = "branch";
    // @ts-expect-error: the setting holds the display phrase.
    const author: DateType = "author";
    // @ts-expect-error: only the three reset strengths exist.
    const keep: GitResetMode = "keep";

    expect([changes, labels, dates, modes].map((set) => set.length)).toEqual([4, 3, 2, 3]);
    expect([typeChange, copy, branch, author, keep]).toHaveLength(5);
  });

  it("make a graph row from a log entry and its labels", () => {
    const entry: GitLogEntry = {
      hash: sha,
      parentHashes: [],
      author: "Ada",
      email: "ada@example.test",
      date: 1_700_000_000,
      message: "Initial"
    };
    const row: GitCommitNode = { ...entry, refs: [{ hash: sha, name: "main", type: "head" }] };
    const back: GitLogEntry = row;
    const bare: GitCommitNode = { ...entry, refs: [] };
    // @ts-expect-error: a row always lists its labels, even when there are none.
    const unlabelled: GitCommitNode = entry;

    expect(back.hash).toBe(bare.hash);
    expect(unlabelled).toBe(entry);
  });

  it("no longer exports the unused GitRefData", () => {
    // @ts-expect-error: nothing produced or read it, so it was dropped.
    const dropped: Types.GitRefData | null = null;

    expect(dropped).toBeNull();
  });
});

describe("query messages", () => {
  it("require a request id on every read", () => {
    const commands: Record<QueryRequest["command"], true> = {
      repositoryQuery: true,
      loadRemotes: true,
      commitDetails: true,
      loadBranches: true,
      loadCommits: true
    };
    const extra: Record<QueryResponse["command"], true> = {
      ...commands,
      // @ts-expect-error: only five reads exist.
      loadTags: true
    };
    // @ts-expect-error: a details read is always correlated.
    fits<QueryRequest>({ command: "commitDetails", repo, commitHash: sha });
    const graph: GraphQueryCommand[] = ["loadBranches", "loadCommits", "commitDetails"];
    // @ts-expect-error: remote settings are not a latest-wins graph read.
    const remotes: GraphQueryCommand = "loadRemotes";

    expect(Object.keys(commands)).toHaveLength(5);
    expect(Object.keys(extra)).toHaveLength(6);
    expect([...graph, remotes]).toHaveLength(4);
  });

  it("echo identity on details answers but keep it out of the backend result", () => {
    const answer = fits<QueryResponse>({
      command: "commitDetails",
      repo,
      requestId: "d",
      commitDetails: null
    });
    // @ts-expect-error: the answer names its repository.
    fits<QueryResponse>({ command: "commitDetails", requestId: "d", commitDetails: null });
    // @ts-expect-error: the answer names its request.
    fits<QueryResponse>({ command: "commitDetails", repo, commitDetails: null });
    const result = fits<QueryResult<"commitDetails">>({ commitDetails: null });
    // @ts-expect-error: the handler adds the request id, not the query.
    fits<QueryResult<"commitDetails">>({ commitDetails: null, requestId: "d" });
    // @ts-expect-error: actions have no query result.
    const action: QueryResult<"addTag"> | null = null;

    expect([answer.command, result.commitDetails, action]).toEqual(["commitDetails", null, null]);
  });

  it("keep the visibility key plain in requests and undefined-admitting in answers", () => {
    const scope = { repo, requestId: "b", showRemoteBranches: true, hard: true } as const;
    const request = fits<QueryRequest>({ command: "loadBranches", ...scope, visibilityKey: "k" });
    // @ts-expect-error: a request without a key leaves it out.
    fits<QueryRequest>({ command: "loadBranches", ...scope, visibilityKey: undefined });
    const listing = { repo, branches: ["main"], head: "main", hard: true, isRepo: true };
    const answer = fits<QueryResponse>({
      command: "loadBranches",
      requestId: "b",
      ...listing,
      visibilityKey: undefined
    });
    const result = fits<QueryResult<"loadBranches">>({ ...listing, visibilityKey: undefined });

    expect([request.command, answer.command, "visibilityKey" in result]).toEqual([
      "loadBranches",
      "loadBranches",
      true
    ]);
  });

  it("let the remote and repository answers serve as their results", () => {
    const remotes: Extract<QueryResponse, { command: "loadRemotes" }> = {
      command: "loadRemotes",
      repo,
      requestId: "r",
      remotes: ["origin"],
      upstream: { remote: "origin", branchName: "main" },
      pushRemote: "origin",
      status: null
    };
    const settings: QueryResult<"loadRemotes"> = remotes;
    const state: Extract<QueryResponse, { command: "repositoryQuery" }> = {
      command: "repositoryQuery",
      repo,
      requestId: "s",
      data: null,
      status: "gone"
    };
    const data: QueryResult<"repositoryQuery">["data"] = state.data;

    expect([settings.pushRemote, data]).toEqual(["origin", null]);
  });
});

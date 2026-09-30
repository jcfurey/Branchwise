import { describe, expect, expectTypeOf, it } from "vitest";

import type { Config } from "@/extension/config";
import { registerMessageHandlers } from "@/old-extension/messageHandler";
import type { RepoManager } from "@/old-extension/repoManager";
import type { WebviewBridge } from "@/old-extension/webviewBridge";
import type {
  GitRepoSet,
  GitRepoState,
  GraphPreferences,
  RequestMessage,
  RequestSaveRepoState,
  RequestViewDiff,
  ResponseMessage,
  ResponseViewDiff
} from "@/types";

// Compile-time checks run under `tsc -p tests`: each line below `@ts-expect-error` must be
// refused by the compiler, or the type check fails.

/** Hands `sample` back unchanged, once the compiler agrees that it is a `Shape`. */
function shaped<Shape>(sample: Shape): Shape {
  return sample;
}

const actionCommands = [
  "repositoryAction",
  "addTag",
  "deleteTag",
  "pushTag",
  "createBranch",
  "deleteBranch",
  "renameBranch",
  "checkoutBranch",
  "cherrypickCommit",
  "revertCommit",
  "checkoutCommit",
  "resetToCommit",
  "mergeBranch",
  "mergeCommit",
  "pushBranch",
  "pullBranch",
  "fetchRemote"
] as const;
const queryCommands = [
  "repositoryQuery",
  "loadRemotes",
  "commitDetails",
  "loadBranches",
  "loadCommits"
] as const;
const toExtension = [
  "cancelAction",
  "cancelRepositoryQuery",
  "viewReady",
  ...actionCommands,
  ...queryCommands,
  "selectRepo",
  "saveRepoState",
  "viewDiff"
] as const;
const toWebview = [
  "repoState",
  "graphQueryError",
  "fileHistory",
  ...actionCommands,
  ...queryCommands,
  "viewDiff",
  "refresh"
] as const;

const preferences = {
  branchDisplay: "focus",
  focusPaused: false,
  focusDimming: "strong",
  showRemoteBranches: true
} as const;

describe("command sets", () => {
  it("hold 28 requests and 27 responses, sharing the actions, queries and viewDiff", () => {
    expectTypeOf<(typeof toExtension)[number]>().toEqualTypeOf<RequestMessage["command"]>();
    expectTypeOf<(typeof toWebview)[number]>().toEqualTypeOf<ResponseMessage["command"]>();

    expect(new Set(toExtension).size).toBe(28);
    expect(new Set(toWebview).size).toBe(27);
  });

  it("pick exactly one member for the name both directions use", () => {
    expectTypeOf<
      Extract<ResponseMessage, { command: "viewDiff" }>
    >().toEqualTypeOf<ResponseViewDiff>();
    expectTypeOf<
      Extract<RequestMessage, { command: "viewDiff" }>
    >().toEqualTypeOf<RequestViewDiff>();
  });

  it("report graph failures for the three graph reads only", () => {
    const failure = {
      command: "graphQueryError",
      repo: "/r",
      requestId: "g",
      message: "m"
    } as const;
    const commits = shaped<ResponseMessage>({ ...failure, query: "loadCommits" });
    // @ts-expect-error: repository queries report their own failures.
    shaped<ResponseMessage>({ ...failure, query: "repositoryQuery" });

    expect(commits.command).toBe("graphQueryError");
  });
});

describe("stored records", () => {
  it("need column widths, and leave optional fields out rather than undefined", () => {
    const minimal = shaped<GitRepoState>({ columnWidths: null });
    const full = shaped<GitRepoState>({
      columnWidths: [1, 2, 3, 4],
      hiddenRemotes: ["origin"],
      graphPreferences: {
        branchDisplay: "filter",
        focusPaused: false,
        focusDimming: "subtle",
        showRemoteBranches: true
      }
    });
    // @ts-expect-error: every record says whether the table was resized.
    shaped<GitRepoState>({});
    // @ts-expect-error: no hidden remotes are spelt by leaving the field out.
    shaped<GitRepoState>({ columnWidths: null, hiddenRemotes: undefined });

    expect(Object.keys(minimal)).toEqual(["columnWidths"]);
    expect(full.hiddenRemotes).toEqual(["origin"]);
  });

  it("keep the focus target optional without admitting undefined", () => {
    const allBranches = shaped<GraphPreferences>({ ...preferences, focusBranch: "*" });
    const checkedOut = shaped<GraphPreferences>(preferences);
    // @ts-expect-error: an absent target is left out.
    shaped<GraphPreferences>({ ...preferences, focusBranch: undefined });

    expect([allBranches.focusBranch, "focusBranch" in checkedOut]).toEqual(["*", false]);
  });

  it("let a save carry any subset of the fields in its declared form", () => {
    const save = { command: "saveRepoState", repo: "/r" } as const;
    const nothing = shaped<RequestSaveRepoState>({ ...save, state: {} });
    const widths = shaped<RequestSaveRepoState>({ ...save, state: { columnWidths: [5, 6, 7, 8] } });
    // @ts-expect-error: a save never resets a field to undefined.
    shaped<RequestSaveRepoState>({ ...save, state: { columnWidths: undefined } });

    expect([nothing.state, widths.state]).toEqual([{}, { columnWidths: [5, 6, 7, 8] }]);
  });

  it("may lack the record of a repository", () => {
    const records: GitRepoSet = { "/work/app": { columnWidths: null } };
    const unknown = records["/work/other"];

    expectTypeOf(unknown).toEqualTypeOf<GitRepoState | undefined>();
    expect(unknown).toBeUndefined();
  });
});

/** The legacy handlers over a bridge that records posts, with no repository ever saved. */
function withoutSavedRepositories() {
  const receivers = new Map<string, (message: RequestMessage) => unknown>();
  const posts: Array<ResponseMessage> = [];
  const bridge = {
    post: async (message: ResponseMessage) => {
      posts.push(message);
      return true;
    },
    onMessage: (command: string, receiver: (message: RequestMessage) => unknown) => {
      receivers.set(command, receiver);
    },
    dispose: () => {}
  } as unknown as WebviewBridge;
  const repoManager = { getRepos: (): GitRepoSet => ({}) } as unknown as RepoManager;
  const config = { gitPath: () => "git" } as unknown as Config;
  const handlers = registerMessageHandlers(bridge, { config, repoManager });
  const deliver = async (message: RequestMessage) => {
    await receivers.get(message.command)?.(message);
  };
  return { posts, deliver, handlers };
}

describe("the legacy selectRepo handler", () => {
  it("answers a repository that was never saved with the minimal record", async () => {
    const { posts, deliver, handlers } = withoutSavedRepositories();
    try {
      await deliver({ command: "selectRepo", repo: "/never" });

      expect(posts).toEqual([
        { command: "repoState", repo: "/never", state: { columnWidths: null } }
      ]);
    } finally {
      handlers.dispose();
    }
  });
});

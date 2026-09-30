import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRequest, QueryRequest, QueryResult } from "@/backend/types";
import { registerMessageHandlers } from "@/old-extension/messageHandler";

const fakes = vi.hoisted(() => ({
  deleteTag: vi.fn(),
  loadRemotes: vi.fn(),
  loadBranches: vi.fn(),
  repositoryQuery: vi.fn()
}));

vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: (repo: string) => ({ getInstance: () => ({ repo }) })
}));
vi.mock("@/backend/actions/tag", () => ({
  addTag: vi.fn(),
  deleteTag: fakes.deleteTag,
  pushTag: vi.fn()
}));
vi.mock("@/backend/queries/loadRemotes", () => ({ loadRemotes: fakes.loadRemotes }));
vi.mock("@/backend/queries/loadBranches", () => ({ loadBranches: fakes.loadBranches }));
vi.mock("@/backend/queries/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/backend/queries/repository")>()),
  repositoryQuery: fakes.repositoryQuery
}));

type Handler = (message: unknown) => void | Promise<void>;

/** The handlers the extension registers, and every message it posts back. */
function extensionSide() {
  const handlers = new Map<string, Handler>();
  const post = vi.fn();
  registerMessageHandlers(
    {
      post,
      onMessage: (command: string, handler: Handler) => handlers.set(command, handler)
    } as unknown as Parameters<typeof registerMessageHandlers>[0],
    {
      config: { gitPath: () => "git" },
      repoManager: { getRepos: () => ({}) }
    } as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  const deliver = async (message: ActionRequest | QueryRequest) => {
    await handlers.get(message.command)!(message);
  };
  /** The one message posted so far. */
  const reply = () => {
    expect(post).toHaveBeenCalledOnce();
    return post.mock.calls[0]?.[0] as unknown;
  };
  return { deliver, reply };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("an action without a request id", () => {
  const untracked: ActionRequest = { command: "deleteTag", repo: "/repo", tagName: "v1" };

  it("answers success with neither echo field", async () => {
    fakes.deleteTag.mockResolvedValue(undefined);
    const { deliver, reply } = extensionSide();
    await deliver(untracked);

    expect(reply()).toStrictEqual({ command: "deleteTag", status: null });
  });

  it("answers failure with neither echo field", async () => {
    fakes.deleteTag.mockRejectedValue(new Error("boom"));
    const { deliver, reply } = extensionSide();
    await deliver(untracked);

    expect(reply()).toStrictEqual({ command: "deleteTag", status: "boom" });
  });
});

describe("remote settings", () => {
  const ask: QueryRequest = {
    command: "loadRemotes",
    repo: "/repo",
    requestId: "r1",
    branchName: null
  };

  it("echo the request around the backend's answer", async () => {
    fakes.loadRemotes.mockResolvedValue({
      remotes: ["origin"],
      upstream: null,
      pushRemote: "origin"
    });
    const { deliver, reply } = extensionSide();
    await deliver(ask);

    expect(fakes.loadRemotes).toHaveBeenCalledWith({ repo: "/repo" }, null);
    expect(reply()).toStrictEqual({
      command: "loadRemotes",
      repo: "/repo",
      requestId: "r1",
      remotes: ["origin"],
      upstream: null,
      pushRemote: "origin",
      status: null
    });
  });

  it("fall back to empty settings with the failure as status", async () => {
    fakes.loadRemotes.mockRejectedValue(new Error("no repo"));
    const { deliver, reply } = extensionSide();
    await deliver(ask);

    expect(reply()).toStrictEqual({
      command: "loadRemotes",
      repo: "/repo",
      requestId: "r1",
      remotes: [],
      upstream: null,
      pushRemote: null,
      status: "no repo"
    });
  });
});

describe("the branch list", () => {
  const listing: QueryResult<"loadBranches"> = {
    repo: "/repo",
    branches: ["main"],
    head: "main",
    hard: true,
    isRepo: true
  };
  const ask = {
    command: "loadBranches",
    repo: "/repo",
    requestId: "b1",
    showRemoteBranches: true,
    hiddenRemotes: [],
    hard: true
  } satisfies QueryRequest;

  it("carries the request's visibility key back", async () => {
    fakes.loadBranches.mockResolvedValue(listing);
    const { deliver, reply } = extensionSide();
    await deliver({ ...ask, visibilityKey: "k" });

    expect(reply()).toStrictEqual({
      command: "loadBranches",
      requestId: "b1",
      visibilityKey: "k",
      ...listing
    });
  });

  it("sends no key over the wire when the request had none", async () => {
    fakes.loadBranches.mockResolvedValue(listing);
    const { deliver, reply } = extensionSide();
    await deliver(ask);
    const wire = JSON.parse(JSON.stringify(reply())) as Record<string, unknown>;

    expect(wire).not.toHaveProperty("visibilityKey");
    expect(wire).toStrictEqual({ command: "loadBranches", requestId: "b1", ...listing });
  });
});

it("answers a repository query with its data, identity and a null status", async () => {
  fakes.repositoryQuery.mockResolvedValue({ kind: "stashes", stashes: [] });
  const { deliver, reply } = extensionSide();
  await deliver({
    command: "repositoryQuery",
    repo: "/repo",
    requestId: "q",
    query: { kind: "stashes" }
  });

  expect(reply()).toStrictEqual({
    command: "repositoryQuery",
    repo: "/repo",
    requestId: "q",
    data: { kind: "stashes", stashes: [] },
    status: null
  });
});

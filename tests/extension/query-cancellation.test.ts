import { expect, it, vi } from "vitest";

import { registerMessageHandlers } from "@/old-extension/messageHandler";

const mocks = vi.hoisted(() => ({ factory: vi.fn(), query: vi.fn(), push: vi.fn() }));
vi.mock("@/backend/gitClient", () => ({ gitClientFactory: mocks.factory }));
vi.mock("@/backend/queries/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/backend/queries/repository")>()),
  repositoryQuery: mocks.query
}));
vi.mock("@/backend/actions/remote", () => ({
  pushBranch: mocks.push,
  pullBranch: vi.fn(),
  fetchRemote: vi.fn()
}));

it("cancels only matching reads, disposes outstanding reads, and lets mutations finish", async () => {
  const handlers = new Map<string, (message: unknown) => void | Promise<void>>();
  const post = vi.fn();
  const signals: AbortSignal[] = [];
  mocks.factory.mockImplementation((repo: string, _binary: string, signal?: AbortSignal) => ({
    getInstance: () => ({ repo, signal })
  }));
  mocks.query.mockImplementation((git: { signal: AbortSignal }) => {
    signals.push(git.signal);
    return new Promise((_resolve, reject) =>
      git.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
    );
  });
  let finish!: () => void;
  mocks.push.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const lifetime = registerMessageHandlers(
    {
      post,
      onMessage: (command: string, handler: (message: unknown) => void | Promise<void>) =>
        handlers.set(command, handler)
    } as unknown as Parameters<typeof registerMessageHandlers>[0],
    {
      config: { gitPath: () => "git" },
      repoManager: { getRepos: () => ({}) }
    } as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  const query = {
    command: "repositoryQuery",
    repo: "/repo",
    requestId: "search",
    query: { kind: "state" }
  };
  const first = handlers.get("repositoryQuery")!(query);
  const push = handlers.get("pushBranch")!({
    command: "pushBranch",
    repo: "/repo",
    requestId: "push",
    branchName: "main",
    remote: "origin",
    remoteBranch: "main",
    setUpstream: false
  });
  handlers.get("cancelRepositoryQuery")!({ repo: "/other", requestId: "search" });
  expect(signals[0]?.aborted).toBe(false);
  handlers.get("cancelRepositoryQuery")!({ repo: "/repo", requestId: "search" });
  await first;
  expect(post).not.toHaveBeenCalled();
  finish();
  await push;
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ command: "pushBranch", status: null })
  );
  post.mockClear();
  const second = handlers.get("repositoryQuery")!({ ...query, requestId: "second" });
  lifetime.dispose();
  await second;
  expect(signals[1]?.aborted).toBe(true);
  expect(post).not.toHaveBeenCalled();
});

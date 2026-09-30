import { expect, it, vi } from "vitest";

import { registerMessageHandlers } from "@/old-extension/messageHandler";

const mocks = vi.hoisted(() => ({
  repositoryQuery: vi.fn(
    async (_git: unknown, _query: unknown, _workspace: { repos: string[] }) => ({
      kind: "workspace",
      entries: []
    })
  ),
  listRepos: vi.fn(async () => ["/ws/a", "/ws/b"]),
  pruneMissing: vi.fn(async () => ["/deleted"])
}));

vi.mock("vscode", () => ({ l10n: { t: (message: string) => message } }));
vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: (repo: string) => ({ getInstance: () => ({ repo }) })
}));
vi.mock("@/backend/queries/repository", () => ({ repositoryQuery: mocks.repositoryQuery }));
vi.mock("@/extension/workspace-scan", () => ({
  listRepos: mocks.listRepos,
  invalidateWorkspaceScan: vi.fn()
}));

it("lists the picker's repositories, not every repository with saved state", async () => {
  const handlers = new Map<string, (message: unknown) => Promise<void>>();
  registerMessageHandlers(
    {
      post: vi.fn(),
      onMessage: (command: string, handler: (message: unknown) => Promise<void>) =>
        handlers.set(command, handler)
    } as unknown as Parameters<typeof registerMessageHandlers>[0],
    {
      config: { gitPath: () => "git", maxDepthOfRepoSearch: () => 2 },
      repoManager: {
        // Viewed once through File History in an earlier session.
        getRepos: () => ({ "/elsewhere/old": { columnWidths: null } }),
        pruneMissing: mocks.pruneMissing
      }
    } as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  const query = (repo: string) =>
    handlers.get("repositoryQuery")!({
      command: "repositoryQuery",
      repo,
      requestId: repo,
      query: { kind: "workspace" }
    });

  await query("/ws/b");
  await query("/ws/opened");
  expect(mocks.listRepos).toHaveBeenCalledWith("git", 2);
  expect(mocks.pruneMissing).toHaveBeenCalledTimes(2);
  expect(mocks.repositoryQuery.mock.calls.map((call) => call[2]?.repos)).toEqual([
    ["/ws/a", "/ws/b"],
    ["/ws/opened", "/ws/a", "/ws/b"]
  ]);
});

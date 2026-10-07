import { beforeEach, expect, test, vi } from "vitest";

import { cloneRepo, initializeRepo, openFolder } from "@/extension/handlers/initialize-repo";

const executeCommand = vi.hoisted(() => vi.fn());

vi.mock("vscode", () => ({ commands: { executeCommand } }));

beforeEach(() => executeCommand.mockReset());

test.each([undefined, "something"])(
  "runs VS Code's git.init alone and resolves true when it resolves %j",
  async (outcome) => {
    executeCommand.mockResolvedValueOnce(outcome);
    await expect(initializeRepo()).resolves.toBe(true);
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith("git.init");
  }
);

test("passes the command's failure on", async () => {
  const boom = new Error("boom");
  executeCommand.mockRejectedValueOnce(boom);
  await expect(initializeRepo()).rejects.toBe(boom);
});

test.each([
  ["cloneRepo", "git.clone", cloneRepo],
  ["openFolder", "vscode.openFolder", openFolder]
] as const)(
  "%s runs VS Code's %s alone and passes its failure on",
  async (_name, command, start) => {
    executeCommand.mockResolvedValueOnce(undefined);
    await expect(start()).resolves.toBe(true);
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(command);

    const boom = new Error("boom");
    executeCommand.mockRejectedValueOnce(boom);
    await expect(start()).rejects.toBe(boom);
  }
);

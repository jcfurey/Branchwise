import { beforeEach, expect, test, vi } from "vitest";

import { initializeRepo } from "@/extension/handlers/initialize-repo";

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

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import type { ExtensionState } from "@/old-extension/extensionState";
import { createRepoManager } from "@/old-extension/repoManager";
import type { GitRepoSet } from "@/types";

it("forgets saved state only for repositories whose folders no longer exist", async () => {
  const existing = mkdtempSync(path.join(os.tmpdir(), "ngg-saved-"));
  const deleted = path.join(existing, "deleted");
  const saved: GitRepoSet = {
    [existing]: { columnWidths: null, hiddenRemotes: ["origin"] },
    [deleted]: { columnWidths: null }
  };
  const saveRepos = vi.fn();
  const manager = createRepoManager({
    getRepos: () => saved,
    saveRepos
  } as unknown as ExtensionState);
  try {
    expect(await manager.pruneMissing()).toEqual([deleted]);
    expect(manager.getRepos()).toEqual({
      [existing]: { columnWidths: null, hiddenRemotes: ["origin"] }
    });
    expect(saveRepos).toHaveBeenCalledOnce();
    expect(await manager.pruneMissing()).toEqual([]);
    expect(saveRepos).toHaveBeenCalledOnce();
  } finally {
    rmSync(existing, { recursive: true, force: true });
  }
});

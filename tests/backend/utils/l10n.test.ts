import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";
import { afterEach, expect, it } from "vitest";

import { requireBranchName, requireRemote } from "@/backend/utils/validation";

const git = { getRemotes: async () => [] } as unknown as SimpleGit;

afterEach(() => {
  l10n.config({ contents: {} });
});

it("formats backend messages in English when no bundle is loaded", async () => {
  await expect(requireRemote(git, "origin")).rejects.toThrow(
    "Remote 'origin' is not configured for this repository."
  );
});

it("translates backend messages through the bundle the extension host loads", async () => {
  l10n.config({
    contents: {
      "Remote '{0}' is not configured for this repository.": "此仓库未配置远程仓库 '{0}'。",
      "Enter a valid branch name.": "请输入有效的分支名称。"
    }
  });
  await expect(requireRemote(git, "origin")).rejects.toThrow("此仓库未配置远程仓库 'origin'。");
  await expect(requireBranchName(git, "")).rejects.toThrow("请输入有效的分支名称。");
});

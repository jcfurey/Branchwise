import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { configuredGitPath, extConfig, wholeNumber } from "@/extension/config";

import { themeGraphColours } from "./manifest";

type Manifest = {
  contributes: { configuration: { properties: Record<string, { default: unknown }> } };
};

// The vscode mock hands back each fallback, so this compares the fallbacks with the manifest.
it("falls back to the defaults declared in package.json", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as Manifest;
  const declared = manifest.contributes.configuration.properties;
  const fallbacks = {
    autoCenterCommitDetailsView: extConfig.autoCenterCommitDetailsView(),
    branchHoverPreview: extConfig.branchHoverPreview(),
    commitHoverCards: extConfig.commitHoverCards(),
    conflictForecast: extConfig.conflictForecast(),
    dateFormat: extConfig.dateFormat(),
    dateSeparators: extConfig.dateSeparators(),
    dateType: extConfig.dateType(),
    dragAndDrop: extConfig.dragAndDrop(),
    graphStyle: extConfig.graphStyle(),
    initialLoadCommits: extConfig.initialLoadCommits(),
    loadMoreCommits: extConfig.loadMoreCommits(),
    markAppliedCommits: extConfig.markAppliedCommits(),
    maxDepthOfRepoSearch: extConfig.maxDepthOfRepoSearch(),
    nestedRepoSearchDepth: extConfig.nestedRepoSearchDepth(),
    rowDensity: extConfig.rowDensity(),
    overviewMarkers: extConfig.overviewMarkers(),
    showChangesColumn: extConfig.showChangesColumn(),
    showCurrentBranchByDefault: extConfig.showCurrentBranchByDefault(),
    showNearestBranch: extConfig.showNearestBranch(),
    showSignatures: extConfig.showSignatures(),
    showUncommittedChanges: extConfig.showUncommittedChanges(),
    showWorktrees: extConfig.showWorktrees(),
    singleKeyShortcuts: extConfig.singleKeyShortcuts(),
    tabIconColourTheme: extConfig.tabIconColourTheme()
  };
  for (const [key, value] of Object.entries(fallbacks)) {
    expect(value, key).toEqual(declared[`branchwise.${key}`]?.default);
  }
  // Unset, the colours come from the theme, whose defaults are the setting's default colours.
  expect(extConfig.graphColours()).toEqual(themeGraphColours);
  expect(extConfig.gitPath()).toBe("git");
});

it("resolves git.path values the way VS Code does", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ngg-git path ("));
  const existing = path.join(dir, "git");
  writeFileSync(existing, "");
  try {
    expect(configuredGitPath(undefined)).toBe("git");
    expect(configuredGitPath(null)).toBe("git");
    expect(configuredGitPath(" ")).toBe("git");
    expect(configuredGitPath(existing)).toBe(existing);
    expect(configuredGitPath("git-custom")).toBe("git-custom");
    expect(configuredGitPath([path.join(dir, "missing"), existing])).toBe(existing);
    expect(configuredGitPath([path.join(dir, "missing"), path.join(dir, "gone")])).toBe(
      path.join(dir, "missing")
    );
    expect(configuredGitPath([])).toBe("git");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("reads numeric settings as whole numbers within their range", () => {
  expect(wholeNumber(300.5, 1, 300)).toBe(300);
  expect(wholeNumber(-1, 1, 300)).toBe(1);
  expect(wholeNumber(0, 1, 300)).toBe(1);
  expect(wholeNumber(-2, 0, 0)).toBe(0);
  expect(wholeNumber(Number.NaN, 1, 300)).toBe(300);
  expect(wholeNumber(Number.POSITIVE_INFINITY, 1, 300)).toBe(300);
  expect(wholeNumber("500", 1, 300)).toBe(300);
  expect(wholeNumber(null, 1, 300)).toBe(300);
  expect(wholeNumber(42, 1, 300)).toBe(42);

  const settings: Record<string, unknown> = {
    initialLoadCommits: 300.5,
    loadMoreCommits: -1,
    maxDepthOfRepoSearch: "2"
  };
  const read = vi
    .spyOn(vscode.workspace, "getConfiguration")
    .mockReturnValue({ get: (key: string) => settings[key] } as never);
  try {
    expect(extConfig.initialLoadCommits()).toBe(300);
    expect(extConfig.loadMoreCommits()).toBe(1);
    expect(extConfig.maxDepthOfRepoSearch()).toBe(0);
  } finally {
    read.mockRestore();
  }
});

it("declares the numeric settings as integers with minimums", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as {
    contributes: {
      configuration: { properties: Record<string, { type: string; minimum?: number }> };
    };
  };
  const declared = manifest.contributes.configuration.properties;
  expect(declared["branchwise.initialLoadCommits"]).toMatchObject({
    type: "integer",
    minimum: 1
  });
  expect(declared["branchwise.loadMoreCommits"]).toMatchObject({ type: "integer", minimum: 1 });
  expect(declared["branchwise.maxDepthOfRepoSearch"]).toMatchObject({
    type: "integer",
    minimum: 0
  });
  expect(declared["branchwise.nestedRepoSearchDepth"]).toMatchObject({
    type: "integer",
    minimum: 0
  });
});

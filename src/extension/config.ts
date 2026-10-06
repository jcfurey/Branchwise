import { existsSync } from "node:fs";

import * as vscode from "vscode";

import type { ConflictForecastScope, DateType } from "@/backend/types";
import type { DateFormat, GraphStyle } from "@/types";

type TabIconColourTheme = "colour" | "grey";

/** The colours package.json declares as the default of `branchwise.graphColours`. */
const DEFAULT_GRAPH_COLOURS: readonly string[] = [
  "#0085d9",
  "#d9008f",
  "#00d90a",
  "#d98500",
  "#a300d9",
  "#ff0000",
  "#00d9cc",
  "#e138e8",
  "#85d900",
  "#dc5b23",
  "#6f24d6",
  "#ffcc00"
];

/**
 * The item `pattern` of `branchwise.graphColours` in package.json. Using the same rule means the
 * graph drops exactly the entries the Settings editor warns about.
 */
const GRAPH_COLOUR =
  /^\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\s*\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))\s*$/;

/** No count or depth setting goes above this, so an absurd value never reaches Git. */
const WHOLE_NUMBER_CEILING = 1_000_000;

/** The executable the built-in Git extension runs, once `resolveBuiltInGitPath` found it. */
let builtInGitPath: string | undefined;

/** Git extension exports, as far as this module reads them. */
type BuiltInGit = {
  getAPI(version: 1): { git?: { path?: unknown } } | undefined;
};

/**
 * Ask the built-in Git extension which executable it found, so the graph runs the same Git as
 * Source Control. Any failure leaves `gitPath` to the `git.path` setting. Never rejects: activation
 * starts this without waiting for it.
 */
export async function resolveBuiltInGitPath(): Promise<void> {
  let found: unknown;
  try {
    const extension = vscode.extensions.getExtension<BuiltInGit | undefined>("vscode.git");
    if (extension !== undefined) {
      const api = extension.isActive ? extension.exports : await extension.activate();
      // getAPI throws when the user disabled the extension with `git.enabled: false`.
      found = api?.getAPI(1)?.git?.path;
    }
  } catch {
    found = undefined;
  }
  builtInGitPath = typeof found === "string" && found !== "" ? found : undefined;
}

/**
 * The executable named by VS Code's `git.path` setting, which holds one path or a list of them.
 * The first candidate found on disk wins, then the first candidate at all, and without any the
 * operating system looks `git` up on the PATH.
 */
export function configuredGitPath(value: unknown): string {
  const candidates = (Array.isArray(value) ? value : [value]).filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== ""
  );
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? "git";
}

/**
 * A count or depth setting as an integer from `minimum` to one million. A value that is not a
 * finite number yields `fallback`, which is returned as it is.
 */
export function wholeNumber(value: unknown, minimum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  // Math.max also turns -0 into 0.
  return Math.min(Math.max(Math.floor(value), minimum), WHOLE_NUMBER_CEILING);
}

/** A Branchwise setting, read afresh on every call so changes apply at once. */
function setting<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("branchwise").get<T>(key, fallback);
}

function wholeNumberSetting(key: string, minimum: number, fallback: number): number {
  return wholeNumber(setting<unknown>(key, fallback), minimum, fallback);
}

/** The entries of the colour list that the graph can draw, in their order and as written. */
function graphColours(): string[] {
  const stored = setting<unknown>("graphColours", DEFAULT_GRAPH_COLOURS);
  // A list is required; anything else counts as no setting at all.
  const colours: readonly unknown[] = Array.isArray(stored) ? stored : DEFAULT_GRAPH_COLOURS;
  // The test reads each entry's string form, so a non-string entry that reads as a colour (such
  // as ["#000000"]) is kept as it is.
  return colours.filter((colour) => GRAPH_COLOUR.test(String(colour))) as string[];
}

/**
 * Branchwise settings as the rest of the extension reads them. The defaults match package.json.
 * Members never use `this`, so callers may pass them around on their own.
 */
export const extConfig = {
  autoCenterCommitDetailsView: () => setting<boolean>("autoCenterCommitDetailsView", true),
  conflictForecast: () => setting<ConflictForecastScope>("conflictForecast", "localAndRemote"),
  dateFormat: () => setting<DateFormat>("dateFormat", "Date & Time"),
  dateType: () => setting<DateType>("dateType", "Author Date"),
  dragAndDrop: () => setting<boolean>("dragAndDrop", true),
  /** The built-in Git extension's executable when known, otherwise the `git.path` setting. */
  gitPath: (): string =>
    builtInGitPath ?? configuredGitPath(vscode.workspace.getConfiguration("git").get("path")),
  graphColours,
  graphStyle: () => setting<GraphStyle>("graphStyle", "rounded"),
  initialLoadCommits: () => wholeNumberSetting("initialLoadCommits", 1, 300),
  loadMoreCommits: () => wholeNumberSetting("loadMoreCommits", 1, 100),
  maxDepthOfRepoSearch: () => wholeNumberSetting("maxDepthOfRepoSearch", 0, 0),
  nestedRepoSearchDepth: () => wholeNumberSetting("nestedRepoSearchDepth", 0, 3),
  showCurrentBranchByDefault: () => setting<boolean>("showCurrentBranchByDefault", false),
  showUncommittedChanges: () => setting<boolean>("showUncommittedChanges", true),
  tabIconColourTheme: () => setting<TabIconColourTheme>("tabIconColourTheme", "colour")
};

export type Config = typeof extConfig;

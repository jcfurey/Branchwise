import * as vscode from "vscode";

import { logger } from "@/extension/util/logger";
import type { IssueLink } from "@/types";

/** The longest pattern accepted. A longer one is refused rather than cut short. */
export const ISSUE_LINK_PATTERN_LIMIT = 200;

/**
 * Short texts each pattern is tried at every position of. A pattern that matches empty text at
 * any of them, such as `x*` or `\b`, would link nothing while matching everywhere.
 */
const PROBES = ["", " ", "a", "Z", "0", "-", "#", "/", "ABC-123 fix #4"];

const text = {
  notAList: () =>
    vscode.l10n.t(
      "branchwise.issueLinks must be a list of entries with a pattern and a url. No custom issue links are used."
    ),
  skipped: (index: number, reason: string) =>
    vscode.l10n.t("Skipped entry {0} of branchwise.issueLinks: {1}", index, reason),
  notAnEntry: () => vscode.l10n.t("it must be an object with a pattern and a url."),
  noPattern: () => vscode.l10n.t("its pattern is empty."),
  tooLong: () =>
    vscode.l10n.t("its pattern is longer than {0} characters.", String(ISSUE_LINK_PATTERN_LIMIT)),
  invalidPattern: (reason: string) =>
    vscode.l10n.t("its pattern is not a valid regular expression ({0}).", reason),
  emptyMatch: () => vscode.l10n.t("its pattern can match empty text."),
  notWeb: () => vscode.l10n.t("its url must be an http: or https: address.")
};

/** Problems already reported, so that each one is logged once however often settings are read. */
const reported = new Set<string>();

function warnOnce(message: string) {
  if (!reported.has(message)) {
    reported.add(message);
    logger.warn(message);
  }
}

/** Whether `expression`, which is sticky, matches empty text at some position of `probe`. */
function matchesEmptyText(expression: RegExp, probe: string) {
  for (let at = 0; at <= probe.length; at++) {
    expression.lastIndex = at;
    if (expression.exec(probe)?.[0] === "") {
      return true;
    }
  }
  return false;
}

/**
 * Whether `url` is a web address once `$0` to `$9` are filled in. Only the scheme and the host
 * are checked, and both must be written out: a placeholder cannot supply the scheme.
 */
function isWebTemplate(url: string) {
  if (!/^https?:\/\/[^/\s]/i.test(url)) {
    return false;
  }
  try {
    return ["http:", "https:"].includes(new URL(url.replaceAll(/\$\d/g, "0")).protocol);
  } catch {
    return false;
  }
}

/** Why an entry of the setting cannot be used, or `null` when it can. */
function entryProblem(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return text.notAnEntry();
  }
  const { pattern, url } = entry as Record<string, unknown>;
  if (typeof pattern !== "string" || typeof url !== "string") {
    return text.notAnEntry();
  }
  if (pattern === "") {
    return text.noPattern();
  }
  if (pattern.length > ISSUE_LINK_PATTERN_LIMIT) {
    return text.tooLong();
  }
  let expression: RegExp;
  try {
    // Sticky, so each try below matches at exactly the position it is given.
    expression = new RegExp(pattern, "y");
  } catch (error) {
    return text.invalidPattern(error instanceof Error ? error.message : String(error));
  }
  if (PROBES.some((probe) => matchesEmptyText(expression, probe))) {
    return text.emptyMatch();
  }
  return isWebTemplate(url) ? null : text.notWeb();
}

/**
 * The usable entries of `branchwise.issueLinks`, in order. Every other entry is left out, and
 * why is logged once to the output channel.
 */
export function readIssueLinks(value: unknown): IssueLink[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    warnOnce(text.notAList());
    return [];
  }
  const links: IssueLink[] = [];
  value.forEach((entry: unknown, index) => {
    const problem = entryProblem(entry);
    if (problem === null) {
      const { pattern, url } = entry as IssueLink;
      links.push({ pattern, url });
    } else {
      // Counted from 1, as people number the entries of a list.
      warnOnce(text.skipped(index + 1, problem));
    }
  });
  return links;
}

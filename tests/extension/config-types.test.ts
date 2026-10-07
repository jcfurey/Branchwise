import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { ConflictForecastScope } from "@/backend/types";
import type { DateFormat, GraphStyle, WebviewConfig } from "@/types";

/** The `enum` that package.json declares for the setting `branchwise.<key>`. */
function manifestChoices(key: string): Array<string> {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { contributes: { configuration: { properties: Record<string, { enum?: Array<string> }> } } };
  return manifest.contributes.configuration.properties[`branchwise.${key}`]?.enum ?? [];
}

const settings: WebviewConfig = {
  autoCenterCommitDetailsView: false,
  branchHoverPreview: true,
  commitHoverCards: true,
  conflictForecast: "localAndRemote",
  dateFormat: "Relative",
  dateSeparators: true,
  dragAndDrop: true,
  graphColours: ["#123456"],
  graphStyle: "angular",
  initialLoadCommits: 50,
  issueLinks: [],
  loadMoreCommits: 25,
  markAppliedCommits: true,
  locale: "de",
  overviewMarkers: true,
  showChangesColumn: false,
  showCurrentBranchByDefault: true,
  showNearestBranch: true,
  showWorktrees: true,
  singleKeyShortcuts: true
};

/** Edits a configuration in place, which the types forbid. Compiled, never called. */
function editInPlace(config: WebviewConfig) {
  // @ts-expect-error: the page replaces its settings wholesale.
  config.locale = "fr";
  // @ts-expect-error: the palette is read-only as well.
  config.graphColours.push("#fff");
}

describe("WebviewConfig", () => {
  it("cannot be changed in place, only replaced", () => {
    const palette: Array<string> = ["#abcdef"];
    const replaced: WebviewConfig = { ...settings, graphColours: palette };

    expect(editInPlace).toBeTypeOf("function");
    expect(replaced.graphColours).toBe(palette);
  });

  it("holds exactly the twenty display settings", () => {
    expectTypeOf<keyof WebviewConfig>().toEqualTypeOf<
      | "autoCenterCommitDetailsView"
      | "branchHoverPreview"
      | "commitHoverCards"
      | "conflictForecast"
      | "dateFormat"
      | "dateSeparators"
      | "dragAndDrop"
      | "graphColours"
      | "graphStyle"
      | "initialLoadCommits"
      | "issueLinks"
      | "loadMoreCommits"
      | "locale"
      | "markAppliedCommits"
      | "overviewMarkers"
      | "showChangesColumn"
      | "showCurrentBranchByDefault"
      | "showNearestBranch"
      | "showWorktrees"
      | "singleKeyShortcuts"
    >();
    expect(Object.keys(settings)).toHaveLength(20);
  });
});

describe("setting choices", () => {
  // Keyed by the union, so a missing or an extra member fails to compile.
  const dateFormats: Record<DateFormat, true> = {
    "Date & Time": true,
    "Date Only": true,
    Relative: true
  };
  const graphStyles: Record<GraphStyle, true> = { rounded: true, angular: true };
  const forecastScopes: Record<ConflictForecastScope, true> = {
    localAndRemote: true,
    local: true,
    off: true
  };

  it("match the date formats package.json offers", () => {
    const offered = manifestChoices("dateFormat").toSorted();

    expect(offered).toEqual(["Date & Time", "Date Only", "Relative"]);
    expect(Object.keys(dateFormats).toSorted()).toEqual(offered);
  });

  it("match the graph styles package.json offers", () => {
    const offered = manifestChoices("graphStyle").toSorted();

    expect(offered).toEqual(["angular", "rounded"]);
    expect(Object.keys(graphStyles).toSorted()).toEqual(offered);
  });

  it("match the conflict forecast scopes package.json offers", () => {
    const offered = manifestChoices("conflictForecast").toSorted();

    expect(offered).toEqual(["local", "localAndRemote", "off"]);
    expect(Object.keys(forecastScopes).toSorted()).toEqual(offered);
  });
});

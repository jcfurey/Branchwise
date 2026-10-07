import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

import { configuredGitPath, extConfig, wholeNumber } from "@/extension/config";

import {
  declaredColours,
  declaredGraphColours,
  declaredSetting,
  themeGraphColours
} from "./manifest";

/** What the user stored under `branchwise.*`; a missing key makes VS Code hand back the default. */
const stored = vi.hoisted(() => new Map<string, unknown>());
const sections = vi.hoisted(() => [] as string[]);

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration(section: string) {
      sections.push(section);
      return {
        get: (key: string, fallback?: unknown) => (stored.has(key) ? stored.get(key) : fallback),
        // What the user stored is stored in the user settings.
        inspect: (key: string) => (stored.has(key) ? { globalValue: stored.get(key) } : undefined)
      };
    }
  }
}));

const scratch = mkdtempSync(join(tmpdir(), "branchwise config "));
const executable = join(scratch, "git-bin");
const folder = join(scratch, "a folder");
writeFileSync(executable, "");
mkdirSync(folder);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => {
  stored.clear();
  sections.length = 0;
});

describe("graph colours", () => {
  test("keeps only the entries in a drawable colour format, unchanged and in order", () => {
    stored.set("graphColours", [
      "#abcdef",
      " #ABCDEF ",
      "#abcdef12",
      "#fff",
      "red",
      "rgb(1,2,3)",
      "rgba(1, 2, 3)",
      "rgba(1,2,3,0.5)",
      "rgb (999,  0,0)",
      "rgb( 1,2,3)",
      "rgb(1 ,2,3)",
      5,
      null,
      "#abcdefg",
      "\t#000000\n"
    ]);
    expect(extConfig.graphColours()).toEqual([
      "#abcdef",
      " #ABCDEF ",
      "#abcdef12",
      "rgb(1,2,3)",
      "rgba(1, 2, 3)",
      "rgb (999,  0,0)",
      "\t#000000\n"
    ]);
  });

  test("judges each entry by its string form, as the manifest pattern does", () => {
    stored.set("graphColours", [
      ["#000000"],
      { a: 1 },
      true,
      "#00000",
      "#0000000",
      "RGB(1,2,3)",
      "rgb(1,2,3) ",
      "rgb(1,2)",
      "rgb(1000,2,3)",
      "rgb(1,\t2,\n3)",
      "#GGGGGG",
      "  #aAbBcC"
    ]);
    expect(extConfig.graphColours()).toEqual([
      ["#000000"],
      "rgb(1,2,3) ",
      "rgb(1,\t2,\n3)",
      "  #aAbBcC"
    ]);
  });

  test("agrees with the item pattern that package.json declares", () => {
    const pattern = new RegExp(declaredSetting("graphColours").items?.pattern ?? "(?!)");
    const samples = [
      "#123456",
      "#12345678",
      "#1234567",
      "#123",
      "rgba(0, 0, 0)",
      "rgb(0,0,0,0)",
      " rgb(10,20,30) ",
      "hsl(1, 2%, 3%)",
      "transparent",
      ""
    ];
    stored.set("graphColours", samples);
    expect(extConfig.graphColours()).toEqual(samples.filter((sample) => pattern.test(sample)));
  });

  test("returns a new list each time", () => {
    const list = ["#000000"];
    stored.set("graphColours", list);
    const first = extConfig.graphColours();
    expect(first).toEqual(list);
    expect(first).not.toBe(list);
    expect(extConfig.graphColours()).not.toBe(first);
  });

  test("yields an empty list when nothing stored is drawable", () => {
    stored.set("graphColours", []);
    expect(extConfig.graphColours()).toEqual([]);
    stored.set("graphColours", ["blue", 7]);
    expect(extConfig.graphColours()).toEqual([]);
  });

  // Decision config Q1: a value that is not a list counts as unset instead of throwing.
  test.each([["red"], [null], [{ 0: "#000000" }], [42], [true]])(
    "falls back to the theme's colours when the setting holds %j",
    (value) => {
      stored.set("graphColours", value);
      expect(() => extConfig.graphColours()).not.toThrow();
      expect(extConfig.graphColours()).toEqual(themeGraphColours);
      expect(declaredGraphColours).toHaveLength(12);
    }
  );

  test("uses the theme's lane colours until the user sets a list anywhere", () => {
    expect(extConfig.graphColours()).toEqual(themeGraphColours);
    expect(themeGraphColours[0]).toBe("var(--vscode-branchwise-graphLane1, #0085d9)");
    expect(themeGraphColours[11]).toBe("var(--vscode-branchwise-graphLane12, #ffcc00)");

    // A list the user wrote is theirs, even when it is the default one.
    stored.set("graphColours", [...declaredGraphColours]);
    expect(extConfig.graphColours()).toEqual(declaredGraphColours);
  });

  test.each(["workspaceValue", "workspaceFolderValue"])(
    "counts a list set as the %s as set",
    async (scope) => {
      const vscode = await import("vscode");
      const spy = vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
        get: () => ["#123456"],
        inspect: () => ({ [scope]: ["#123456"] })
      } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>);
      try {
        expect(extConfig.graphColours()).toEqual(["#123456"]);
      } finally {
        spy.mockRestore();
      }
    }
  );
});

describe("theme colours", () => {
  const themes = ["dark", "light", "highContrast", "highContrastLight"] as const;
  const byId = new Map(declaredColours.map((colour) => [colour.id, colour]));

  test("contributes twelve lane colours, the unpushed dot and the conflict mark", () => {
    expect(declaredColours.map((colour) => colour.id)).toEqual([
      ...declaredGraphColours.map((_colour, index) => `branchwise.graphLane${index + 1}`),
      "branchwise.unpushed",
      "branchwise.conflict"
    ]);
    for (const colour of declaredColours) {
      expect(colour.description).toBe(`%colors.${colour.id.slice("branchwise.".length)}%`);
    }
  });

  test("defaults every lane, in every kind of theme, to the colour the graph always used", () => {
    declaredGraphColours.forEach((hex, index) => {
      const lane = byId.get(`branchwise.graphLane${index + 1}`)!;
      for (const theme of themes) {
        expect(lane.defaults[theme], `${lane.id} ${theme}`).toBe(hex);
      }
    });
  });

  test("defaults the unpushed dot and the conflict mark to the Git colours they used", () => {
    for (const theme of themes) {
      expect(byId.get("branchwise.unpushed")!.defaults[theme]).toBe(
        "gitDecoration.modifiedResourceForeground"
      );
      expect(byId.get("branchwise.conflict")!.defaults[theme]).toBe(
        "gitDecoration.conflictingResourceForeground"
      );
    }
  });
});

describe("settings passed through", () => {
  test("hands on booleans and choices as VS Code returns them", () => {
    stored.set("dateFormat", "Nonsense");
    stored.set("graphStyle", 7);
    stored.set("tabIconColourTheme", "blue");
    stored.set("autoCenterCommitDetailsView", "yes");
    expect(extConfig.dateFormat()).toBe("Nonsense");
    expect(extConfig.graphStyle()).toBe(7);
    expect(extConfig.tabIconColourTheme()).toBe("blue");
    expect(extConfig.autoCenterCommitDetailsView()).toBe("yes");
  });

  test("reads the branchwise section again on every call", () => {
    stored.set("graphStyle", "angular");
    expect(extConfig.graphStyle()).toBe("angular");
    stored.set("graphStyle", "rounded");
    expect(extConfig.graphStyle()).toBe("rounded");
    expect(sections).toEqual(["branchwise", "branchwise"]);
  });

  test("offers exactly the nineteen getters", () => {
    expect(Object.keys(extConfig).toSorted()).toEqual([
      "autoCenterCommitDetailsView",
      "conflictForecast",
      "dateFormat",
      "dateType",
      "dragAndDrop",
      "gitPath",
      "graphColours",
      "graphStyle",
      "initialLoadCommits",
      "issueLinks",
      "loadMoreCommits",
      "maxDepthOfRepoSearch",
      "nestedRepoSearchDepth",
      "rowDensity",
      "showCurrentBranchByDefault",
      "showSignatures",
      "showUncommittedChanges",
      "singleKeyShortcuts",
      "tabIconColourTheme"
    ]);
  });
});

describe("whole-number settings", () => {
  test("round down and respect each lower bound", () => {
    stored.set("initialLoadCommits", 2.9);
    stored.set("loadMoreCommits", -0.5);
    stored.set("maxDepthOfRepoSearch", -0.5);
    expect(extConfig.initialLoadCommits()).toBe(2);
    expect(extConfig.loadMoreCommits()).toBe(1);
    expect(extConfig.maxDepthOfRepoSearch()).toBe(0);
  });

  test("fall back to their defaults for values that are not finite numbers", () => {
    stored.set("initialLoadCommits", Number.NaN);
    stored.set("loadMoreCommits", true);
    stored.set("maxDepthOfRepoSearch", "3");
    expect(extConfig.initialLoadCommits()).toBe(300);
    expect(extConfig.loadMoreCommits()).toBe(100);
    expect(extConfig.maxDepthOfRepoSearch()).toBe(0);
  });

  // Decision config Q4: nothing above one million reaches Git.
  test("stop at one million", () => {
    stored.set("initialLoadCommits", 1e21);
    stored.set("loadMoreCommits", 1_000_000.75);
    stored.set("maxDepthOfRepoSearch", 7_654_321);
    expect(extConfig.initialLoadCommits()).toBe(1_000_000);
    expect(extConfig.loadMoreCommits()).toBe(1_000_000);
    expect(extConfig.maxDepthOfRepoSearch()).toBe(1_000_000);
    stored.set("maxDepthOfRepoSearch", 3.99);
    expect(extConfig.maxDepthOfRepoSearch()).toBe(3);
  });
});

describe("wholeNumber", () => {
  test.each<[unknown, number, number, number]>([
    [2.9, 1, 9, 2],
    [-0.5, 0, 9, 0],
    [5, 10, 1, 10],
    [999_999, 1, 3, 999_999],
    [new Number(3), 1, 9, 9],
    [3n, 1, 9, 9],
    [Number.NEGATIVE_INFINITY, 0, 4, 4],
    [undefined, 1, -5, -5],
    [{ valueOf: () => 8 }, 1, 6, 6]
  ])("turns %o (minimum %d, fallback %d) into %d", (value, minimum, fallback, expected) => {
    expect(wholeNumber(value, minimum, fallback)).toBe(expected);
  });

  test("gives positive zero for negative zero", () => {
    expect(Object.is(wholeNumber(-0, 0, 9), 0)).toBe(true);
  });

  test("caps usable numbers at one million but hands back the fallback as given", () => {
    expect(wholeNumber(1_000_001, 0, 7)).toBe(1_000_000);
    expect(wholeNumber(Number.MAX_VALUE, 1, 7)).toBe(1_000_000);
    expect(wholeNumber("big", 1, 5_000_000)).toBe(5_000_000);
  });
});

describe("configuredGitPath", () => {
  test("accepts an existing directory", () => {
    expect(configuredGitPath(folder)).toBe(folder);
  });

  test("returns a candidate as written, without trimming it", () => {
    expect(configuredGitPath(` ${executable}`)).toBe(` ${executable}`);
  });

  test("skips entries that are not text when looking for one that exists", () => {
    expect(configuredGitPath([5, executable])).toBe(executable);
    expect(configuredGitPath([" ", 5, null, "a-missing"])).toBe("a-missing");
  });

  test.each([[""], [["", "  "]], [["", "  ", "\t"]], [{ path: executable }], [7]])(
    "leaves the lookup to the PATH for %j",
    (value) => {
      expect(configuredGitPath(value)).toBe("git");
    }
  );
});

import { beforeEach, expect, test, vi } from "vitest";

import { webviewConfig, webviewInitialize } from "@/extension/handlers/initialize";

import { themeGraphColours } from "./manifest";

const settings = vi.hoisted(() => ({
  language: "fr",
  values: new Map<string, unknown>()
}));

vi.mock("vscode", () => ({
  env: {
    get language() {
      return settings.language;
    }
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) =>
        settings.values.has(key) ? settings.values.get(key) : fallback,
      inspect: (key: string) =>
        settings.values.has(key) ? { globalValue: settings.values.get(key) } : undefined
    })
  }
}));
vi.mock("@/old-extension/l10n/webviewL10n", () => ({
  getWebviewLocalizedStrings: () => ({ a: "A" })
}));

const DEFAULT_CONFIG = {
  autoCenterCommitDetailsView: true,
  conflictForecast: "localAndRemote",
  dateFormat: "Date & Time",
  dragAndDrop: true,
  graphColours: themeGraphColours,
  graphStyle: "rounded",
  initialLoadCommits: 300,
  issueLinks: [],
  loadMoreCommits: 100,
  locale: "fr",
  overviewMarkers: true,
  showCurrentBranchByDefault: false,
  singleKeyShortcuts: true
};

beforeEach(() => {
  settings.language = "fr";
  settings.values.clear();
});

test("holds exactly the display settings, with their defaults and the display language", () => {
  expect(webviewConfig()).toStrictEqual(DEFAULT_CONFIG);
});

test("carries the sanitized values of stored settings", () => {
  settings.values.set("initialLoadCommits", 12.7);
  settings.values.set("graphColours", ["bad", "#123456"]);
  settings.values.set("dateFormat", "Relative");
  settings.values.set("dateType", "Commit Date");
  expect(webviewConfig()).toStrictEqual({
    ...DEFAULT_CONFIG,
    dateFormat: "Relative",
    graphColours: ["#123456"],
    initialLoadCommits: 12
  });
});

test("reads everything again on each call", () => {
  const before = webviewConfig();
  settings.values.set("graphStyle", "angular");
  settings.language = "de";
  const after = webviewConfig();
  expect(before).toMatchObject({ graphStyle: "rounded", locale: "fr" });
  expect(after).toMatchObject({ graphStyle: "angular", locale: "de" });
  expect(webviewConfig()).not.toBe(after);
});

// Decisions config Q1 and Q4 as the page sees them: it still opens, with sane values.
test("opens the page with default colours and capped counts for unusable settings", () => {
  settings.values.set("graphColours", "#123456");
  settings.values.set("loadMoreCommits", 5e9);
  expect(webviewConfig()).toMatchObject({
    graphColours: DEFAULT_CONFIG.graphColours,
    loadMoreCommits: 1_000_000
  });
});

test("answers webview.initialize with the strings first, then the settings", async () => {
  const answer = await webviewInitialize();
  expect(answer).toStrictEqual({ l10n: { a: "A" }, config: webviewConfig() });
  expect(Object.keys(answer)).toEqual(["l10n", "config"]);
});

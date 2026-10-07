// @vitest-environment jsdom
// Pins the parts of the two shared modules that other webview tests lean on without saying so.
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
  onTestFinished,
  vi
} from "vitest";

import type { QueryRequest } from "@/backend/types";
import type { WebviewConfig } from "@/types";
import * as settingsHolder from "@/webview/lib/webview-config";

import * as setup from "@tests/webview/setup";
import * as helpers from "@tests/webview/test-utils";

type SettingsModule = typeof import("@/webview/lib/webview-config");
type RpcClientModule = typeof import("@/webview/lib/rpc/rpc-client");
type DispatcherModule = typeof import("@/webview/lib/dispatcher");

/** The settings the helper must hand over; other tests assert on each of these values. */
const expectedSettings: WebviewConfig = {
  autoCenterCommitDetailsView: true,
  conflictForecast: "localAndRemote",
  dateFormat: "Date & Time",
  dragAndDrop: true,
  graphColours: [],
  graphStyle: "rounded",
  initialLoadCommits: 300,
  issueLinks: [],
  loadMoreCommits: 100,
  locale: "en",
  overviewMarkers: true,
  showCurrentBranchByDefault: false,
  singleKeyShortcuts: true
};

// The global as the setup file installed it for this file, put back after every test.
const installedGlobal = Object.getOwnPropertyDescriptor(globalThis, "acquireVsCodeApi");
let installedStrings: PropertyDescriptor | undefined;
let firstSetupResult: unknown = "not called";

beforeAll(() => {
  firstSetupResult = helpers.setupWebviewTest();
  installedStrings = Object.getOwnPropertyDescriptor(window, "l10n");
});

afterEach(() => {
  vi.doUnmock("@/webview/lib/webview-config");
  vi.doUnmock("@/webview/lib/rpc/rpc-client");
  vi.doUnmock("@/webview/lib/dispatcher");
  if (installedGlobal !== undefined) {
    Object.defineProperty(globalThis, "acquireVsCodeApi", installedGlobal);
  }
  if (installedStrings !== undefined) {
    Object.defineProperty(window, "l10n", installedStrings);
  }
});

/** A newly evaluated copy of the helpers, with its own setup module and product modules. */
async function freshHelpers() {
  vi.resetModules();
  return import("@tests/webview/test-utils");
}

/** Counts the `message` listeners added to the window from now until the test ends. */
function countMessageListeners(): () => number {
  const spy = vi.spyOn(window, "addEventListener");
  onTestFinished(() => spy.mockRestore());
  return () => spy.mock.calls.filter(([type]) => type === "message").length;
}

describe("the setup module", () => {
  it("exports the API stand-in and nothing else", () => {
    expect(Object.keys(setup)).toEqual(["vscodeApi"]);
    expect(Object.hasOwn(setup, "default")).toBe(false);
  });

  it("builds the stand-in from three mock functions, in a fixed order", () => {
    expect(Object.getOwnPropertyNames(setup.vscodeApi)).toEqual([
      "getState",
      "setState",
      "postMessage"
    ]);
    for (const member of Object.values(setup.vscodeApi)) {
      expect(vi.isMockFunction(member)).toBe(true);
    }
  });

  it("has the mocks answer undefined, not null, until a test decides otherwise", () => {
    expect(setup.vscodeApi.getState()).toBe(undefined);
    expect(setup.vscodeApi.setState({ scroll: 12 })).toBe(undefined);
    expect(setup.vscodeApi.postMessage({ command: "ping" })).toBe(undefined);
  });

  it("installs acquireVsCodeApi as a hidden, read-only but replaceable mock", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "acquireVsCodeApi");

    expect(descriptor).toMatchObject({ configurable: true, enumerable: false, writable: false });
    expect(vi.isMockFunction(descriptor?.value)).toBe(true);
    expect(acquireVsCodeApi()).toBe(setup.vscodeApi);
    expect(acquireVsCodeApi()).toBe(setup.vscodeApi);

    const replacement = vi.fn(() => setup.vscodeApi);
    Object.defineProperty(globalThis, "acquireVsCodeApi", {
      value: replacement,
      configurable: true
    });
    expect(acquireVsCodeApi).toBe(replacement);
  });

  it("neither calls the global, defines strings, nor fakes timers while it loads", async () => {
    Reflect.deleteProperty(window, "l10n");
    vi.resetModules();

    await import("@tests/webview/setup");

    expect(vi.mocked(acquireVsCodeApi).mock.calls).toEqual([]);
    expect("l10n" in window).toBe(false);
    expect(Object.keys(document.documentElement.dataset)).toEqual([]);
    expect(vi.isFakeTimers()).toBe(false);
  });

  it("makes a new stand-in, and a global that hands it out, when loaded after a reset", async () => {
    const previousGlobal = acquireVsCodeApi;
    vi.resetModules();

    const again = await import("@tests/webview/setup");

    expect(again.vscodeApi).not.toBe(setup.vscodeApi);
    expect(acquireVsCodeApi).not.toBe(previousGlobal);
    expect(acquireVsCodeApi()).toBe(again.vscodeApi);
  });
});

describe("the mocks from one test to the next", () => {
  const posted = { command: "carried-over" };
  const saved = { kept: "between tests" };

  it("are used by a first test", () => {
    setup.vscodeApi.postMessage(posted);
    setup.vscodeApi.setState(saved);
    setup.vscodeApi.getState.mockReturnValue(saved);
  });

  it("still hold its calls and its return values in the next", () => {
    expect(setup.vscodeApi.postMessage).toHaveBeenCalledWith(posted);
    expect(setup.vscodeApi.setState).toHaveBeenCalledWith(saved);
    expect(setup.vscodeApi.getState()).toBe(saved);

    setup.vscodeApi.getState.mockReset();
    expect(setup.vscodeApi.getState()).toBe(undefined);
  });
});

describe("setupWebviewTest", () => {
  it("is one of exactly two exports", () => {
    expect(Object.keys(helpers)).toEqual(["latestGraphRequest", "setupWebviewTest"]);
    expect(typeof helpers.latestGraphRequest).toBe("function");
    expect(typeof helpers.setupWebviewTest).toBe("function");
  });

  it("returns nothing, and leaves the page with the shared settings", () => {
    expect(firstSetupResult).toBe(undefined);
    expect(settingsHolder.getWebviewConfig()).toStrictEqual(expectedSettings);
  });

  it("leaves the settings, and their palette, open to changes in place", () => {
    const settings = settingsHolder.getWebviewConfig();
    expect(Object.isFrozen(settings)).toBe(false);
    expect(Object.isFrozen(settings.graphColours)).toBe(false);

    Object.assign(settings, { locale: "pt-br", loadMoreCommits: 42 });
    expect(settingsHolder.getWebviewConfig()).toMatchObject({
      locale: "pt-br",
      loadMoreCommits: 42
    });
    Object.assign(settings, { locale: "en", loadMoreCommits: 100 });
  });

  it("passes the same settings object on every call", async () => {
    const initialize = vi.fn<SettingsModule["initializeWebviewConfig"]>();
    vi.doMock("@/webview/lib/webview-config", async (importOriginal) => ({
      ...(await importOriginal<SettingsModule>()),
      initializeWebviewConfig: initialize
    }));
    const fresh = await freshHelpers();

    fresh.setupWebviewTest();
    fresh.setupWebviewTest();

    expect(initialize).toHaveBeenCalledTimes(2);
    const [first, second] = initialize.mock.calls.map(([settings]) => settings);
    expect(first).toBe(second);
    expect(first).toStrictEqual(expectedSettings);
  });

  it("refuses a second call in one module graph before it touches anything else", async () => {
    const fresh = await freshHelpers();
    fresh.setupWebviewTest();
    const earlierStrings = { placeholder: "kept" };
    Object.defineProperty(window, "l10n", { value: earlierStrings, configurable: true });

    const added = countMessageListeners();

    expect(() => fresh.setupWebviewTest({ dispatchMessages: true })).toThrowError(
      /^Webview configuration is already initialized$/
    );
    expect(window.l10n).toBe(earlierStrings);
    expect(added()).toBe(0);
  });

  it("gives window.l10n every key as its own name", () => {
    const strings: object = window.l10n;

    expect(window.l10n.repo).toBe("repo");
    expect(window.l10n.branchDisplay).toBe("branchDisplay");
    expect(Reflect.get(strings, "surelyNotAString")).toBe("surelyNotAString");
    expect(Reflect.get(strings, Symbol.asyncIterator)).toBe("Symbol(Symbol.asyncIterator)");
  });

  it("gives window.l10n no keys of its own", () => {
    expect("repo" in window.l10n).toBe(false);
    expect(Object.keys(window.l10n)).toEqual([]);
    expect(JSON.stringify(window.l10n)).toBe("{}");
  });

  it("defines window.l10n so that a test can define it again", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "l10n");
    expect(descriptor).toMatchObject({ configurable: true, enumerable: false, writable: false });

    const other = { repo: "Depot" };
    Object.defineProperty(window, "l10n", { value: other, configurable: true });
    expect(window.l10n).toBe(other);
  });

  it.each([
    ["no options", undefined],
    ["empty options", {}],
    ["dispatchMessages: false", { dispatchMessages: false }]
  ])("adds no message listener with %s", async (_label, options) => {
    const fresh = await freshHelpers();
    const added = countMessageListeners();

    fresh.setupWebviewTest(options);

    expect(added()).toBe(0);
  });

  it("adds the RPC and dispatcher listeners with dispatchMessages: true", async () => {
    const fresh = await freshHelpers();
    const added = countMessageListeners();

    fresh.setupWebviewTest({ dispatchMessages: true });

    expect(added()).toBe(2);
  });

  it("starts the RPC client before the dispatcher, and neither by default", async () => {
    const init = vi.fn();
    const initDispatcher = vi.fn();
    vi.doMock("@/webview/lib/rpc/rpc-client", async (importOriginal) => {
      const original = await importOriginal<RpcClientModule>();
      return { rpcClient: { ...original.rpcClient, init } };
    });
    vi.doMock("@/webview/lib/dispatcher", async (importOriginal) => ({
      ...(await importOriginal<DispatcherModule>()),
      initDispatcher
    }));

    const quiet = await freshHelpers();
    quiet.setupWebviewTest();
    expect(init).not.toHaveBeenCalled();
    expect(initDispatcher).not.toHaveBeenCalled();

    const listening = await freshHelpers();
    listening.setupWebviewTest({ dispatchMessages: true });
    expect(init).toHaveBeenCalledOnce();
    expect(initDispatcher).toHaveBeenCalledOnce();
    expect(init.mock.invocationCallOrder[0]).toBeLessThan(
      initDispatcher.mock.invocationCallOrder[0] ?? 0
    );
  });
});

/** A graph query as the page would post it. */
function query(command: string, requestId: string) {
  return { command, repo: "/srv/checkouts/orchard", requestId };
}

describe("latestGraphRequest", () => {
  it("returns the newest posted query of the kind asked for, as the object posted", () => {
    setup.vscodeApi.postMessage.mockClear();
    const olderCommits = query("loadCommits", "q-1");
    const branches = query("loadBranches", "q-2");
    const details = query("commitDetails", "q-3");
    const newerCommits = query("loadCommits", "q-4");
    for (const message of [
      olderCommits,
      { kind: "rpc.request", id: "r-9", method: "docs.open", params: null },
      branches,
      details,
      newerCommits,
      { command: "saveRepoState", repo: "/srv/checkouts/orchard" }
    ]) {
      setup.vscodeApi.postMessage(message);
    }

    expect(helpers.latestGraphRequest("loadCommits")).toBe(newerCommits);
    expect(helpers.latestGraphRequest("loadBranches")).toBe(branches);
    expect(helpers.latestGraphRequest("commitDetails")).toBe(details);
  });

  it("throws, naming the kind, when no query of that kind was posted", () => {
    setup.vscodeApi.postMessage.mockClear();
    setup.vscodeApi.postMessage(query("loadBranches", "q-5"));
    setup.vscodeApi.postMessage({ kind: "rpc.request", id: "r-10", method: "repo.scan" });

    expect(() => helpers.latestGraphRequest("commitDetails")).toThrowError(
      /^No commitDetails request was sent$/
    );
    expect(() => helpers.latestGraphRequest("loadCommits")).toThrowError(
      /^No loadCommits request was sent$/
    );

    setup.vscodeApi.postMessage.mockClear();
    expect(() => helpers.latestGraphRequest("loadBranches")).toThrowError(
      /^No loadBranches request was sent$/
    );
  });

  it("only reads the recorded calls", () => {
    setup.vscodeApi.postMessage.mockClear();
    const details = query("commitDetails", "q-6");
    setup.vscodeApi.postMessage(details);

    expect(helpers.latestGraphRequest("commitDetails")).toBe(details);
    expect(helpers.latestGraphRequest("commitDetails")).toBe(details);
    expect(setup.vscodeApi.postMessage.mock.calls).toEqual([[details]]);
  });

  it("is typed with the fields of the query asked for", () => {
    expectTypeOf(helpers.latestGraphRequest<"commitDetails">).returns.toEqualTypeOf<
      Extract<QueryRequest, { command: "commitDetails" }>
    >();
    expectTypeOf(helpers.setupWebviewTest).parameters.toEqualTypeOf<
      [options?: { dispatchMessages?: boolean } | undefined]
    >();
    expectTypeOf(helpers.setupWebviewTest).returns.toEqualTypeOf<void>();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { activate } from "@/main";

type Handler = (...args: unknown[]) => unknown;

const fake = vi.hoisted(() => {
  const journal: string[] = [];
  const note = (entry: string) => journal.push(entry);
  const view = Object.assign(
    vi.fn((..._args: unknown[]) => {}),
    { showPane: vi.fn((_pane: string) => {}) }
  );
  return {
    journal,
    note,
    view,
    bundle: undefined as Record<string, string> | undefined,
    handlers: new Map<string, Handler>(),
    registrations: [] as Array<{ id: string; dispose: ReturnType<typeof vi.fn> }>,
    statusItem: {
      name: "",
      command: "",
      text: "",
      tooltip: "",
      show: vi.fn(),
      dispose: vi.fn()
    },
    createStatusBarItem: vi.fn(),
    translate: vi.fn((message: string) => `[${message}]`),
    l10nConfig: vi.fn(),
    openFileHistory: undefined as ((repo: string, file: string) => void) | undefined,
    guide: Promise.resolve(),
    walkthrough: Promise.resolve()
  };
});

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: Handler) => {
      fake.handlers.set(id, handler);
      const registration = { id, dispose: vi.fn() };
      fake.registrations.push(registration);
      return registration;
    }
  },
  window: {
    createStatusBarItem: fake.createStatusBarItem.mockImplementation(() => {
      fake.note("createStatusBarItem");
      return fake.statusItem;
    })
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  Uri: { file: (fsPath: string) => ({ scheme: "file", fsPath }) },
  l10n: {
    t: fake.translate,
    get bundle() {
      return fake.bundle;
    }
  }
}));
vi.mock("@vscode/l10n", () => ({
  config: fake.l10nConfig.mockImplementation((options: unknown) =>
    fake.note(`l10n.config ${JSON.stringify(options)}`)
  )
}));
vi.mock("@/extension/util/logger", () => ({
  logger: {
    init: () => fake.note("logger.init"),
    info: (message: string) => fake.note(`logger.info ${message}`)
  }
}));
vi.mock("@/extension/migrate-settings", () => ({
  migrateSettings: () => {
    fake.note("migrateSettings");
    return new Promise(() => {});
  }
}));
vi.mock("@/extension/config", () => ({
  resolveBuiltInGitPath: () => {
    fake.note("resolveBuiltInGitPath");
    return new Promise(() => {});
  }
}));
vi.mock("@/extension/view-command", () => ({
  createViewCommand: () => {
    fake.note("createViewCommand");
    return fake.view;
  }
}));
vi.mock("@/extension/handlers/onboarding", () => ({
  openDocumentation: (ctx: unknown) => {
    fake.note(`openDocumentation ${ctx === context ? "ctx" : "?"}`);
    return fake.guide;
  },
  openWalkthrough: (ctx: unknown) => {
    fake.note(`openWalkthrough ${ctx === context ? "ctx" : "?"}`);
    return fake.walkthrough;
  }
}));
vi.mock("@/old-extension/fileHistoryCommand", () => ({
  registerFileHistoryCommand: (ctx: unknown, open: (repo: string, file: string) => void) => {
    fake.note(`registerFileHistoryCommand ${ctx === context ? "ctx" : "?"}`);
    fake.openFileHistory = open;
  }
}));

let context: import("vscode").ExtensionContext;

beforeEach(() => {
  vi.clearAllMocks();
  fake.journal.length = 0;
  fake.handlers.clear();
  fake.registrations.length = 0;
  fake.bundle = undefined;
  fake.openFileHistory = undefined;
  Object.assign(fake.statusItem, { name: "", command: "", text: "", tooltip: "" });
  context = { subscriptions: [] } as unknown as import("vscode").ExtensionContext;
});

function run(handler: string, ...args: unknown[]) {
  const registered = fake.handlers.get(handler);
  expect(registered, handler).toBeDefined();
  return registered!(...args);
}

describe("activation", () => {
  it("runs each step once, in order, without waiting for the background work", () => {
    expect(activate(context)).toBeUndefined();
    expect(fake.journal).toEqual([
      "logger.init",
      "migrateSettings",
      "resolveBuiltInGitPath",
      'l10n.config {"contents":{}}',
      "createStatusBarItem",
      "createViewCommand",
      "registerFileHistoryCommand ctx",
      "logger.info Extension activated"
    ]);
  });

  it("hands the display language's bundle to the backend's translations", () => {
    fake.bundle = { "View Graph": "查看分支图" };
    activate(context);
    expect(fake.l10nConfig).toHaveBeenCalledTimes(1);
    expect(fake.l10nConfig.mock.calls[0]![0]).toEqual({ contents: fake.bundle });
    expect((fake.l10nConfig.mock.calls[0]![0] as { contents: unknown }).contents).toBe(fake.bundle);
  });

  it("shows the status bar entry that opens the graph", () => {
    activate(context);
    expect(fake.createStatusBarItem).toHaveBeenCalledTimes(1);
    expect(fake.createStatusBarItem.mock.calls[0]).toEqual([1]);
    expect(fake.statusItem).toMatchObject({
      name: "Branchwise",
      command: "branchwise.view",
      text: "$(type-hierarchy) Branchwise",
      tooltip: "[View Graph]"
    });
    expect(fake.statusItem.show).toHaveBeenCalledTimes(1);
    expect(fake.translate.mock.calls).toEqual([["View Graph"]]);
  });

  it("registers the four commands it owns, after the status bar entry", () => {
    activate(context);
    expect(fake.registrations.map((registration) => registration.id)).toEqual([
      "branchwise.view",
      "branchwise.showBranches",
      "branchwise.openDocumentation",
      "branchwise.openWalkthrough"
    ]);
    expect(context.subscriptions).toEqual([fake.statusItem, ...fake.registrations]);
  });

  it("releases the status bar entry and every registration on disposal", () => {
    activate(context);
    for (const subscription of context.subscriptions) {
      subscription.dispose();
    }
    expect(fake.statusItem.dispose).toHaveBeenCalledTimes(1);
    for (const registration of fake.registrations) {
      expect(registration.dispose, registration.id).toHaveBeenCalledTimes(1);
    }
  });
});

describe("the commands", () => {
  it("passes every argument of branchwise.view to the view command", () => {
    activate(context);
    const sourceControl = { rootUri: { fsPath: "/x" } };
    run("branchwise.view", sourceControl, "f.txt");
    expect(fake.view).toHaveBeenCalledWith(sourceControl, "f.txt");
    run("branchwise.view");
    expect(fake.view).toHaveBeenLastCalledWith();
  });

  it("opens the Branches pane whatever branchwise.showBranches is given", () => {
    activate(context);
    run("branchwise.showBranches", "ignored", { rootUri: { fsPath: "/y" } });
    expect(fake.view.showPane.mock.calls).toEqual([["refs"]]);
    expect(fake.view).not.toHaveBeenCalled();
  });

  it("returns the guide's and the walkthrough's promises, so callers can wait for them", () => {
    fake.guide = Promise.resolve();
    fake.walkthrough = Promise.reject(new Error("no walkthrough"));
    fake.walkthrough.catch(() => {});
    activate(context);
    expect(run("branchwise.openDocumentation")).toBe(fake.guide);
    expect(run("branchwise.openWalkthrough")).toBe(fake.walkthrough);
    expect(fake.journal).toContain("openDocumentation ctx");
    expect(fake.journal).toContain("openWalkthrough ctx");
  });

  it("opens a file's history in the repository File History found", () => {
    activate(context);
    fake.openFileHistory!("/repo", "a/b.txt");
    expect(fake.view.mock.calls).toEqual([
      [{ rootUri: { scheme: "file", fsPath: "/repo" } }, "a/b.txt"]
    ]);
  });
});

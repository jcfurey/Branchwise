import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RefTarget } from "@/backend/types";
import { type GoToItem, goToItems, showGoTo } from "@/extension/handlers/go-to";

type Listener = (value?: unknown) => unknown;

const world = vi.hoisted(() => ({
  pickers: [] as Array<ReturnType<typeof fakePicker>>,
  targets: Promise.resolve([] as unknown[]),
  resolveCommit: vi.fn(),
  notify: vi.fn(),
  executeCommand: vi.fn(() => Promise.resolve()),
  showErrorMessage: vi.fn(),
  createGit: vi.fn()
}));

/** A QuickPick that records what the handler sets and lets the test act as the user. */
function fakePicker() {
  const listeners: Record<string, Listener> = {};
  const on = (name: string) => (listener: Listener) => {
    listeners[name] = listener;
    return { dispose() {} };
  };
  return {
    title: "",
    placeholder: "",
    matchOnDetail: false,
    busy: false,
    value: "",
    items: [] as GoToItem[],
    activeItems: [] as GoToItem[],
    shown: false,
    disposed: false,
    show() {
      this.shown = true;
    },
    hide() {
      listeners["hide"]?.();
    },
    dispose() {
      this.disposed = true;
    },
    onDidChangeValue: on("value"),
    onDidAccept: on("accept"),
    onDidHide: on("hide"),
    /** Type `value` into the box, as the user would. */
    type(value: string) {
      this.value = value;
      listeners["value"]?.(value);
    },
    /** Press Enter on `item`, and wait for whatever that starts. */
    accept(item: GoToItem | undefined) {
      this.activeItems = item === undefined ? [] : [item];
      return listeners["accept"]?.();
    }
  };
}

vi.mock("vscode", () => ({
  window: {
    createQuickPick: () => {
      const picker = fakePicker();
      world.pickers.push(picker);
      return picker;
    },
    showErrorMessage: world.showErrorMessage
  },
  commands: { executeCommand: world.executeCommand },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]))
  }
}));
vi.mock("@/backend/gitClient", () => ({ createGit: world.createGit }));
vi.mock("@/backend/queries/refTargets", () => ({ loadRefTargets: () => world.targets }));
vi.mock("@/backend/utils/validation", () => ({ resolveCommit: world.resolveCommit }));
vi.mock("@/extension/config", () => ({ extConfig: { gitPath: () => "/usr/bin/git" } }));
vi.mock("@/extension/rpc/rpc-notify", () => ({ rpcNotify: { notify: world.notify } }));

const A = "a".repeat(40);
const B = "b".repeat(40);
const TARGETS: RefTarget[] = [
  { type: "head", name: "main", hash: A, subject: "Tidy the parser" },
  { type: "head", name: "feature/x", hash: B, subject: "Add x" },
  { type: "remote", name: "origin/main", hash: A, subject: "Tidy the parser" },
  { type: "tag", name: "v1.0", hash: B, subject: "Add x" }
];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const picker = () => world.pickers.at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  world.pickers.length = 0;
  world.targets = Promise.resolve(TARGETS);
  world.createGit.mockReturnValue({ git: true });
  world.notify.mockResolvedValue(undefined);
});

describe("the picker's entries", () => {
  it("group the refs under headings, with an icon and the commit's short ID and subject", () => {
    expect(goToItems(TARGETS, "")).toEqual([
      { label: "Branches", kind: -1 },
      { label: "$(git-branch) main", detail: "aaaaaaaa Tidy the parser", hash: A },
      { label: "$(git-branch) feature/x", detail: "bbbbbbbb Add x", hash: B },
      { label: "Remote Branches", kind: -1 },
      { label: "$(cloud) origin/main", detail: "aaaaaaaa Tidy the parser", hash: A },
      { label: "Tags", kind: -1 },
      { label: "$(tag) v1.0", detail: "bbbbbbbb Add x", hash: B }
    ]);
  });

  it("start with text that may be a commit ID, shown whatever the filter", () => {
    expect(goToItems(TARGETS, "C0ffee")[0]).toEqual({
      label: "$(git-commit) C0ffee",
      description: "Commit ID",
      alwaysShow: true,
      typed: "C0ffee"
    });
  });

  it.each(["", "abc", "main", "c0ffee!", "g".repeat(8), "a".repeat(65)])(
    "offer no commit ID for %j",
    (typed) => {
      expect(goToItems(TARGETS, typed).some((item) => item.typed !== undefined)).toBe(false);
    }
  );
});

describe("showing the picker", () => {
  it.each([null, "/repo", {}, { repo: 1 }])("refuses %j", (params) => {
    expect(() => showGoTo(params)).toThrow("Invalid goTo.show parameters");
    expect(world.pickers).toEqual([]);
  });

  it("opens at once, busy until the refs arrive, and searches the details", async () => {
    expect(showGoTo({ repo: "/repo" })).toBe(true);
    expect(world.createGit).toHaveBeenCalledWith("/repo", "/usr/bin/git");
    expect(picker()).toMatchObject({ shown: true, busy: true, matchOnDetail: true });
    expect(picker().title).toBe("Go to Branch, Tag or Commit");
    await settle();
    expect(picker().busy).toBe(false);
    expect(picker().items).toEqual(goToItems(TARGETS, ""));
  });

  it("offers the typed commit ID as the user types", async () => {
    showGoTo({ repo: "/repo" });
    await settle();
    picker().type(" 1234abcd ");
    expect(picker().items[0]).toMatchObject({ typed: "1234abcd" });
  });

  it("tells the page to show the chosen ref's commit, and closes", async () => {
    showGoTo({ repo: "/repo" });
    await settle();
    await picker().accept(picker().items.find((item) => item.label.endsWith("v1.0")));
    expect(world.notify).toHaveBeenCalledExactlyOnceWith("view.reveal", { repo: "/repo", hash: B });
    expect(picker().disposed).toBe(true);
    // The graph takes the keyboard before the page is told, so the revealed row keeps it.
    expect(world.executeCommand).toHaveBeenCalledExactlyOnceWith("branchwise.view");
    expect(world.executeCommand.mock.invocationCallOrder[0]).toBeLessThan(
      world.notify.mock.invocationCallOrder[0]!
    );
  });

  it("resolves a typed commit ID before showing it", async () => {
    world.resolveCommit.mockResolvedValue(A);
    showGoTo({ repo: "/repo" });
    await settle();
    picker().type("aaaa");
    await picker().accept(picker().items[0]);
    expect(world.resolveCommit).toHaveBeenCalledWith({ git: true }, "aaaa");
    expect(world.notify).toHaveBeenCalledExactlyOnceWith("view.reveal", { repo: "/repo", hash: A });
  });

  it("reports a typed commit ID that matches no single commit", async () => {
    world.resolveCommit.mockRejectedValue(new Error("ambiguous"));
    showGoTo({ repo: "/repo" });
    await settle();
    picker().type("dead");
    await picker().accept(picker().items[0]);
    expect(world.notify).not.toHaveBeenCalled();
    expect(world.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
      "No commit in this repository has an ID starting with dead."
    );
    expect(picker().disposed).toBe(true);
  });

  it("does nothing when Enter is pressed on nothing", async () => {
    showGoTo({ repo: "/repo" });
    await settle();
    await picker().accept(undefined);
    expect(world.notify).not.toHaveBeenCalled();
    expect(picker().disposed).toBe(false);
  });

  it("reports refs that could not be listed, and still takes a commit ID", async () => {
    world.targets = Promise.reject(new Error("not a git repository"));
    showGoTo({ repo: "/repo" });
    await settle();
    expect(world.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
      "Unable to list the branches and tags: not a git repository"
    );
    expect(picker().busy).toBe(false);
    picker().type("abcd");
    expect(picker().items).toHaveLength(1);
  });

  it("leaves a picker the user closed alone when the refs arrive", async () => {
    const refs = Promise.withResolvers<RefTarget[]>();
    world.targets = refs.promise;
    showGoTo({ repo: "/repo" });
    picker().hide();
    refs.resolve(TARGETS);
    await settle();
    expect(picker().disposed).toBe(true);
    expect(picker().items).toEqual([]);
  });

  it("reports a folder Git cannot start in", () => {
    world.createGit.mockImplementation(() => {
      throw new Error("Cannot use simple-git on a directory that does not exist");
    });
    showGoTo({ repo: "/gone" });
    expect(picker().disposed).toBe(true);
    expect(world.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
      "Cannot use simple-git on a directory that does not exist"
    );
  });
});

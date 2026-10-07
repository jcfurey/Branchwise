// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitDetails, RepositoryQuery, TreeEntry } from "@/backend/types";
import { ROW_STEP } from "@/webview/components/commit/AllFiles";
import { CommitDetails, fileListMode } from "@/webview/components/commit/CommitDetails";
import { forgetCommitTrees } from "@/webview/lib/commit-tree";
import { historyFilter } from "@/webview/lib/navigation";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import { contextMenu, selectedRepo } from "@/webview/lib/stores";

import { attachHost, speak } from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const HASH = "c".repeat(40);
const OTHER = "d".repeat(40);
const GITLINK = "1234567890abcdef1234567890abcdef12345678";

type Posted = {
  command: string;
  repo: string;
  requestId: string;
  query?: RepositoryQuery;
  action?: unknown;
};

const outbox = (): Posted[] => vscodeApi.postMessage.mock.calls.map(([sent]) => sent as Posted);
const treeReads = () =>
  outbox().filter(
    (message) => message.command === "repositoryQuery" && message.query?.kind === "tree"
  );
const actions = () =>
  outbox()
    .filter((message) => message.command === "repositoryAction")
    .map((message) => message.action);

const file = (path: string, kind: TreeEntry["kind"] = "file"): TreeEntry =>
  kind === "submodule" ? { path, kind, size: null, commit: GITLINK } : { path, kind, size: 3 };

const TREE: Array<TreeEntry> = [
  file("README.md"),
  file("docs/guide.md"),
  file("docs/deep/notes.txt"),
  file("src/a b.ts"),
  file("src/link.ts", "symlink"),
  file("vendor/lib", "submodule")
];

/** Details of `hash` that change README.md and add src/a b.ts. */
function details(hash = HASH): GitCommitDetails {
  return {
    hash,
    parents: ["p".repeat(40)],
    author: "Ann",
    email: "",
    date: 1_700_000_000,
    committer: "Ann",
    body: "Subject",
    fileChanges: [
      { oldFilePath: "README.md", newFilePath: "README.md", type: "M", additions: 1, deletions: 1 },
      {
        oldFilePath: "src/a b.ts",
        newFilePath: "src/a b.ts",
        type: "A",
        additions: 2,
        deletions: 0
      }
    ]
  };
}

let host: HTMLDivElement;

const draw = (hash = HASH) =>
  act(() =>
    render(h("table", null, h("tbody", null, h(CommitDetails, { details: details(hash) }))), host)
  );

const header = () => host.querySelector<HTMLElement>("[data-file-list-header]")!;
const headerButton = (label: string) =>
  [...header().querySelectorAll("button")].find((button) => button.textContent?.startsWith(label))!;
const chooseAll = () => act(() => headerButton("allFiles").click());
const filterBox = () => header().querySelector<HTMLInputElement>("input[type=search]");
const list = () => host.querySelector<HTMLElement>("[data-all-files]");
const entries = () => [...(list()?.querySelectorAll<HTMLButtonElement>("li > button") ?? [])];
const names = () => entries().map((button) => button.querySelector("span")!.textContent);
const entry = (name: string) =>
  entries().find((button) => button.querySelector("span")!.textContent === name)!;

/** Answer the newest tree read with `entries`, or with a failure for `null`. */
function answer(tree: Array<TreeEntry> | null, more = false) {
  const { repo, requestId, query } = treeReads().at(-1)!;
  const hash = query?.kind === "tree" ? query.hash : "";
  act(() =>
    handleRepositoryQuery({
      repo,
      requestId,
      data: tree === null ? null : { kind: "tree", hash, entries: tree, more },
      status: tree === null ? "no such commit" : null
    })
  );
}

function filter(text: string) {
  const input = filterBox()!;
  input.value = text;
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak({ unableToListFiles: "Unable to list the files: {0}", submoduleAt: "Submodule at {0}" });
  selectedRepo.value = "/repo";
  forgetCommitTrees();
  vscodeApi.postMessage.mockClear();
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  fileListMode.value = "changed";
  contextMenu.value = null;
  vi.restoreAllMocks();
});

describe("the Changed Files | All Files toggle", () => {
  it("reads the tree only once All Files is chosen, and keeps it for the commit", () => {
    draw();
    const [changed, all] = [headerButton("comparedFiles"), headerButton("allFiles")];
    expect(changed.getAttribute("aria-pressed")).toBe("true");
    expect(all.getAttribute("aria-pressed")).toBe("false");
    expect(header().querySelector("[role=group]")!.getAttribute("aria-label")).toBe(
      "fileListShows"
    );
    expect(treeReads()).toEqual([]);

    chooseAll();
    expect(headerButton("allFiles").getAttribute("aria-pressed")).toBe("true");
    expect(treeReads()).toEqual([
      expect.objectContaining({ repo: "/repo", query: { kind: "tree", hash: HASH } })
    ]);
    // The filter takes Open All Changes' place while the list loads.
    expect(header().textContent).not.toContain("openAllChanges");
    expect(filterBox()!.placeholder).toBe("filterFiles");
    expect(host.querySelector("[role=status]")).not.toBeNull();

    answer(TREE);
    expect(names()).toEqual(["docs", "src", "vendor", "README.md"]);

    // Back to the changed files, and to all of them again: the kept tree shows at once.
    act(() => headerButton("comparedFiles").click());
    expect(list()).toBeNull();
    expect(header().textContent).toContain("openAllChanges");
    chooseAll();
    expect(names()).toEqual(["docs", "src", "vendor", "README.md"]);
    // The choice holds for the next commit, which reads its own tree; the filter starts afresh.
    filter("md");
    draw(OTHER);
    expect(treeReads()).toHaveLength(2);
    expect(treeReads()[1]!.query).toEqual({ kind: "tree", hash: OTHER });
    expect(filterBox()!.value).toBe("");
    draw(HASH);
    expect(treeReads()).toHaveLength(2);
    expect(names()).toEqual(["docs", "src", "vendor", "README.md"]);
  });

  it("says why the files could not be listed", () => {
    draw();
    chooseAll();
    answer(null);

    expect(host.querySelector("[role=alert]")!.textContent).toBe(
      "Unable to list the files: no such commit"
    );
  });
});

describe("all files of a commit", () => {
  it("opens folders one at a time, starting closed", () => {
    draw();
    chooseAll();
    answer(TREE);
    expect(entry("docs").getAttribute("aria-expanded")).toBe("false");

    act(() => entry("docs").click());
    expect(entry("docs").getAttribute("aria-expanded")).toBe("true");
    expect(names()).toEqual(["docs", "deep", "guide.md", "src", "vendor", "README.md"]);
    expect(entry("guide.md").parentElement!.style.paddingLeft).toBe("40px");

    act(() => entry("deep").click());
    expect(names()).toContain("notes.txt");
    act(() => entry("docs").click());
    expect(names()).toEqual(["docs", "src", "vendor", "README.md"]);
  });

  it("keeps the status letter and colour of each file the commit changed", () => {
    draw();
    chooseAll();
    answer(TREE);
    act(() => entry("src").click());

    const letter = (name: string) =>
      entry(name).querySelector("[data-change]")?.textContent ?? null;
    expect(letter("README.md")).toBe("M");
    expect(entry("README.md").classList.contains("text-git-modified")).toBe(true);
    expect(letter("a b.ts")).toBe("A");
    expect(entry("a b.ts").classList.contains("text-git-added")).toBe(true);
    expect(letter("link.ts")).toBeNull();
  });

  it("marks symbolic links and submodules", () => {
    draw();
    chooseAll();
    answer(TREE);
    act(() => entry("src").click());
    act(() => entry("vendor").click());

    expect(entry("link.ts").dataset.kind).toBe("symlink");
    expect(entry("link.ts").title).toBe("src/link.ts · symbolicLink");
    expect(entry("link.ts").textContent).toContain(", symbolicLink");
    expect(entry("lib").dataset.kind).toBe("submodule");
    expect(entry("lib").title).toBe("vendor/lib · Submodule at 12345678");
    expect(entry("lib").getAttribute("aria-disabled")).toBe("true");
    expect(entry("a b.ts").dataset.kind).toBe("file");
  });

  it("opens a file as it was at the commit, but not a submodule", () => {
    draw();
    chooseAll();
    answer(TREE);
    act(() => entry("vendor").click());

    act(() => entry("README.md").click());
    act(() => entry("lib").click());
    // A double-click's second click opens nothing more.
    entry("README.md").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));

    expect(actions()).toEqual([{ kind: "viewHistoricalFile", hash: HASH, path: "README.md" }]);
  });

  it("filters by path into a flat list, and says when nothing matches", () => {
    draw();
    chooseAll();
    answer(TREE);

    filter("MD");
    expect(names()).toEqual(["README.md", "docs/guide.md"]);
    expect(entry("README.md").querySelector("[data-change]")!.textContent).toBe("M");

    filter("zzz");
    expect(names()).toEqual([]);
    expect(list()!.textContent).toContain("noMatchingFiles");

    filter("");
    expect(names()).toEqual(["docs", "src", "vendor", "README.md"]);
  });

  it("draws a bounded number of entries, and more on request", () => {
    const many = Array.from({ length: ROW_STEP + 20 }, (_, index) =>
      file(`f${String(index).padStart(4, "0")}`)
    );
    draw();
    chooseAll();
    answer(many);

    expect(entries()).toHaveLength(ROW_STEP);
    const more = [...list()!.querySelectorAll("button")].at(-1)!;
    expect(more.textContent).toBe("showMoreFiles");

    act(() => more.click());
    expect(entries()).toHaveLength(ROW_STEP + 20);
    expect(list()!.textContent).not.toContain("showMoreFiles");
  });

  it("says when Git listed only part of the tree", () => {
    speak({ allFilesLimited: "More than the first {0}" });
    draw();
    chooseAll();
    answer(TREE, true);

    expect(list()!.textContent).toContain(`More than the first ${TREE.length}`);
  });
});

describe("the menu of a file in all files", () => {
  /** Open the menu of `name` and return its entries' titles. */
  function menuOf(name: string) {
    act(() => {
      entry(name).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1, clientY: 1 })
      );
    });
    return contextMenu.value!.entries.map((item) => item?.title);
  }
  const choose = (title: string) =>
    act(() => contextMenu.value!.entries.find((item) => item?.title === title)!.onClick());

  it("opens the file at the revision or as it is now, copies its path, or shows its history", async () => {
    const copy = vi.spyOn(rpcClient, "request").mockResolvedValue(true);
    draw();
    chooseAll();
    answer(TREE);
    act(() => entry("src").click());

    expect(menuOf("a b.ts")).toEqual([
      "openHistoricalFile",
      "openCurrentFile",
      "copyPath",
      "fileHistory"
    ]);
    expect(contextMenu.value!.source).toBe("tree:src/a b.ts");
    choose("openHistoricalFile");
    choose("openCurrentFile");
    expect(actions()).toEqual([
      { kind: "viewHistoricalFile", hash: HASH, path: "src/a b.ts" },
      { kind: "viewCurrentFile", path: "src/a b.ts" }
    ]);

    menuOf("a b.ts");
    choose("copyPath");
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith("clipboard.copy", "src/a b.ts"));

    menuOf("a b.ts");
    choose("fileHistory");
    expect(historyFilter.value).toMatchObject({ path: "src/a b.ts", revision: HASH });
  });

  it("offers a submodule only its path and history", () => {
    draw();
    chooseAll();
    answer(TREE);
    act(() => entry("vendor").click());

    expect(menuOf("lib")).toEqual(["copyPath", "fileHistory"]);
  });

  it("opens from the keyboard too", () => {
    draw();
    chooseAll();
    answer(TREE);

    act(() => {
      entry("README.md").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });
    expect(contextMenu.value?.source).toBe("tree:README.md");
  });
});

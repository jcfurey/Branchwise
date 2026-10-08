import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeRepoPath } from "@/backend/utils/repoPath";
import { registerLineCommands, selectedLines } from "@/extension/line-commands";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

type Position = { line: number; character: number };

const mocks = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<void>>(),
  executeCommand: vi.fn(async (..._args: unknown[]) => {}),
  info: vi.fn(async (..._args: unknown[]): Promise<string | undefined> => undefined),
  warning: vi.fn(async (..._args: unknown[]) => undefined),
  error: vi.fn(async (..._args: unknown[]) => undefined),
  editor: undefined as unknown
}));

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (name: string, handler: () => Promise<void>) =>
      mocks.commands.set(name, handler),
    executeCommand: mocks.executeCommand
  },
  window: {
    get activeTextEditor() {
      return mocks.editor;
    },
    showInformationMessage: mocks.info,
    showWarningMessage: mocks.warning,
    showErrorMessage: mocks.error
  },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, value: unknown) => value }),
    encode: async (text: string) => new TextEncoder().encode(text)
  },
  extensions: { getExtension: () => undefined },
  Uri: {
    from: (parts: { scheme: string; path: string; query: string }) => ({ ...parts })
  },
  l10n: {
    t: (message: string, ...values: string[]) =>
      message.replace(/\{(\d+)\}/g, (_match, index: string) => values[Number(index)] ?? "")
  }
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function newRepo() {
  const dir = makeRepo();
  dirs.push(dir);
  return dir;
}

function commitFile(repo: string, file: string, content: string, message: string) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
  git(["add", "--", file], repo);
  git(["commit", "-q", "-m", message], repo);
  return gitOutput(["rev-parse", "HEAD"], repo);
}

/** An editor on `uri` holding `text`, with the selection running from `start` to `end`. */
function openEditor(
  uri: { scheme: string; fsPath?: string; path: string; query?: string },
  text: string,
  start: Position,
  end: Position = start,
  dirty = false
) {
  const lines = text.split("\n");
  mocks.editor = {
    document: {
      uri,
      isDirty: dirty,
      encoding: "utf8",
      getText: () => text,
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line] })
    },
    selection: {
      start,
      end,
      active: end,
      isEmpty: start.line === end.line && start.character === end.character
    }
  };
}

const fileUri = (fsPath: string) => ({ scheme: "file", fsPath, path: fsPath });
const at = (line: number, character = 0) => ({ line: line - 1, character });

const view = { show: vi.fn() };

async function run(command: string) {
  await mocks.commands.get(command)!();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.editor = undefined;
  registerLineCommands({ subscriptions: [] } as unknown as import("vscode").ExtensionContext, view);
});

const FIVE = "one\ntwo\nthree\nfour\nfive\n";

describe("Show Line's Commit in Graph", () => {
  it("shows the commit that last changed the line, in the innermost repository", async () => {
    const outer = newRepo();
    const inner = path.join(outer, "vendor", "inner");
    fs.mkdirSync(inner, { recursive: true });
    git(["init", "-q"], inner);
    git(["config", "user.name", "T"], inner);
    git(["config", "user.email", "t@t.com"], inner);
    git(["config", "commit.gpgsign", "false"], inner);
    commitFile(inner, "src/a.txt", FIVE, "inner first");
    const second = commitFile(inner, "src/a.txt", FIVE.replace("two", "TWO"), "inner second");
    commitFile(inner, "src/a.txt", FIVE.replace("two", "TWO").replace("five", "5"), "third");
    openEditor(fileUri(path.join(inner, "src", "a.txt")), FIVE, at(2, 1));

    await run("branchwise.showLineCommit");

    expect(mocks.error).not.toHaveBeenCalled();
    expect(view.show).toHaveBeenCalledExactlyOnceWith(normalizeRepoPath(inner), {
      commit: second
    });
  });

  it("finds the line in a submodule's own history", async () => {
    const library = newRepo();
    const libraryCommit = commitFile(library, "lib.txt", "library\n", "library line");
    const parent = newRepo();
    git(
      ["-c", "protocol.file.allow=always", "submodule", "add", "-q", library, "modules/lib"],
      parent
    );
    git(["commit", "-q", "-m", "add submodule"], parent);
    openEditor(fileUri(path.join(parent, "modules", "lib", "lib.txt")), "library\n", at(1));

    await run("branchwise.showLineCommit");

    expect(view.show).toHaveBeenCalledExactlyOnceWith(
      normalizeRepoPath(fs.realpathSync.native(path.join(parent, "modules", "lib"))),
      { commit: libraryCommit }
    );
  });

  it("blames the editor's unsaved text, where an inserted line moves the others down", async () => {
    const repo = newRepo();
    commitFile(repo, "a.txt", FIVE, "first");
    const second = commitFile(repo, "a.txt", FIVE.replace("two", "TWO"), "second");
    const unsaved = "inserted\n" + FIVE.replace("two", "TWO");
    openEditor(fileUri(path.join(repo, "a.txt")), unsaved, at(3), at(3), true);

    await run("branchwise.showLineCommit");

    expect(view.show).toHaveBeenCalledExactlyOnceWith(normalizeRepoPath(repo), {
      commit: second
    });
  });

  it("says a line has uncommitted changes and offers to show them", async () => {
    const repo = newRepo();
    const head = commitFile(repo, "a.txt", FIVE, "first");
    mocks.info.mockResolvedValueOnce("Show Uncommitted Changes");
    const document = FIVE.replace("three", "THREE");
    openEditor(fileUri(path.join(repo, "a.txt")), document, at(3), at(3), true);

    await run("branchwise.showLineCommit");

    expect(view.show).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      "This line has uncommitted changes.",
      "Show Uncommitted Changes"
    );
    await vi.waitFor(() => expect(mocks.executeCommand).toHaveBeenCalledOnce());
    const [command, left, right, title] = mocks.executeCommand.mock.calls[0]!;
    expect(command).toBe("vscode.diff");
    expect(left).toMatchObject({ scheme: "branchwise", path: "a.txt" });
    expect((left as { query: string }).query).toContain(`commit=${head}`);
    expect(right).toBe((mocks.editor as { document: { uri: unknown } }).document.uri);
    expect(title).toBe("a.txt (Uncommitted changes)");
  });

  it("opens nothing when the offer is dismissed", async () => {
    const repo = newRepo();
    commitFile(repo, "a.txt", FIVE, "first");
    fs.writeFileSync(path.join(repo, "a.txt"), FIVE.replace("one", "ONE"));
    openEditor(fileUri(path.join(repo, "a.txt")), FIVE.replace("one", "ONE"), at(1));

    await run("branchwise.showLineCommit");

    await vi.waitFor(() => expect(mocks.info).toHaveBeenCalledOnce());
    expect(mocks.executeCommand).not.toHaveBeenCalled();
    expect(view.show).not.toHaveBeenCalled();
  });

  it("explains that an untracked file has no history", async () => {
    const repo = newRepo();
    fs.writeFileSync(path.join(repo, "loose.txt"), "loose\n");
    openEditor(fileUri(path.join(repo, "loose.txt")), "loose\n", at(1));

    await run("branchwise.showLineCommit");

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      "loose.txt is not tracked by Git, so it has no history yet."
    );
    expect(view.show).not.toHaveBeenCalled();
  });

  it("explains that a file outside every repository is not in one", async () => {
    const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-line-")));
    dirs.push(outside);
    fs.writeFileSync(path.join(outside, "notes.txt"), "notes\n");
    openEditor(fileUri(path.join(outside, "notes.txt")), "notes\n", at(1));

    await run("branchwise.showLineCommit");

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith("notes.txt is not in a Git repository.");
    expect(view.show).not.toHaveBeenCalled();
  });

  it("asks for an editor when none is active, and refuses an unsaved new file", async () => {
    await run("branchwise.showLineCommit");
    expect(mocks.info).toHaveBeenLastCalledWith("Open a file in an editor first.");
    openEditor({ scheme: "untitled", path: "Untitled-1" }, "text\n", at(1));
    await run("branchwise.showLineCommit");
    expect(mocks.info).toHaveBeenLastCalledWith("Untitled-1 is not in a Git repository.");
    expect(view.show).not.toHaveBeenCalled();
  });

  it("counts the line in a file shown as it was at a commit", async () => {
    const repo = newRepo();
    const first = commitFile(repo, "a.txt", FIVE, "first");
    const second = commitFile(repo, "a.txt", "top\n" + FIVE, "second");
    const query = `commit=${second}&repo=${encodeURIComponent(repo)}`;
    openEditor({ scheme: "branchwise", path: "a.txt", query }, "top\n" + FIVE, at(2));

    await run("branchwise.showLineCommit");

    expect(view.show).toHaveBeenCalledExactlyOnceWith(normalizeRepoPath(repo), { commit: first });
  });

  it("reports what Git could not do", async () => {
    const repo = newRepo();
    commitFile(repo, "a.txt", "one\n", "first");
    // A line past the end of the file, which only a stale editor would offer.
    openEditor(fileUri(path.join(repo, "a.txt")), "one\ntwo\nthree\n", at(3));

    await run("branchwise.showLineCommit");

    expect(mocks.error).toHaveBeenCalledOnce();
    expect(String(mocks.error.mock.calls[0]![0])).toMatch(/^Unable to show the line's commit: /);
  });
});

describe("Show History of Selected Lines", () => {
  it("opens the history of the selected lines in the file's repository", async () => {
    const repo = newRepo();
    commitFile(repo, "src/a.txt", FIVE, "first");
    // Selecting whole lines ends at the start of the next one, which is not part of the range.
    openEditor(fileUri(path.join(repo, "src", "a.txt")), FIVE, at(2, 0), at(4, 0));

    await run("branchwise.lineHistory");

    expect(mocks.warning).not.toHaveBeenCalled();
    expect(view.show).toHaveBeenCalledExactlyOnceWith(normalizeRepoPath(repo), {
      path: "src/a.txt",
      lines: { start: 2, end: 3 }
    });
  });

  it("uses the cursor's line without a selection", async () => {
    const repo = newRepo();
    commitFile(repo, "a.txt", FIVE, "first");
    openEditor(fileUri(path.join(repo, "a.txt")), FIVE, at(4, 2));

    await run("branchwise.lineHistory");

    expect(view.show).toHaveBeenCalledExactlyOnceWith(normalizeRepoPath(repo), {
      path: "a.txt",
      lines: { start: 4, end: 4 }
    });
  });

  it("warns that the lines follow the committed version when the file has changes", async () => {
    const repo = newRepo();
    commitFile(repo, "a.txt", FIVE, "first");
    openEditor(fileUri(path.join(repo, "a.txt")), "new\n" + FIVE, at(2), at(2), true);

    await run("branchwise.lineHistory");

    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(
      "a.txt has changes that are not committed. The line numbers are taken from its last committed version, so they may not match the lines in the editor."
    );
    expect(view.show).toHaveBeenCalledOnce();

    fs.writeFileSync(path.join(repo, "a.txt"), "saved\n" + FIVE);
    openEditor(fileUri(path.join(repo, "a.txt")), "saved\n" + FIVE, at(2));
    await run("branchwise.lineHistory");
    expect(mocks.warning).toHaveBeenCalledTimes(2);
  });

  it("explains that an untracked or never committed file has no line history", async () => {
    const repo = newRepo();
    fs.writeFileSync(path.join(repo, "loose.txt"), "loose\n");
    fs.writeFileSync(path.join(repo, "staged.txt"), "staged\n");
    git(["add", "staged.txt"], repo);

    openEditor(fileUri(path.join(repo, "loose.txt")), "loose\n", at(1));
    await run("branchwise.lineHistory");
    openEditor(fileUri(path.join(repo, "staged.txt")), "staged\n", at(1));
    await run("branchwise.lineHistory");

    expect(mocks.info.mock.calls).toEqual([
      ["loose.txt is not tracked by Git, so it has no history yet."],
      ["staged.txt has no committed history yet."]
    ]);
    expect(view.show).not.toHaveBeenCalled();
  });

  it("starts at the commit of a file shown as it was then", async () => {
    const repo = newRepo();
    const first = commitFile(repo, "a.txt", FIVE, "first");
    const query = `commit=${first}%5E&repo=${encodeURIComponent(repo)}`;
    // The parent of the first commit has no such file.
    openEditor({ scheme: "branchwise", path: "a.txt", query }, "", at(1));
    await run("branchwise.lineHistory");
    expect(mocks.info).toHaveBeenLastCalledWith("a.txt has no committed history yet.");

    const second = commitFile(repo, "a.txt", FIVE.replace("one", "1"), "second");
    openEditor(
      { scheme: "branchwise", path: "/a.txt", query: `commit=${second}&repo=${repo}` },
      FIVE,
      at(1)
    );
    await run("branchwise.lineHistory");
    expect(view.show).toHaveBeenCalledExactlyOnceWith(normalizeRepoPath(repo), {
      path: "a.txt",
      lines: { start: 1, end: 1 },
      revision: second
    });
  });
});

describe("the selected lines", () => {
  const editorOn = (text: string, start: Position, end: Position) => {
    openEditor(fileUri("/x"), text, start, end);
    return mocks.editor as import("vscode").TextEditor;
  };

  it("leave out the empty line an editor shows after the final line break", () => {
    expect(selectedLines(editorOn("a\nb\n", at(3), at(3)))).toEqual({ start: 2, end: 2 });
    expect(selectedLines(editorOn("a\nb\n", at(1), at(3)))).toEqual({ start: 1, end: 2 });
    expect(selectedLines(editorOn("a\nb", at(2, 1), at(2, 1)))).toEqual({ start: 2, end: 2 });
  });

  it("keep a line the selection ends partway through", () => {
    expect(selectedLines(editorOn("a\nb\nc\n", at(1, 1), at(2, 1)))).toEqual({ start: 1, end: 2 });
  });
});

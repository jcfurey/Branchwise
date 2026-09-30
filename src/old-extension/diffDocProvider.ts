import { isAbsolute, sep } from "node:path";

import type { SimpleGit } from "simple-git";
import * as vscode from "vscode";

import { normalizeRepoPath } from "@/backend/utils/repoPath";

/**
 * Read-only `branchwise:` documents: a file as it was at a commit (or at the commit's first
 * parent), or a Git object by ID. The URI keeps the file path as its path and the rest in its
 * query, `commit=<id>[^]&repo=<folder>[&blob=1]`, each value escaped with `encodeURIComponent`.
 * VS Code stores the URIs of open editors across restarts, so that format must not change.
 */

/** A full SHA-1 or SHA-256 object ID, lowercase as Git prints it. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The ID callers pass for a side of a comparison that has no file. */
const NO_OBJECT = "0".repeat(40);

/**
 * Keys (from `normalizeRepoPath`) of every repository a URI was built for in this process. The
 * provider serves these without asking about saved state. It is shared by all providers and
 * never shrinks, so documents stay loadable for as long as the extension host runs.
 */
const builtFor = new Set<string>();

function historyUri(repo: string, path: string, commit: string, extra: string) {
  builtFor.add(normalizeRepoPath(repo));
  return vscode.Uri.from({
    scheme: DiffDocProvider.scheme,
    // A backslash separates folders only on Windows; elsewhere it can be part of a file name.
    path: sep === "\\" ? path.replaceAll("\\", "/") : path,
    query: `commit=${encodeURIComponent(commit)}&repo=${encodeURIComponent(repo)}${extra}`
  });
}

/**
 * The document for `path`, relative to the root of `repo`, at `commit`. A `commit` ending in `^`
 * names its first parent's version; 40 zeros make an empty document.
 */
export function encodeDiffDocUri(repo: string, path: string, commit: string): vscode.Uri {
  return historyUri(repo, path, commit, "");
}

/**
 * The document holding the Git object `blob` of `repo`, named `path` for the tab title and the
 * language. `null` makes an empty document.
 */
export function encodeDiffBlobUri(repo: string, path: string, blob: string | null): vscode.Uri {
  return historyUri(repo, path, blob ?? NO_OBJECT, "&blob=1");
}

/**
 * The query's arguments by name. Names are compared as written; values are unescaped, and one
 * that cannot be unescaped is skipped. A name given twice keeps its last readable value.
 */
function queryArguments(query: string) {
  const values = new Map<string, string>();
  for (const argument of query.split("&")) {
    const equals = argument.indexOf("=");
    if (equals === -1) {
      continue;
    }
    try {
      values.set(argument.slice(0, equals), decodeURIComponent(argument.slice(equals + 1)));
    } catch {
      // A broken escape sequence, such as a truncated UTF-8 byte sequence.
    }
  }
  return values;
}

/** The parts of a `branchwise:` URI. `blob` is present, and true, only for object documents. */
export function decodeDiffDocUri(uri: vscode.Uri): {
  filePath: string;
  commit: string | undefined;
  repo: string | undefined;
  blob?: boolean;
} {
  const values = queryArguments(uri.query);
  const parts = { filePath: uri.path, commit: values.get("commit"), repo: values.get("repo") };
  return values.get("blob") === "1" ? { ...parts, blob: true } : parts;
}

/** Whether `id` is a full object ID other than the all-zero one that stands for "no file". */
function isObjectId(id: string) {
  return OBJECT_ID.test(id) && !/^0+$/.test(id);
}

/**
 * What to ask `git show` for, or undefined when the URI does not name an object by its full ID.
 * Symbolic names, abbreviations and every suffix but a single `^` are refused, so no part of a
 * URI can become an option or a revision expression.
 */
function revisionOf({ filePath, commit = "", blob }: ReturnType<typeof decodeDiffDocUri>) {
  if (blob) {
    return isObjectId(commit) ? commit : undefined;
  }
  const id = commit.endsWith("^") ? commit.slice(0, -1) : commit;
  // Without a path, Git would list the commit's whole tree.
  return isObjectId(id) && filePath ? `${commit}:${filePath}` : undefined;
}

/**
 * Serves `branchwise:` documents with `git show`. Anything it refuses, and anything that fails,
 * is an empty document: added and deleted files rely on that for the missing side of a diff.
 */
export class DiffDocProvider implements vscode.TextDocumentContentProvider {
  static scheme = "branchwise";

  private readonly forRepo: (repo: string) => SimpleGit;
  private readonly isSavedRepo: (repo: string) => boolean;
  /** What Git printed for each open document, by the URI's string form. */
  private readonly contents = new Map<string, string>();
  /** Git runs still going, by the same key, so that a repeated request joins the first. */
  private readonly running = new Map<string, Promise<string>>();
  // Documents never change, so this never fires; VS Code subscribes to it all the same.
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();
  private readonly closeListener: vscode.Disposable;
  private disposed = false;

  /**
   * `forRepo` makes a Git client for a repository folder, as written in the URI. `isSavedRepo`
   * says whether the extension saved state for a repository key; it lets editors restored from
   * an earlier session load repositories that no URI was built for yet in this one.
   */
  constructor(forRepo: (repo: string) => SimpleGit, isSavedRepo: (repo: string) => boolean) {
    this.forRepo = forRepo;
    this.isSavedRepo = isSavedRepo;
    this.closeListener = vscode.workspace.onDidCloseTextDocument((document) =>
      this.forget(document.uri.toString())
    );
  }

  get onDidChange(): vscode.Event<vscode.Uri> {
    return this.changes.event;
  }

  provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
    if (this.disposed) {
      return "";
    }
    // Nothing reaches VS Code as an error: not a malformed URI, and not a failing callback.
    try {
      const key = uri.toString();
      return this.contents.get(key) ?? this.running.get(key) ?? this.load(key, uri);
    } catch {
      return "";
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.closeListener.dispose();
    this.changes.dispose();
    this.contents.clear();
    this.running.clear();
  }

  private load(key: string, uri: vscode.Uri): string | Promise<string> {
    const document = decodeDiffDocUri(uri);
    const revision = revisionOf(document);
    const { repo } = document;
    if (revision === undefined || repo === undefined || !isAbsolute(repo) || !this.knows(repo)) {
      return "";
    }
    // `--end-of-options` keeps even a path that looks like an option inside the revision. The
    // final `--` stops Git from taking a revision it cannot resolve as a path to a file that
    // exists, and showing HEAD instead; on Windows `<id>:dir/../f` names the file `f`.
    const output = this.forRepo(repo).show(["--end-of-options", revision, "--"]);
    const run: Promise<string> = Promise.resolve(output).then(
      (text) => this.finish(key, run, text),
      () => this.finish(key, run, undefined)
    );
    this.running.set(key, run);
    return run;
  }

  /** Whether URIs for `repo` were built in this process, or the extension saved its state. */
  private knows(repo: string) {
    const key = normalizeRepoPath(repo);
    return builtFor.has(key) || this.isSavedRepo(key);
  }

  /**
   * Settle `run`. Its output is kept only when Git succeeded and `run` is still the current one
   * for `key`: a close event or `dispose()` since it started means nobody will ask again.
   */
  private finish(key: string, run: Promise<string>, text: string | undefined) {
    if (this.running.get(key) === run) {
      this.running.delete(key);
      if (text !== undefined) {
        this.contents.set(key, text);
      }
    }
    return text ?? "";
  }

  private forget(key: string) {
    this.contents.delete(key);
    this.running.delete(key);
  }
}

import { basename } from "node:path";

import * as vscode from "vscode";

import { createGit } from "@/backend/gitClient";
import { lineFileState, lineOrigin, type LineSpan } from "@/backend/queries/lineHistory";
import { workTreeRoot } from "@/backend/utils/git";
import { resolveCommit } from "@/backend/utils/validation";
import { extConfig } from "@/extension/config";
import type { ViewCommand } from "@/extension/view-command";
import {
  decodeDiffDocUri,
  DiffDocProvider,
  encodeDiffDocUri
} from "@/old-extension/diffDocProvider";
import { locateRepoFile } from "@/old-extension/fileHistoryCommand";

/**
 * The file an editor shows, as Git knows it: its repository, its path from the top level, and,
 * for a file as it was at a commit, that commit.
 */
type EditorFile = { repo: string; path: string; revision?: string };

/** A commit as `branchwise:` documents name it: a full ID, or a full ID's first parent. */
const DOCUMENT_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\^?$/;

/** The ID that `branchwise:` documents give the empty side of a diff, which has no history. */
const NO_COMMIT = /^0+\^?$/;

/** That empty side, compared with an editor whose file HEAD does not have. */
const EMPTY_SIDE = "0".repeat(40);

/**
 * The repository and path of the file an editor shows: a file on disk, in the innermost
 * repository that holds it, or a file at a commit that Branchwise opened. Null for anything
 * else, such as an unsaved new file or a file outside every repository.
 */
async function editorFile(document: vscode.TextDocument): Promise<EditorFile | null> {
  const { uri } = document;
  if (uri.scheme === "file" || uri.scheme === "vscode-remote") {
    return locateRepoFile(uri.fsPath);
  }
  if (uri.scheme !== DiffDocProvider.scheme) {
    return null;
  }
  const { filePath, commit = "", repo, blob } = decodeDiffDocUri(uri);
  if (blob || repo === undefined || !DOCUMENT_COMMIT.test(commit) || NO_COMMIT.test(commit)) {
    return null;
  }
  const root = await workTreeRoot(repo, extConfig.gitPath());
  return root === null
    ? null
    : { repo: root, path: filePath.replace(/^\/+/, ""), revision: commit };
}

/**
 * The lines of the primary selection, counted from 1, or the cursor's line when nothing is
 * selected. A selection that ends at the start of a line leaves that line out, as selecting
 * whole lines does. An editor shows an empty line after a final line break, which Git does not
 * count, so the range stops at the line before it.
 */
export function selectedLines(editor: vscode.TextEditor): LineSpan {
  const { document, selection } = editor;
  const lastLine = document.lineAt(document.lineCount - 1);
  const lines =
    document.lineCount > 1 && lastLine.text === "" ? document.lineCount - 1 : document.lineCount;
  const { start, end } = selection;
  const last =
    !selection.isEmpty && end.character === 0 && end.line > start.line ? end.line - 1 : end.line;
  return { start: Math.min(start.line + 1, lines), end: Math.min(last + 1, lines) };
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The editor a line command acts on, with its file, or undefined after telling the user why
 * there is none.
 */
async function commandTarget() {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showInformationMessage(vscode.l10n.t("Open a file in an editor first."));
    return undefined;
  }
  const file = await editorFile(editor.document);
  if (file === null) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("{0} is not in a Git repository.", basename(editor.document.uri.path))
    );
    return undefined;
  }
  return { editor, file, git: createGit(file.repo, extConfig.gitPath()) };
}

function untrackedMessage(name: string) {
  return vscode.l10n.t("{0} is not tracked by Git, so it has no history yet.", name);
}

/** Compare the editor's text, saved or not, with the file at HEAD: every uncommitted change. */
async function showUncommittedChanges(
  file: EditorFile,
  document: vscode.TextDocument,
  head: string | null
) {
  const name = basename(file.path);
  await vscode.commands.executeCommand(
    "vscode.diff",
    encodeDiffDocUri(file.repo, file.path, head ?? EMPTY_SIDE),
    document.uri,
    `${name} (${vscode.l10n.t("Uncommitted changes")})`,
    { preview: true }
  );
}

/**
 * Branchwise: Show Line's Commit in Graph. Blames the cursor's line, as the editor shows it, and
 * selects the commit that last changed it in the graph, with its details open.
 */
async function showLineCommit(view: Pick<ViewCommand, "show">) {
  const target = await commandTarget();
  if (target === undefined) {
    return;
  }
  const { editor, file, git } = target;
  const { document } = editor;
  const name = basename(file.path);
  // Unsaved text stands in for the file, so that the line is the one the user sees.
  const contents =
    file.revision === undefined && document.isDirty
      ? await vscode.workspace.encode(document.getText(), { encoding: document.encoding })
      : undefined;
  const origin = await lineOrigin(git, file.path, selectedLines(editor).start, {
    ...(file.revision === undefined ? {} : { revision: file.revision }),
    ...(contents === undefined ? {} : { contents })
  });
  switch (origin.kind) {
    case "commit":
      view.show(file.repo, { commit: origin.hash });
      return;
    case "untracked":
      void vscode.window.showInformationMessage(untrackedMessage(name));
      return;
    case "uncommitted": {
      // The command does not wait for the user, who may leave the notification open.
      const show = vscode.l10n.t("Show Uncommitted Changes");
      const offer = Promise.resolve(
        vscode.window.showInformationMessage(
          vscode.l10n.t("This line has uncommitted changes."),
          show
        )
      );
      void offer
        .then(async (choice) => {
          if (choice === show) {
            const head = await resolveCommit(git, "HEAD").catch(() => null);
            await showUncommittedChanges(file, document, head);
          }
        })
        .catch((error: unknown) => {
          void vscode.window.showErrorMessage(reason(error));
        });
    }
  }
}

/**
 * Branchwise: Show History of Selected Lines. Lists the commits that changed the selected lines
 * where the graph lists search results. Git follows lines through committed history only, so
 * the lines are counted in the file at HEAD; when the editor's file differs from it, the user
 * is told the numbers may not match.
 */
async function showLineHistory(view: Pick<ViewCommand, "show">) {
  const target = await commandTarget();
  if (target === undefined) {
    return;
  }
  const { editor, file, git } = target;
  const name = basename(file.path);
  const state = await lineFileState(git, file.path, file.revision);
  if (state === "untracked") {
    void vscode.window.showInformationMessage(untrackedMessage(name));
    return;
  }
  if (state === "uncommitted") {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("{0} has no committed history yet.", name)
    );
    return;
  }
  if (state === "changed" || (file.revision === undefined && editor.document.isDirty)) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t(
        "{0} has changes that are not committed. The line numbers are taken from its last committed version, so they may not match the lines in the editor.",
        name
      )
    );
  }
  view.show(file.repo, {
    path: file.path,
    lines: selectedLines(editor),
    ...(file.revision === undefined ? {} : { revision: file.revision })
  });
}

/** Register the commands that go from an editor's lines to the graph. */
export function registerLineCommands(
  ctx: vscode.ExtensionContext,
  view: Pick<ViewCommand, "show">
) {
  // Returning the promise lets `executeCommand` settle once the graph has been asked.
  const run =
    (
      command: (view: Pick<ViewCommand, "show">) => Promise<void>,
      failure: (reason: string) => string
    ) =>
    async () => {
      try {
        await command(view);
      } catch (error) {
        void vscode.window.showErrorMessage(failure(reason(error)));
      }
    };
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      "branchwise.showLineCommit",
      run(showLineCommit, (why) => vscode.l10n.t("Unable to show the line's commit: {0}", why))
    ),
    vscode.commands.registerCommand(
      "branchwise.lineHistory",
      run(showLineHistory, (why) =>
        vscode.l10n.t("Unable to show the history of these lines: {0}", why)
      )
    )
  );
}

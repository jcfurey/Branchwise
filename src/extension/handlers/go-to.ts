import * as vscode from "vscode";

import { createGit } from "@/backend/gitClient";
import { loadRefTargets } from "@/backend/queries/refTargets";
import type { GitRef, RefTarget } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { resolveCommit } from "@/backend/utils/validation";
import { extConfig } from "@/extension/config";
import { rpcNotify } from "@/extension/rpc/rpc-notify";

/** Text that may be the start of a commit ID: Git accepts four hex digits at the least. */
const COMMIT_ID = /^[0-9a-f]{4,64}$/i;

/** An entry of the picker: a ref with its commit, or the commit ID typed into the box. */
export type GoToItem = vscode.QuickPickItem & { hash?: string; typed?: string };

const ICONS: Record<GitRef["type"], string> = {
  head: "$(git-branch)",
  remote: "$(cloud)",
  tag: "$(tag)"
};

function groupTitle(type: GitRef["type"]) {
  switch (type) {
    case "head":
      return vscode.l10n.t("Branches");
    case "remote":
      return vscode.l10n.t("Remote Branches");
    case "tag":
      return vscode.l10n.t("Tags");
  }
}

/**
 * The picker's entries for `targets`, under a heading per kind of ref. Text in the box that may be
 * a commit ID comes first, and stays whatever the filter, so it can be chosen even when it also
 * matches a name.
 */
export function goToItems(targets: ReadonlyArray<RefTarget>, typed: string): GoToItem[] {
  const items: GoToItem[] = [];
  if (COMMIT_ID.test(typed)) {
    items.push({
      label: `$(git-commit) ${typed}`,
      description: vscode.l10n.t("Commit ID"),
      alwaysShow: true,
      typed
    });
  }
  let group: GitRef["type"] | undefined;
  for (const target of targets) {
    if (target.type !== group) {
      group = target.type;
      items.push({ label: groupTitle(group), kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({
      label: `${ICONS[target.type]} ${target.name}`,
      detail: `${abbrevCommit(target.hash)} ${target.subject}`,
      hash: target.hash
    });
  }
  return items;
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ask which branch, tag or commit of `repo` to go to, then tell the page to show it. The user
 * may take as long as they like, so this does not wait: the choice reaches the page as a
 * `view.reveal` notification, and failures are reported here.
 */
async function pickTarget(repo: string) {
  const picker = vscode.window.createQuickPick<GoToItem>();
  picker.title = vscode.l10n.t("Go to Branch, Tag or Commit");
  picker.placeholder = vscode.l10n.t("Type a branch or tag name, or a commit ID");
  // The detail holds the short ID and subject, which are worth searching too.
  picker.matchOnDetail = true;
  picker.busy = true;

  let targets: RefTarget[] = [];
  let open = true;
  const update = () => {
    // The refs may arrive after the user closed the picker.
    if (open) {
      picker.items = goToItems(targets, picker.value.trim());
    }
  };
  picker.onDidChangeValue(update);
  picker.onDidHide(() => {
    open = false;
    picker.dispose();
  });

  let git: ReturnType<typeof createGit>;
  try {
    git = createGit(repo, extConfig.gitPath());
  } catch (error) {
    picker.dispose();
    void vscode.window.showErrorMessage(reason(error));
    return;
  }

  picker.onDidAccept(async () => {
    const [item] = picker.activeItems;
    if (item === undefined) {
      return;
    }
    let hash = item.hash;
    if (hash === undefined && item.typed !== undefined) {
      picker.busy = true;
      hash = await resolveCommit(git, item.typed).catch(() => undefined);
      picker.busy = false;
      if (hash === undefined) {
        picker.hide();
        void vscode.window.showErrorMessage(
          vscode.l10n.t("No commit in this repository has an ID starting with {0}.", item.typed)
        );
        return;
      }
    }
    picker.hide();
    if (hash !== undefined) {
      void rpcNotify.notify("view.reveal", { repo, hash });
    }
  });

  picker.show();
  try {
    targets = await loadRefTargets(git);
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Unable to list the branches and tags: {0}", reason(error))
    );
  }
  picker.busy = false;
  update();
}

/**
 * Show the Go to picker for the page's repository. Answers as soon as the picker opens; the
 * page learns the choice later, from a notification.
 */
export function showGoTo(params: unknown): boolean {
  if (
    typeof params !== "object" ||
    params === null ||
    typeof (params as { repo?: unknown }).repo !== "string"
  ) {
    throw new Error("Invalid goTo.show parameters");
  }
  void pickTarget((params as { repo: string }).repo);
  return true;
}

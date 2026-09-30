import type { RepositoryState } from "@/backend/types";
import { Button } from "@/webview/components/ui/Button";
import { openFormDialog } from "@/webview/lib/actions";
import {
  confirmRepositoryAction,
  openRepositoryManager,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { format } from "@/webview/utils/format";

export function openAddWorktree(startPoint = "HEAD", repo = selectedRepo.value) {
  if (repo === undefined) {
    return;
  }
  openFormDialog({
    message: window.l10n.addWorktree,
    inputs: [
      { kind: "text", label: window.l10n.worktreePath, value: "" },
      { kind: "ref", label: window.l10n.branch, value: "" },
      { kind: "checkbox", label: window.l10n.newBranch, value: true },
      { kind: "text", label: window.l10n.startPoint, value: startPoint }
    ],
    action: window.l10n.addWorktree,
    source: null,
    onSubmit: ([path, branch, newBranch, start]) =>
      sendRepositoryAction(
        { kind: "addWorktree", path, branch, newBranch, startPoint: start },
        repo
      )
  });
}

export function WorktreeManager({ state, repo }: { state: RepositoryState; repo: string }) {
  return (
    <div class="space-y-3 text-left">
      <Button onClick={() => openAddWorktree("HEAD", repo)}>{window.l10n.addWorktree}</Button>
      {state.worktrees.map((worktree, index) => (
        <div key={worktree.path} class="space-y-2 rounded border border-line p-2">
          <p>
            <b>{worktree.branch || window.l10n.detachedHead}</b>
          </p>
          <p class="break-all select-text">{worktree.path}</p>
          {worktree.path === repo && <p>{window.l10n.currentWorktree}</p>}
          {worktree.locked && <p>{window.l10n.lockedWorktree}</p>}
          {worktree.prunable && <p>{window.l10n.prunableWorktree}</p>}
          <div class="flex flex-wrap gap-2">
            <Button
              disabled={worktree.bare || worktree.prunable}
              onClick={() =>
                sendRepositoryAction({ kind: "openWorktree", path: worktree.path }, repo)
              }
            >
              {window.l10n.openWorktree}
            </Button>
            <Button
              disabled={
                index === 0 || worktree.path === repo || worktree.locked || worktree.prunable
              }
              onClick={() =>
                confirmRepositoryAction(
                  format(window.l10n.removeWorktreeConfirm, <b>{worktree.path}</b>),
                  window.l10n.removeWorktree,
                  { kind: "removeWorktree", path: worktree.path, expectedHead: worktree.head },
                  repo
                )
              }
            >
              {window.l10n.removeWorktree}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function openWorktrees() {
  openRepositoryManager(window.l10n.worktrees, (state, repo) => (
    <WorktreeManager state={state} repo={repo} />
  ));
}

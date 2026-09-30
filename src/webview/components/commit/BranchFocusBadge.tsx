import { branchFocusTarget, focusPaused } from "@/webview/lib/stores";

/** This marks the view's target independently of the checked-out branch. */
export function BranchFocusBadge({ branch }: { branch: string }) {
  if (branch !== branchFocusTarget.value) {
    return null;
  }
  const paused = focusPaused.value;
  return (
    <span
      class={`mx-1 shrink-0 rounded-sm border px-1 text-xs font-normal ${
        paused ? "border-line border-dashed text-muted" : "border-focus text-fg"
      }`}
      data-focus-branch={branch}
      data-focus-paused={paused}
      // A function replacement inserts the name as written, even when it contains `$`.
      title={(paused ? window.l10n.branchFocusPaused : window.l10n.branchFocus).replace("{0}", () =>
        branch.replace(/^remotes\//, "")
      )}
    >
      {paused ? window.l10n.focusPausedBadge : window.l10n.focusBadge}
    </span>
  );
}

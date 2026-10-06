import type { AbsorbHunk, AbsorbPlan, AbsorbReason } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import { openInteractiveRebase } from "@/webview/components/repository/RebaseEditor";
import { Button } from "@/webview/components/ui/Button";
import { openContentDialog } from "@/webview/lib/actions";
import { requestRepositoryQuery, sendRepositoryAction } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";

const REASONS: Record<AbsorbReason, keyof LocalizedStrings> = {
  added: "absorbAdded",
  deleted: "absorbDeleted",
  renamed: "absorbRenamed",
  binary: "absorbBinary",
  special: "absorbSpecial",
  outside: "absorbOutside",
  several: "absorbSeveral",
  noContext: "absorbNoContext"
};

/**
 * Where a hunk is: its lines in the staged file, or for lines it only removes, where they were
 * in HEAD's version. The counts say how many lines it adds and removes.
 */
function Place({ hunk }: { hunk: AbsorbHunk }) {
  const [start, lines] =
    hunk.newLines > 0 ? [hunk.newStart, hunk.newLines] : [hunk.oldStart, hunk.oldLines];
  const range = lines > 1 ? `${start}–${start + lines - 1}` : String(start);
  return (
    <>
      <span class="break-all">
        {hunk.path}:{range}
      </span>{" "}
      <span class="text-muted">
        {hunk.newLines > 0 && `+${hunk.newLines}`}
        {hunk.newLines > 0 && hunk.oldLines > 0 && " "}
        {hunk.oldLines > 0 && `−${hunk.oldLines}`}
      </span>
    </>
  );
}

const LIST = "max-h-48 overflow-auto rounded border border-line-soft p-2 font-mono text-xs";

export function AbsorbPreview({ plan, repo }: { plan: AbsorbPlan; repo: string }) {
  const base = plan.base;
  const absorb = (squash: boolean) =>
    sendRepositoryAction(
      { kind: "absorb", plan },
      repo,
      // The rebase editor opens only after the fixup commits exist, and the user starts it there.
      squash && base !== null
        ? (error) => {
            if (error === null) {
              openInteractiveRebase(base, true);
            }
          }
        : undefined
    );
  return (
    <div class="space-y-3 text-left">
      <p>{window.l10n.absorbIntro}</p>
      {plan.targets.map((target) => (
        <section key={target.hash} class="space-y-1" data-absorb-target={target.hash}>
          <h3 class="break-words">
            <code>{abbrevCommit(target.hash)}</code> <b>{target.subject}</b>
          </h3>
          <ul class={LIST}>
            {target.hunks.map((hunk) => (
              <li key={`${hunk.path}:${hunk.oldStart}:${hunk.newStart}`} class="py-0.5">
                <Place hunk={hunk} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {plan.left.length > 0 && (
        <section class="space-y-1" data-absorb-left>
          <h3 class="font-semibold">{window.l10n.absorbLeft}</h3>
          <ul class={LIST}>
            {plan.left.map((item) => (
              <li
                key={`${item.path}:${item.hunk?.oldStart ?? ""}:${item.hunk?.newStart ?? ""}`}
                class="py-0.5"
              >
                {item.hunk === null ? (
                  <span class="break-all">{item.path}</span>
                ) : (
                  <Place hunk={item.hunk} />
                )}
                <span class="font-sans text-muted"> · {window.l10n[REASONS[item.reason]]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {plan.targets.length === 0 ? (
        <p role="status">{window.l10n.absorbNothing}</p>
      ) : (
        <>
          <p class="text-xs text-muted">
            {base === null
              ? window.l10n.absorbRootTarget
              : plan.clean
                ? window.l10n.explainCreateAndSquash
                : window.l10n.absorbNeedsClean}
          </p>
          <div class="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => absorb(false)}>
              {window.l10n.createFixupCommits}
            </Button>
            <Button disabled={base === null || !plan.clean} onClick={() => absorb(true)}>
              {window.l10n.createAndSquash}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Work out where each staged hunk would go, then show it before anything is committed. */
export function openAbsorb() {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  requestRepositoryQuery(
    { kind: "absorbPlan" },
    (data) => {
      if (data.kind === "absorbPlan") {
        openContentDialog(
          window.l10n.absorbStaged,
          <AbsorbPreview plan={data.plan} repo={repo} />,
          true
        );
      }
    },
    repo
  );
}

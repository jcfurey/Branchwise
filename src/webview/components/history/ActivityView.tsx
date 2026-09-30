import { useEffect, useState } from "preact/hooks";

import { Button } from "@/webview/components/ui/Button";
import { openContentDialog } from "@/webview/lib/actions";
import { activity, markFailuresSeen } from "@/webview/lib/activity";
import { copyToClipboard } from "@/webview/lib/copy";
import { formatSeconds } from "@/webview/utils/date";

function ActivityView() {
  const [now, setNow] = useState(Date.now());
  const entries = activity.value;
  useEffect(() => {
    if (!entries.some((entry) => entry.finished === null)) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entries]);
  return (
    <div class="space-y-3 text-left">
      <Button
        onClick={() => {
          activity.value = activity.value.filter((entry) => entry.finished === null);
        }}
      >
        {window.l10n.clearActivity}
      </Button>
      {entries.length === 0 && <p>{window.l10n.activityEmpty}</p>}
      <ol class="divide-y divide-line-soft">
        {entries.map((entry) => (
          <li key={entry.id} class="space-y-2 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <b>{entry.title}</b>
              <span class={entry.error ? "text-git-deleted" : "text-muted"}>
                {entry.finished === null
                  ? window.l10n.activityRunning
                  : entry.error
                    ? window.l10n.activityFailed
                    : window.l10n.activitySucceeded}{" "}
                · {formatSeconds(entry.started, entry.finished ?? now)}
              </span>
            </div>
            <p class="break-all text-xs text-muted">{entry.repo}</p>
            {entry.detail && <p class="break-all text-ui">{entry.detail}</p>}
            {entry.error && (
              <>
                <pre class="max-h-60 overflow-auto rounded bg-editor p-3 text-xs whitespace-pre-wrap select-text">
                  {entry.error}
                </pre>
                <Button
                  onClick={() =>
                    copyToClipboard(
                      window.l10n.errorDetails,
                      `${entry.title}\n${entry.repo}\n${entry.error}`
                    )
                  }
                >
                  {window.l10n.copyError}
                </Button>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function openActivity() {
  markFailuresSeen();
  openContentDialog(window.l10n.operationActivity, <ActivityView />, true);
}

/** Running operations, and failures that no dialog showed, beside the header's tools. */
export function ActivityIndicator() {
  const active = activity.value.filter((entry) => entry.finished === null);
  const unseen = activity.value.filter((entry) => entry.unseen).length;
  if (active.length === 0 && unseen === 0) {
    return null;
  }
  return (
    <>
      {active.length > 0 && (
        <button
          class="flex cursor-pointer items-center gap-2 text-xs text-muted hover:text-fg"
          onClick={openActivity}
          role="status"
        >
          <span class="size-2 animate-pulse rounded-full bg-action" />
          {active[0]!.title}
          {active.length > 1 ? ` (+${active.length - 1})` : ""}
        </button>
      )}
      {unseen > 0 && (
        <button
          data-unseen-failures
          class="flex cursor-pointer items-center gap-2 text-xs text-git-deleted hover:text-fg"
          onClick={openActivity}
          role="alert"
        >
          <span class="size-2 rounded-full bg-git-deleted" />
          {window.l10n.unseenFailures.replace("{0}", String(unseen))}
        </button>
      )}
    </>
  );
}

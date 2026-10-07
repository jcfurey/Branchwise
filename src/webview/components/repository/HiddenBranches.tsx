import { useState } from "preact/hooks";

import { cleanPatterns, patternMatcher } from "@/backend/utils/branchPatterns";
import { Button } from "@/webview/components/ui/Button";
import { INPUT_CLASS } from "@/webview/components/ui/Input";
import { closeDialog, openContentDialog, setHiddenBranchPatterns } from "@/webview/lib/actions";
import { hiddenBranchPatterns } from "@/webview/lib/stores";
import { countHiddenBranches, hiddenBranchCount } from "@/webview/lib/stores/hidden-branches.store";

const LINK_CLASS =
  "cursor-pointer rounded px-1 text-link hover:underline focus:outline-1 focus:outline-focus";

/**
 * The patterns of the selected repository, one per line, with how many listed branches each one
 * hides as they are typed. Nothing changes until they are saved.
 */
function HiddenBranchesEditor({ initial }: { initial: string }) {
  const l10n = window.l10n;
  const [text, setText] = useState(initial);
  const patterns = cleanPatterns(text.split(/\r?\n/));

  return (
    <form
      class="space-y-2.5 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        closeDialog();
        setHiddenBranchPatterns(patterns);
      }}
    >
      <p>{l10n.hiddenBranchesExplain}</p>
      <textarea
        data-dialog-start=""
        rows={6}
        spellcheck={false}
        class={`${INPUT_CLASS} font-mono`}
        aria-label={l10n.hiddenBranchPatterns}
        placeholder={l10n.hiddenBranchPatterns}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      {patterns.length > 0 && (
        <div>
          <p class="text-muted">{l10n.hiddenBranchesPreview}</p>
          <ul data-hidden-branch-preview>
            {patterns.map((pattern) => (
              <li key={pattern} class="flex justify-between gap-3">
                <code class="break-all">{pattern}</code>
                <span data-hidden-count>{countHiddenBranches(patternMatcher([pattern]))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="flex justify-center">
        <Button type="submit" variant="primary">
          {l10n.save}
        </Button>
      </div>
    </form>
  );
}

/**
 * Edit which branches the selected repository hides. `suggestion`, when given and not already
 * there, is added as the last line, for the user to save or change.
 */
export function openHiddenBranches(suggestion?: string): void {
  const current = hiddenBranchPatterns.value;
  const lines =
    suggestion === undefined || current.includes(suggestion) ? current : [...current, suggestion];
  openContentDialog(
    window.l10n.hiddenBranches,
    <HiddenBranchesEditor initial={lines.join("\n")} />
  );
}

/**
 * A strip above the graph saying how many branches the patterns hide, with ways to show them all
 * or edit the patterns. Nothing while the patterns hide none.
 */
export function HiddenBranchesHint() {
  const count = hiddenBranchCount.value;
  return count === 0 ? null : <HiddenBranchesStrip count={count} />;
}

/** The strip for `count` hidden branches. The legend draws it with a count of its own. */
export function HiddenBranchesStrip({ count }: { count: number }) {
  const l10n = window.l10n;
  return (
    <div
      role="status"
      data-hidden-branches
      class="flex flex-wrap items-center gap-x-1 border-b border-line-soft px-3 py-0.5 text-xs text-muted"
    >
      <span>{l10n.branchesHiddenByPatterns.replace("{0}", String(count))}</span>
      <button type="button" class={LINK_CLASS} onClick={() => setHiddenBranchPatterns([])}>
        {l10n.showHiddenBranches}
      </button>
      <button type="button" class={LINK_CLASS} onClick={() => openHiddenBranches()}>
        {l10n.editHiddenBranches}
      </button>
    </div>
  );
}

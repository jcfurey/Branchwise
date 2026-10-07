import type { HistoryFilter } from "@/backend/types";
import { Button } from "@/webview/components/ui/Button";
import { SHOW_ALL_BRANCHES } from "@/webview/constants";
import { selectBranch } from "@/webview/lib/actions";
import { emptyFilter, setHistoryFilter } from "@/webview/lib/navigation";

/** The fields behind the Filters button that narrow a search, apart from the regex box. */
const FIELDS = [
  "author",
  "committer",
  "branch",
  "tag",
  "path",
  "changes",
  "since",
  "until"
] as const satisfies ReadonlyArray<keyof HistoryFilter>;

/** How many of the Filters fields hold something. */
export function activeFilterCount(filter: HistoryFilter): number {
  return FIELDS.filter((field) => (filter[field] ?? "") !== "").length;
}

/** A way to widen a search that found nothing. */
export type NoMatchSuggestion = "allBranches" | "clearFilters" | "noRegex" | "changes";

/**
 * What to suggest after a search found nothing, in the order to offer it: searching every branch
 * when the graph is filtered to `branch`, clearing the filled-in fields, matching literal text
 * instead of regular expressions, and looking for the text in the changes when only the messages
 * were searched. A search of one commit's history, or of lines, is not filtered to a branch.
 */
export function noMatchSuggestions(
  filter: HistoryFilter,
  branch: string
): Array<NoMatchSuggestion> {
  const suggestions: Array<NoMatchSuggestion> = [];
  if (branch !== "" && filter.revision === "" && (filter.lines ?? "") === "") {
    suggestions.push("allBranches");
  }
  if (activeFilterCount(filter) > 0) {
    suggestions.push("clearFilters");
  }
  if (filter.regex === true) {
    suggestions.push("noRegex");
  }
  if (filter.text.trim() !== "" && (filter.changes ?? "") === "") {
    suggestions.push("changes");
  }
  return suggestions;
}

/** Search again, widened as `suggestion` says. All branches is the branch choice, not a field. */
function applySuggestion(suggestion: NoMatchSuggestion, filter: HistoryFilter) {
  switch (suggestion) {
    case "allBranches":
      selectBranch(SHOW_ALL_BRANCHES);
      return;
    case "clearFilters":
      // The search text, the regex box and the commit whose history this is stay.
      setHistoryFilter({
        ...emptyFilter(),
        text: filter.text,
        revision: filter.revision,
        regex: filter.regex === true
      });
      return;
    case "noRegex":
      setHistoryFilter({ ...filter, regex: false });
      return;
    case "changes":
      setHistoryFilter({ ...filter, text: "", changes: filter.text.trim() });
      return;
  }
}

function label(suggestion: NoMatchSuggestion, filter: HistoryFilter) {
  const l10n = window.l10n;
  switch (suggestion) {
    case "allBranches":
      return l10n.searchAllBranches;
    case "clearFilters":
      return l10n.clearFiltersCount.replace("{0}", String(activeFilterCount(filter)));
    case "noRegex":
      return l10n.turnOffRegex;
    case "changes":
      return l10n.searchChangesInstead;
  }
}

/**
 * What the history shows when a search finds no commits: that nothing matched, and a button for
 * each way to widen the search that applies, which runs the search again widened.
 */
export function NoMatches({ filter, branch }: { filter: HistoryFilter; branch: string }) {
  const suggestions = noMatchSuggestions(filter, branch);
  return (
    <div data-no-matches class="space-y-2 p-6 text-muted">
      <p>{window.l10n.noHistoryMatches}</p>
      {suggestions.length > 0 && (
        <div class="flex flex-wrap items-center gap-2">
          <span>{window.l10n.noMatchesTry}</span>
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion}
              data-suggestion={suggestion}
              onClick={() => applySuggestion(suggestion, filter)}
            >
              {label(suggestion, filter)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

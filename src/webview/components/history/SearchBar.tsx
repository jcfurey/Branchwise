import { useEffect, useRef, useState } from "preact/hooks";

import type { HistoryFilter } from "@/backend/types";
import { Button } from "@/webview/components/ui/Button";
import { Checkbox } from "@/webview/components/ui/Checkbox";
import { INPUT_CLASS } from "@/webview/components/ui/Input";
import { Select } from "@/webview/components/ui/Select";
import { openFormDialog } from "@/webview/lib/actions";
import {
  deleteHistoryFilter,
  emptyFilter,
  historyActive,
  historyFilter,
  saveHistoryFilter,
  savedFilters,
  setHistoryFilter
} from "@/webview/lib/navigation";

import { TextField } from "./QueryControls";

export function SearchBar() {
  const active = historyFilter.value;
  const [draft, setDraft] = useState(active);
  const [expanded, setExpanded] = useState(false);
  const [savedName, setSavedName] = useState("");
  // Effects run a frame after mount. Only a filter that really changed replaces
  // the draft, so text typed into a freshly opened row is not thrown away.
  const applied = useRef(active);
  useEffect(() => {
    if (applied.current !== active) {
      applied.current = active;
      setDraft(active);
    }
  }, [active]);
  function update(patch: Partial<HistoryFilter>) {
    setDraft({ ...draft, ...patch });
  }
  function save() {
    setHistoryFilter(draft);
    openFormDialog({
      message: window.l10n.saveFilter,
      inputs: [{ kind: "text", label: window.l10n.filterName, value: savedName }],
      action: window.l10n.save,
      source: null,
      onSubmit: ([name]) => {
        saveHistoryFilter(name);
        setSavedName(name.trim());
      }
    });
  }
  return (
    <form
      role="search"
      class="border-b border-line-soft px-3 py-2 text-ui"
      onSubmit={(event) => {
        event.preventDefault();
        setHistoryFilter(draft);
      }}
    >
      <div class="flex flex-wrap items-center gap-2">
        <input
          data-history-search
          class={INPUT_CLASS + " max-w-lg flex-1"}
          aria-label={window.l10n.historySearch}
          placeholder={window.l10n.searchPlaceholder}
          title={window.l10n.searchHistoryHint}
          value={draft.text}
          onInput={(event) => update({ text: event.currentTarget.value })}
        />
        <Button type="submit">{window.l10n.searchSubmit}</Button>
        <Button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {window.l10n.historyFilters}
          {[draft.author, draft.path, draft.since, draft.until].filter(Boolean).length > 0
            ? " •"
            : ""}
        </Button>
        {historyActive.value && (
          <Button
            onClick={() => {
              setHistoryFilter(emptyFilter());
              setSavedName("");
            }}
          >
            {window.l10n.returnToGraph}
          </Button>
        )}
      </div>
      {expanded && (
        <div class="mt-3 space-y-3">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextField
              label={window.l10n.historyAuthor}
              value={draft.author}
              change={(author) => update({ author })}
            />
            <TextField
              label={window.l10n.historyPath}
              value={draft.path}
              change={(file) => update({ path: file })}
            />
            <TextField
              label={window.l10n.historySince}
              type="date"
              value={draft.since}
              change={(since) => update({ since })}
            />
            <TextField
              label={window.l10n.historyUntil}
              type="date"
              value={draft.until}
              change={(until) => update({ until })}
            />
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <Checkbox
              label={window.l10n.followRenames}
              checked={draft.follow}
              onInput={(event) => update({ follow: event.currentTarget.checked })}
            />
            <Button onClick={save}>{window.l10n.saveFilter}</Button>
            <div class="w-48">
              <Select
                aria-label={window.l10n.savedFilters}
                value={savedName}
                onChange={(name) => {
                  setSavedName(name);
                  const saved = savedFilters.value.find((item) => item.name === name);
                  if (saved) {
                    setHistoryFilter({ ...saved.filter });
                  }
                }}
                options={[
                  { label: window.l10n.savedFilters, value: "" },
                  ...savedFilters.value.map((item) => ({ label: item.name, value: item.name }))
                ]}
              />
            </div>
            {savedName && (
              <Button
                onClick={() => {
                  deleteHistoryFilter(savedName);
                  setSavedName("");
                }}
              >
                {window.l10n.deleteSavedFilter}
              </Button>
            )}
            <Button
              onClick={() => {
                setDraft(emptyFilter());
                setHistoryFilter(emptyFilter());
                setSavedName("");
              }}
            >
              {window.l10n.clearFilters}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

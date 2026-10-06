import { Fragment } from "preact";

import { openContentDialog } from "@/webview/lib/actions";
import {
  keyLabel,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type ShortcutGroup,
  singleKeysOn
} from "@/webview/lib/shortcuts";

function groupName(group: ShortcutGroup) {
  const l10n = window.l10n;
  switch (group) {
    case "navigation":
      return l10n.shortcutGroupNavigation;
    case "commit":
      return l10n.shortcutGroupCommit;
    case "search":
      return l10n.searchSubmit;
    case "panels":
      return l10n.shortcutGroupPanels;
  }
}

/** Every shortcut of the page, read from the same table that runs them, by group. */
export function ShortcutSheet() {
  const l10n = window.l10n;
  return (
    <div data-shortcut-sheet class="space-y-4 text-left">
      {!singleKeysOn() && (
        <p role="note" class="text-muted">
          {l10n.shortcutsOff}
        </p>
      )}
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group} data-shortcut-group={group}>
          <h3 class="mb-1 font-bold">{groupName(group)}</h3>
          {group === "commit" && <p class="mb-1 text-muted">{l10n.shortcutRowHint}</p>}
          <table class="w-full border-collapse">
            <thead class="sr-only">
              <tr>
                <th scope="col">{l10n.shortcutKeysColumn}</th>
                <th scope="col">{l10n.shortcutActionColumn}</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.filter((entry) => entry.group === group).map((entry) => (
                <tr key={entry.id} data-shortcut-id={entry.id}>
                  <td class="w-1/3 py-1 pr-4 align-top whitespace-nowrap">
                    {/* A space between keys keeps them apart when read aloud or copied. */}
                    {entry.keys.map((combo, index) => (
                      <Fragment key={keyLabel(combo)}>
                        {index > 0 && " "}
                        <kbd class="inline-block rounded-sm border border-keycap-border bg-keycap px-1.5 text-xs leading-5 text-keycap-fg">
                          {keyLabel(combo)}
                        </kbd>
                      </Fragment>
                    ))}
                  </td>
                  <td class="py-1 align-top">{entry.label(l10n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export function openShortcutSheet(): void {
  openContentDialog(window.l10n.keyboardShortcuts, <ShortcutSheet />);
}

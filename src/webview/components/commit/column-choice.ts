import type { OptionalColumn } from "@/types";
import { OPTIONAL_COLUMNS } from "@/webview/constants";
import { openFormDialog, setColumnShown, setHiddenColumns } from "@/webview/lib/actions";
import { hiddenColumns } from "@/webview/lib/stores";
import type { ContextMenuEntry } from "@/webview/types";

/** The context menu key of the table's headings, which stay highlighted while it is open. */
export const COLUMNS_MENU = "columns";

/** The columns the user can hide, in table order. */
const OPTIONAL = Object.keys(OPTIONAL_COLUMNS) as Array<OptionalColumn>;

/** A column's name as its heading shows it. */
function columnTitle(column: OptionalColumn) {
  const l10n = window.l10n;
  return { date: l10n.date, author: l10n.author, commit: l10n.commit }[column];
}

/**
 * The menu of the table's headings: one checked entry per column that can be hidden, ticked while
 * it shows. The graph and the description are not offered, as they cannot be hidden. Built when
 * the menu opens, so the ticks are current.
 */
export function columnMenu(): Array<ContextMenuEntry> {
  const hidden = hiddenColumns.value;
  return OPTIONAL.map((column) => {
    const shown = !hidden.includes(column);
    return {
      title: columnTitle(column),
      checked: shown,
      onClick: () => setColumnShown(column, !shown)
    };
  });
}

/**
 * The same choice as the headings' menu, as a dialog of checkboxes, for the Settings & Tools menu
 * and the keyboard.
 */
export function openColumnsDialog(): void {
  const l10n = window.l10n;
  const hidden = hiddenColumns.value;
  openFormDialog({
    message: l10n.columnsDialog,
    inputs: OPTIONAL.map((column) => ({
      kind: "checkbox" as const,
      label: columnTitle(column),
      value: !hidden.includes(column)
    })),
    action: l10n.applyShort,
    source: null,
    onSubmit: (shown) => setHiddenColumns(OPTIONAL.filter((_, index) => shown[index] === false))
  });
}

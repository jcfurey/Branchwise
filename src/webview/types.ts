import type { ComponentChildren } from "preact";

import type { ActionRequest } from "@/backend/types";
import type { ShortcutId } from "@/webview/lib/shortcuts";

export type { BranchDisplay, FocusDimming } from "@/types";

/**
 * The branch the graph shows or emphasises: `"*"` for every branch, otherwise a name as the branch
 * list spells it (`main`, `feature/x`, `remotes/origin/main`). Any string fits; the `"*"` member
 * is kept apart from `string` only so that editors still offer it.
 */
export type CommitBranchType = "*" | (string & {});

/* Context menus */

/**
 * A row of a context menu, or `null` for a separator line. `shortcut` names the key that does
 * the same from the commit row, which the menu shows beside the title.
 */
export type ContextMenuEntry = { title: string; onClick: () => void; shortcut?: ShortcutId } | null;

/** The open context menu. */
export type ContextMenuState = {
  /** Viewport position, in CSS pixels, that the menu hangs from. */
  x: number;
  y: number;
  entries: Array<ContextMenuEntry>;
  /** Key of the element that owns the menu, such as `ref:head:main`; it stays highlighted. */
  source: string;
};

/* Dialogs */

/**
 * One control of a form dialog, seeded from `value`. Without a `label`, the control is named by
 * the dialog's message. A `"ref"` field must hold a valid Git ref name before the form submits.
 */
export type DialogInput =
  | { kind: "text"; label?: string; value: string; placeholder?: string }
  | { kind: "ref"; label?: string; value: string }
  | { kind: "textarea"; label?: string; value: string; placeholder?: string }
  | {
      kind: "select";
      label?: string;
      /** The `value` of the option chosen at first. */
      value: string;
      options: Array<{ label: string; value: string }>;
    }
  | { kind: "checkbox"; label: string; value: boolean };

/** What one control submits. Written as a bare conditional so that it spreads over a union. */
type SubmittedValue<Input> = Input extends { kind: "checkbox" } ? boolean : string;

/**
 * The values a form submits for `T`, position by position: a boolean for a checkbox and a string
 * for every other control. A tuple of inputs gives a tuple of values.
 */
export type DialogValues<T extends ReadonlyArray<DialogInput>> = {
  [Index in keyof T]: SubmittedValue<T[Index]>;
};

/** What a dialog shows, one member per kind. */
export type DialogBody =
  /** A heading over any content, closed with a button. `wide` allows a wider panel. */
  | { kind: "content"; message: string; content: ComponentChildren; wide?: boolean }
  /**
   * A question, with fields when `inputs` is not empty. `action` labels the submit button, and
   * `onSubmit` receives one value per input, in order. `source` is the key of the element that
   * started it, as in `ContextMenuState`, or `null`. `destructive` puts the first focus on Cancel.
   */
  | {
      kind: "form";
      message: ComponentChildren;
      inputs: Array<DialogInput>;
      action: string;
      onSubmit: (values: Array<string | boolean>) => void;
      source: string | null;
      destructive?: boolean;
    }
  /**
   * Work in progress. `started`, in milliseconds since the epoch, adds a running count of seconds;
   * `onCancel` adds a button that calls it.
   */
  | {
      kind: "running";
      message: string;
      detail?: string;
      started?: number;
      onCancel?: () => void;
    }
  /** A failure, with details such as Git's own text in `reason`, or `null` for none. */
  | { kind: "error"; message: string; reason: string | null };

/**
 * The open dialog. Each opening takes a larger `token` than the last, and a new token makes the
 * dialog start afresh.
 */
export type DialogState = DialogBody & { token: number };

/* Actions */

/** Takes `repo` off each request separately, so that every command keeps its own fields. */
type WithoutRepository<Request> = Request extends { repo: string } ? Omit<Request, "repo"> : never;

/**
 * An action as the page's code asks for it. `runAction` adds the selected repository, so the
 * command names everything else its request needs.
 */
export type ActionCommand = WithoutRepository<ActionRequest>;

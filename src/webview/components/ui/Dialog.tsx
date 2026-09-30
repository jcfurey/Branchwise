import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

import { Button } from "@/webview/components/ui/Button";
import { Checkbox } from "@/webview/components/ui/Checkbox";
import { Icon } from "@/webview/components/ui/Icons";
import { INPUT_CLASS } from "@/webview/components/ui/Input";
import { Select } from "@/webview/components/ui/Select";
import { closeDialog } from "@/webview/lib/actions";
import { copyToClipboard } from "@/webview/lib/copy";
import { dialog } from "@/webview/lib/stores";
import type { DialogInput, DialogState } from "@/webview/types";
import { formatSeconds } from "@/webview/utils/date";
import { hasInvalidRefChars } from "@/webview/utils/ref";

type Kind<K extends DialogState["kind"]> = Extract<DialogState, { kind: K }>;

/** What each kind of dialog draws inside the panel. `titleId` names the panel. */
type BodyProps<K extends DialogState["kind"]> = { state: Kind<K>; titleId: string };

type Value = string | boolean;

/**
 * Elements Tab can reach, as the browser counts them. Disabled controls and `tabindex="-1"`
 * are filtered out afterwards; visibility is not checked.
 */
const TABBABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

/** Where a dialog without a safe button starts: its first text field or button. */
const STARTERS = 'input[type="text"], button';

function enabled(element: Element) {
  return !element.matches(":disabled");
}

function tabbable(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => element.getAttribute("tabindex") !== "-1" && enabled(element)
  );
}

/**
 * The element a new dialog focuses. A destructive form, a running operation and an error mark
 * the button that changes nothing; anything else starts on its first text field or enabled
 * button, and on the panel itself when it has neither.
 */
function startingPoint(panel: HTMLElement) {
  return (
    panel.querySelector<HTMLElement>("[data-dialog-start]") ??
    [...panel.querySelectorAll<HTMLElement>(STARTERS)].find(enabled) ??
    panel
  );
}

/**
 * A held Enter or Space repeats on whatever has focus, which is now the dialog the first press
 * opened. Only a fresh press may activate a control. A text area takes the repeats as new lines.
 */
function blockHeldKeys(event: KeyboardEvent) {
  if (
    event.repeat &&
    (event.key === "Enter" || event.key === " ") &&
    !(event.target instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/** Tab from the last control goes back to the first, and Shift+Tab from the first to the last. */
function containTab(event: KeyboardEvent, panel: HTMLElement | null) {
  if (event.key !== "Tab" || panel === null) {
    return;
  }
  const controls = tabbable(panel);
  const first = controls[0];
  const last = controls.at(-1);
  if (first === undefined || last === undefined) {
    return;
  }
  const from = event.target;
  if (event.shiftKey && (from === first || from === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && from === last) {
    event.preventDefault();
    first.focus();
  }
}

/** `template` with its `{0}` replaced by `value`, taken literally. */
function fill(template: string, value: string) {
  return template.replace("{0}", () => value);
}

function hasOwnLabel(input: DialogInput) {
  return input.kind !== "checkbox" && Boolean(input.label);
}

/**
 * Why the form cannot be sent: the first ref field, in order, that is empty or holds something
 * Git refuses in a ref name. Other fields are never checked.
 */
function refProblem(inputs: ReadonlyArray<DialogInput>, values: ReadonlyArray<Value>) {
  for (const [index, input] of inputs.entries()) {
    if (input.kind !== "ref") {
      continue;
    }
    const value = String(values[index] ?? "");
    if (value === "") {
      return "empty";
    }
    if (hasInvalidRefChars(value)) {
      return "invalid";
    }
  }
  return null;
}

type FieldProps = {
  input: DialogInput;
  id: string;
  value: Value;
  /** The message's id, for a field without a label of its own. */
  labelledBy: string | undefined;
  onChange: (value: Value) => void;
};

function Field({ input, id, value, labelledBy, onChange }: FieldProps) {
  switch (input.kind) {
    case "text":
    case "ref":
      return (
        <input
          type="text"
          id={id}
          class={INPUT_CLASS}
          value={String(value)}
          placeholder={input.kind === "text" ? input.placeholder : undefined}
          aria-labelledby={labelledBy}
          onInput={(event) => onChange(event.currentTarget.value)}
        />
      );
    case "textarea":
      return (
        <textarea
          id={id}
          rows={4}
          class={INPUT_CLASS}
          value={String(value)}
          placeholder={input.placeholder}
          aria-labelledby={labelledBy}
          onInput={(event) => onChange(event.currentTarget.value)}
        />
      );
    case "select":
      return (
        <Select
          id={id}
          options={input.options}
          value={String(value)}
          onChange={onChange}
          aria-labelledby={labelledBy}
        />
      );
    case "checkbox":
      return (
        <Checkbox
          id={id}
          label={input.label}
          checked={value === true}
          onInput={(event) => onChange(event.currentTarget.checked)}
        />
      );
  }
}

/**
 * A native tooltip around `children`, shown while `text` is set. It sits on a wrapper because
 * not every browser shows the tooltip of a disabled button. The attribute is set by hand, since
 * Preact would leave an empty `title` behind once the text goes away.
 */
function Tooltip({ text, children }: { text: string | undefined; children: ComponentChildren }) {
  const wrapper = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (text === undefined) {
      wrapper.current?.removeAttribute("title");
    } else {
      wrapper.current?.setAttribute("title", text);
    }
  }, [text]);

  return (
    <span ref={wrapper} class="flex">
      {children}
    </span>
  );
}

function FormBody({ state, titleId }: BodyProps<"form">) {
  const fieldId = useId();
  const [values, setValues] = useState(() => state.inputs.map((input) => input.value));
  // Edits land here at once, so a submit in the same task as the last keystroke still sends it.
  const latest = useRef(values);
  const sent = useRef(false);

  const labelled = state.inputs.some(hasOwnLabel);
  const problem = refProblem(state.inputs, values);

  function edit(index: number, value: Value) {
    latest.current = latest.current.map((current, at) => (at === index ? value : current));
    setValues(latest.current);
  }

  function submit(event: Event) {
    // The webview must never navigate, whether or not the form is accepted.
    event.preventDefault();
    if (sent.current || refProblem(state.inputs, latest.current) !== null) {
      return;
    }
    sent.current = true;
    // Close first: the callback often opens the next dialog, which has to stay open.
    closeDialog();
    state.onSubmit(latest.current);
  }

  return (
    <form onSubmit={submit}>
      <p id={titleId}>{state.message}</p>
      {state.inputs.length > 0 && (
        <div
          class={
            labelled
              ? "mt-2.5 grid gap-2.5 text-left sm:grid-cols-labelled sm:items-center"
              : "mt-2.5 grid gap-2.5 text-left"
          }
        >
          {state.inputs.map((input, index) => {
            const id = `${fieldId}-${index}`;
            const field = (
              <Field
                input={input}
                id={id}
                value={values[index] ?? input.value}
                labelledBy={hasOwnLabel(input) ? undefined : titleId}
                onChange={(value) => edit(index, value)}
              />
            );
            if (!labelled) {
              return <Fragment key={index}>{field}</Fragment>;
            }
            if (input.kind === "checkbox") {
              return (
                <div key={index} class="sm:col-span-2">
                  {field}
                </div>
              );
            }
            // A field without a label keeps an empty cell, so the columns stay aligned.
            return (
              <Fragment key={index}>
                {input.label ? (
                  <label for={id} class="break-words">
                    {input.label}
                  </label>
                ) : (
                  <span class="hidden sm:block" />
                )}
                {field}
              </Fragment>
            );
          })}
        </div>
      )}
      <div class="mt-2.5 flex justify-center gap-3">
        <Tooltip
          text={
            problem === "invalid" ? fill(window.l10n.invalidCharacters, state.action) : undefined
          }
        >
          <Button type="submit" disabled={problem !== null}>
            {state.action}
          </Button>
        </Tooltip>
        <Button
          data-dialog-cancel="true"
          data-dialog-start={state.destructive === true ? "" : undefined}
          onClick={() => closeDialog()}
        >
          {window.l10n.dialogCancel}
        </Button>
      </div>
    </form>
  );
}

/** Two arrows chasing each other round a circle, drawn in a 12 × 16 box. */
function SyncGlyph() {
  return (
    <Icon
      viewBox="0 0 12 16"
      class="size-5 shrink-0 animate-spin text-muted motion-reduce:animate-none"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M1.57 7.22A4.5 4.5 0 0 1 9.9 5.75M7.7 4.94L9.9 5.75L10.3 3.44" />
      <path d="M10.43 8.78A4.5 4.5 0 0 1 2.1 10.25M4.3 11.06L2.1 10.25L1.7 12.56" />
    </Icon>
  );
}

/** A triangle with an exclamation mark. */
function WarningGlyph() {
  return (
    <Icon
      class="size-4 shrink-0 text-muted"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M8 1.75L14.75 13.75H1.25Z" />
      <path d="M8 6V9.75" />
      <circle cx="8" cy="11.75" r="0.85" fill="currentColor" stroke="none" />
    </Icon>
  );
}

function RunningBody({ state, titleId }: BodyProps<"running">) {
  const { started, onCancel } = state;
  const timed = started !== undefined;
  // The time the dialog appeared, then once a second while it shows how long Git has run.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timed) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [timed]);

  return (
    <>
      <p id={titleId} class="flex items-center justify-center gap-1.5">
        <SyncGlyph />
        {`${state.message} ...`}
      </p>
      {state.detail ? (
        <p class="mt-3 text-left text-xs whitespace-pre-wrap wrap-anywhere select-text">
          {state.detail}
        </p>
      ) : null}
      {started === undefined ? null : (
        <p class="mt-3 text-muted">
          {fill(window.l10n.elapsedSeconds, formatSeconds(started, now))}
          <br />
          {window.l10n.operationKeepsRunning}
        </p>
      )}
      <div class="mt-4 flex justify-center gap-2">
        {/* Stopping is a request to the host; its answer replaces or closes this dialog. */}
        {onCancel && <Button onClick={() => onCancel()}>{window.l10n.cancelOperation}</Button>}
        <Button data-dialog-start="" onClick={() => closeDialog()}>
          {window.l10n.hideOperation}
        </Button>
      </div>
    </>
  );
}

function ErrorBody({ state, titleId }: BodyProps<"error">) {
  // An empty reason has nothing to show or copy.
  const reason = state.reason || null;

  return (
    <>
      <p id={titleId} class="flex items-center justify-center gap-1.5">
        <WarningGlyph />
        {state.message}
      </p>
      {reason !== null && (
        <p class="mt-2.5 text-left break-words whitespace-pre-wrap italic select-text">{reason}</p>
      )}
      <div class="mt-4 flex justify-center gap-2">
        {reason !== null && (
          <Button onClick={() => copyToClipboard(window.l10n.errorDetails, reason)}>
            {window.l10n.copyError}
          </Button>
        )}
        <Button data-dialog-start="" onClick={() => closeDialog()}>
          {window.l10n.dialogDismiss}
        </Button>
      </div>
    </>
  );
}

function ContentBody({ state, titleId }: BodyProps<"content">) {
  return (
    <>
      <h2 id={titleId} class="mb-3 font-bold">
        {state.message}
      </h2>
      {state.content}
      <div class="mt-3">
        <Button onClick={() => closeDialog()}>{window.l10n.close}</Button>
      </div>
    </>
  );
}

function Body({ state, titleId }: { state: DialogState; titleId: string }) {
  switch (state.kind) {
    case "form":
      return <FormBody state={state} titleId={titleId} />;
    case "running":
      return <RunningBody state={state} titleId={titleId} />;
    case "error":
      return <ErrorBody state={state} titleId={titleId} />;
    case "content":
      return <ContentBody state={state} titleId={titleId} />;
  }
}

/** One dialog, from the moment its token is stored until another token or `null` replaces it. */
function Modal({ state }: { state: DialogState }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Before the first paint, so a key the user is still holding repeats inside the dialog.
  useLayoutEffect(() => {
    if (panel.current !== null) {
      startingPoint(panel.current).focus();
    }
  }, []);

  // Escape closes from anywhere, unless a control already used it for itself.
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        closeDialog();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const wide = state.kind === "content" && state.wide === true;

  return (
    <>
      {/* The second click of an opening double-click lands here, and must not close the dialog. */}
      <div
        class="fixed inset-0 z-30 bg-black/20"
        onClick={(event) => {
          if (event.detail < 2) {
            closeDialog();
          }
        }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        class={`fixed top-1/2 left-1/2 z-40 max-h-[80vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-line bg-menu p-5 text-center text-menu-fg shadow-dialog outline-none ${
          wide ? "w-[min(960px,calc(100vw-2rem))]" : "w-[min(600px,calc(100vw-2rem))]"
        }`}
        onKeyDownCapture={blockHeldKeys}
        onKeyDown={(event) => containTab(event, panel.current)}
      >
        <Body state={state} titleId={titleId} />
      </div>
    </>
  );
}

/**
 * The modal dialog of the webview: whatever the `dialog` store holds, drawn as one panel over a
 * dimmed page. A new token is a new dialog, with its own values, focus and listeners. Every way
 * of closing goes through `closeDialog`, which also returns focus to where it came from.
 */
export function Dialog() {
  const state = dialog.value;
  if (state === null) {
    return null;
  }

  return <Modal key={state.token} state={state} />;
}

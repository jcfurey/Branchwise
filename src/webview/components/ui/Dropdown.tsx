import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { ChevronDownIcon } from "@/webview/components/ui/Icons";

/** The most options the open panel renders at once. The keyboard and the filter reach the rest. */
export const DROPDOWN_PAGE = 200;

/** Clearance between the panel and each side of the window. */
const EDGE = 8;
/** Space between the trigger and the panel. */
const GAP = 4;
/** The panel's own limits, `max-w-96` and `max-h-72`. */
const WIDEST = 384;
const TALLEST = 288;

type Option = { label: string; value: string };

type DropdownProps = {
  label: string;
  options: Array<Option>;
  value: string | undefined;
  onChange: (value: string) => void;
  class?: string;
  disabled?: boolean;
};

/**
 * Where the panel goes. It lines up with the trigger's right edge, keeps 8 px from both sides of
 * the window, and opens upwards only when it does not fit below and there is more room above.
 * `left` counts from the trigger's left edge.
 */
export function fitPanel(
  trigger: { left: number; right: number; top: number; bottom: number },
  width: number,
  height: number,
  viewport: { width: number; height: number }
): { left: number; maxWidth: number; maxHeight: number; up: boolean } {
  const maxWidth = Math.max(0, Math.min(WIDEST, viewport.width - 2 * EDGE));
  const right = Math.min(trigger.right, viewport.width - EDGE);
  const x = Math.max(EDGE, right - Math.min(width, maxWidth));

  const below = viewport.height - trigger.bottom - GAP - EDGE;
  const above = trigger.top - GAP - EDGE;
  const up = height > below && above > below;

  return {
    left: x - trigger.left,
    maxWidth,
    maxHeight: Math.max(0, Math.min(TALLEST, up ? above : below)),
    up
  };
}

/** Measure the panel as it lays out by default, then keep it inside the window. */
function place(trigger: HTMLElement, panel: HTMLElement) {
  // Limits left by an earlier placement would stop a narrowed panel from growing again.
  panel.removeAttribute("style");
  const { width, height } = panel.getBoundingClientRect();
  const fit = fitPanel(trigger.getBoundingClientRect(), width, height, {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight
  });

  const style = panel.style;
  style.left = `${fit.left}px`;
  style.right = "auto";
  style.maxWidth = `${fit.maxWidth}px`;
  style.maxHeight = `${fit.maxHeight}px`;
  if (fit.up) {
    style.top = "auto";
    style.bottom = "100%";
    style.marginTop = "0";
    style.marginBottom = `${GAP}px`;
  }
}

/** The options whose label contains the text, ignoring case. An empty filter keeps them all. */
function matching(options: Array<Option>, text: string) {
  if (text === "") {
    return options;
  }

  const needle = text.toLowerCase();
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}

/** The active row is highlighted, and the chosen one is shaded unless it is also active. */
function rowClass(active: boolean, chosen: boolean) {
  const row = "cursor-pointer truncate px-3 py-1";
  if (active) {
    return `${row} bg-menu-active text-menu-active-fg`;
  }

  return chosen ? `${row} bg-btn-hover` : row;
}

/** Put each part in place of its `{n}` in a localized template. */
function fill(template: string, ...parts: Array<string | number>) {
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    String(parts[Number(index)] ?? placeholder)
  );
}

/** `useId` starts again in every Preact root, but ids must be unique in the whole document. */
let instances = 0;

/**
 * A labelled button that opens a filterable list of options. It shows `value` and reports a
 * different choice through `onChange`. Long lists render one page of `DROPDOWN_PAGE` options,
 * the page that holds the active option.
 */
export function Dropdown({
  label,
  options,
  value,
  onChange,
  class: className,
  disabled = false
}: DropdownProps) {
  const [ids] = useState(() => {
    instances += 1;
    return `dropdown-${instances}`;
  });
  const labelId = `${ids}-label`;
  const valueId = `${ids}-value`;
  const listId = `${ids}-list`;
  const optionId = (position: number) => `${ids}-option-${position}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Whether the next render scrolls the active option into view. The pointer never asks. */
  const reveal = useRef(false);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  // A position among the matches. It outlives a shorter list, which shows it on the last match.
  const [active, setActive] = useState(0);

  const shown = open && !disabled;
  const chosenIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value]
  );
  const chosen = options[chosenIndex];
  const matches = useMemo(() => (shown ? matching(options, filter) : []), [shown, options, filter]);
  const count = matches.length;
  const current = Math.min(active, count - 1);
  const start = current < 0 ? 0 : current - (current % DROPDOWN_PAGE);
  const page = matches.slice(start, start + DROPDOWN_PAGE);

  // Disabling closes the panel for good: enabling the trigger again does not bring it back.
  useLayoutEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  // Before the first paint, and again whenever the rendered options change.
  useLayoutEffect(() => {
    if (shown && triggerRef.current !== null && panelRef.current !== null) {
      place(triggerRef.current, panelRef.current);
    }
  }, [shown, options, filter, start]);

  useLayoutEffect(() => {
    if (!shown) {
      return;
    }

    inputRef.current?.focus();
    // Capture, so a handler that stops the press cannot keep the panel open.
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const replace = () => {
      if (triggerRef.current !== null && panelRef.current !== null) {
        place(triggerRef.current, panelRef.current);
      }
    };

    document.addEventListener("pointerdown", dismissOutside, true);
    window.addEventListener("resize", replace);

    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      window.removeEventListener("resize", replace);
    };
  }, [shown]);

  useLayoutEffect(() => {
    if (!reveal.current) {
      return;
    }

    reveal.current = false;
    listRef.current?.children[current - start]?.scrollIntoView({ block: "nearest" });
  });

  function openPanel() {
    setFilter("");
    setActive(Math.max(chosenIndex, 0));
    setOpen(true);
    reveal.current = true;
  }

  function close(focusTrigger: boolean) {
    setOpen(false);
    if (focusTrigger) {
      triggerRef.current?.focus();
    }
  }

  function choose(option: Option) {
    // Focus is back on the trigger before the caller hears of the choice, so it may move it.
    close(true);
    if (option.value !== value) {
      onChange(option.value);
    }
  }

  function move(position: number) {
    if (count > 0) {
      setActive(position);
      reveal.current = true;
    }
  }

  function onTriggerClick() {
    if (disabled) {
      return;
    }

    if (shown) {
      close(true);
    } else {
      openPanel();
    }
  }

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (disabled || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
      return;
    }

    event.preventDefault();
    if (shown) {
      inputRef.current?.focus();
    } else {
      openPanel();
    }
  }

  function onFilterInput(text: string) {
    setFilter(text);
    setActive(0);
    reveal.current = true;
  }

  function onFilterKeyDown(event: KeyboardEvent) {
    const last = count - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(current >= last ? 0 : current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(current <= 0 ? last : current - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(last);
        break;
      case "Enter": {
        event.preventDefault();
        const option = matches[current];
        if (option !== undefined) {
          choose(option);
        }
        break;
      }
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        // The browser's tab order goes on from here.
        close(false);
        break;
    }
  }

  return (
    <div ref={rootRef} class="flex min-w-0 items-center gap-2">
      <span id={labelId} class="shrink-0 whitespace-nowrap">
        {label}:
      </span>
      <div class="relative min-w-0">
        <button
          ref={triggerRef}
          type="button"
          class={[
            "flex w-full min-w-0 cursor-pointer items-center gap-1 rounded-md py-1 pr-2 pl-3",
            "bg-dropdown text-dropdown-fg outline-1 outline-dropdown-border",
            "focus-visible:outline-2 focus-visible:outline-focus",
            "disabled:cursor-not-allowed disabled:opacity-60",
            className
          ]
            .filter(Boolean)
            .join(" ")}
          title={chosen?.value}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={shown}
          aria-controls={listId}
          aria-labelledby={`${labelId} ${valueId}`}
          onClick={onTriggerClick}
          onKeyDown={onTriggerKeyDown}
        >
          <span id={valueId} class="min-w-0 flex-1 truncate text-left">
            {chosen?.label}
          </span>
          <ChevronDownIcon class="size-4 shrink-0" />
        </button>
        {shown && (
          <div
            ref={panelRef}
            class={[
              "absolute top-full right-0 z-10 mt-1 flex max-h-72 w-max max-w-96 min-w-full flex-col",
              "rounded-md border border-line bg-menu text-menu-fg shadow-md"
            ].join(" ")}
          >
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={current < 0 ? undefined : optionId(current)}
              aria-labelledby={labelId}
              autocomplete="off"
              spellcheck={false}
              placeholder={fill(window.l10n.filterPlaceholder, label)}
              class={[
                "m-1 min-w-0 shrink-0 rounded-sm bg-input px-2 py-1 text-input-fg",
                "outline-1 outline-line focus:outline-focus"
              ].join(" ")}
              value={filter}
              onInput={(event) => onFilterInput(event.currentTarget.value)}
              onKeyDown={onFilterKeyDown}
            />
            {count === 0 ? (
              <p class="px-3 py-1 italic">{window.l10n.noResultsFound}</p>
            ) : (
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-labelledby={labelId}
                class="min-h-0 overflow-y-auto py-1"
              >
                {page.map((option, offset) => {
                  const position = start + offset;
                  const isActive = position === current;
                  const isChosen = option.value === value;
                  // The pointer only highlights. Scrolling would move the list under it.
                  return (
                    <li
                      key={offset}
                      id={optionId(position)}
                      role="option"
                      aria-selected={isChosen}
                      data-active={isActive}
                      title={option.value === option.label ? undefined : option.value}
                      class={rowClass(isActive, isChosen)}
                      onPointerMove={() => setActive(position)}
                      onClick={() => choose(option)}
                    >
                      {option.label}
                    </li>
                  );
                })}
              </ul>
            )}
            {count > DROPDOWN_PAGE && (
              <p role="status" class="shrink-0 border-t border-line px-3 py-1 text-xs text-muted">
                {fill(window.l10n.dropdownPage, start + 1, start + page.length, count)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

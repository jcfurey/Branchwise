import type { ComponentProps } from "preact";

import { Icon } from "./Icons";

type CheckboxProps = Omit<ComponentProps<"input">, "class" | "type" | "children"> & {
  label: string;
};

/**
 * Long words, such as repository paths, break anywhere rather than run out of the container. The
 * whole label fades while its checkbox is disabled.
 */
const LABEL_CLASS = [
  "flex cursor-pointer items-center gap-2 wrap-anywhere select-none",
  "has-disabled:cursor-not-allowed has-disabled:opacity-60"
].join(" ");

/** The native box without its own look. The outline keeps it visible on a matching background. */
const INPUT_CLASS = [
  "peer size-4 cursor-pointer appearance-none rounded bg-checkbox outline-1 outline-line",
  "checked:bg-checkbox-checked checked:outline-checkbox-checked",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
  "disabled:cursor-not-allowed"
].join(" ");

/** The tick follows the box's live state, and lets clicks through to it. */
const TICK_CLASS = [
  "pointer-events-none absolute inset-0 m-auto size-3.5 text-checkbox-check",
  "opacity-0 peer-checked:opacity-100"
].join(" ");

/**
 * A native checkbox in the theme's colours, named by the label around it. The props other than
 * `label` go to the input.
 */
export function Checkbox({ label, ...input }: CheckboxProps) {
  return (
    <label class={LABEL_CLASS}>
      <span class="relative flex size-4 shrink-0">
        <input {...input} type="checkbox" class={INPUT_CLASS} />
        <Icon
          class={TICK_CLASS}
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3.75 8.25 6.75 11.25 12.25 4.75" />
        </Icon>
      </span>
      {label}
    </label>
  );
}

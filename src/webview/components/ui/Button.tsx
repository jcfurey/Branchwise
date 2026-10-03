import type { ComponentProps } from "preact";

type ButtonProps = ComponentProps<"button"> & { variant?: "default" | "primary" | "ghost" };

/** The frame, text and states every look shares. */
const SHAPE = [
  "inline-flex cursor-pointer items-center justify-center gap-1 rounded border px-2.5 py-1",
  "text-ui font-medium select-none focus:outline-1 focus:outline-focus",
  "disabled:cursor-not-allowed disabled:opacity-50"
].join(" ");

/**
 * The colours of each look. The primary and ghost borders are there but transparent, so every
 * look has the same height. A background class from the caller comes later in the stylesheet
 * than `bg-btn`, so it wins, and the hover colour, which has variants, wins over both.
 */
const LOOKS = {
  default: `${SHAPE} border-line bg-btn enabled:hover:bg-btn-hover`,
  primary: `${SHAPE} border-transparent bg-action text-action-fg enabled:hover:bg-action-hover`,
  // A toolbar button: no frame until the pointer is over it, and square around an icon.
  ghost: `${SHAPE} border-transparent bg-transparent px-1.5 enabled:hover:bg-btn-hover`
};

/**
 * A native button in the webview's look. It does not submit a form unless it is given
 * `type="submit"`, and its `class` adds to its own classes. Every other prop goes to the button.
 */
export function Button({
  variant = "default",
  type = "button",
  class: extra,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button {...rest} type={type} class={extra ? `${LOOKS[variant]} ${extra}` : LOOKS[variant]}>
      {children}
    </button>
  );
}

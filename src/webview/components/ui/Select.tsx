type SelectProps = {
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  "aria-label"?: string;
  /** The Dialog passes `undefined` for a form whose fields have their own labels. */
  "aria-labelledby"?: string | undefined;
};

/** The outline is drawn outside the border, so its contrast is with what lies behind the field. */
const SELECT_CLASS = [
  "w-full cursor-pointer rounded border border-input-border bg-dropdown px-2 py-1 text-dropdown-fg",
  "focus:outline-1 focus:outline-offset-0 focus:outline-focus"
].join(" ");

/** The open list takes the same colours where the platform lets options be styled. */
const OPTION_CLASS = "bg-dropdown text-dropdown-fg";

/**
 * A native select, so the keyboard, type-ahead and scripts that set `.value` all work as usual. It
 * shows `value` after every render, or nothing when no option has it, and reports each `change`.
 */
export function Select({ options, value, onChange, ...naming }: SelectProps) {
  return (
    <select
      {...naming}
      class={SELECT_CLASS}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option, index) => (
        // By position: nothing stops two options from sharing a value.
        <option key={index} value={option.value} class={OPTION_CLASS}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

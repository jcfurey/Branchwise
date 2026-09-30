import type { ComponentChildren, SVGAttributes } from "preact";

/** What every icon takes: any attribute of an `<svg>`. The shapes are the icon's own. */
type IconProps = Omit<SVGAttributes<SVGSVGElement>, "children">;

/**
 * A decorative 16 × 16 drawing in the text colour, around the shapes it is given. Screen readers
 * and the Tab key pass it by. Every attribute the caller sets replaces the default of that name.
 */
export function Icon({ children, ...attributes }: IconProps & { children: ComponentChildren }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...attributes}
    >
      {children}
    </svg>
  );
}

/** How the line icons are drawn. Like the defaults of `Icon`, a caller may change any of it. */
const LINE = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5",
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
} as const;

// Filled glyphs. They take their colour from `fill`, which is the text colour unless a caller
// sets it, so a ref label can paint them in the editor's background on a coloured tile.

/** A "V" pointing down, centred so that it still sits in the middle when turned to point right. */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.2 5.4 3.3 4.3 8 9 12.7 4.3 13.8 5.4 8 11.2z" />
    </Icon>
  );
}

/** A ring that is nearly closed, with an arrowhead at its upper end: reload. */
export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.9 5.4A5.5 5.5 0 1 1 8.4 2.5V4A4 4 0 1 0 11.6 6.1z" />
      <path d="M7.4 0.3 11 3.25 7.4 6.2z" />
    </Icon>
  );
}

/** Three dots side by side: more actions. */
export function KebabIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </Icon>
  );
}

/** Two commits on a line, and a third that joins the line from the side along a curve. */
export function BranchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5" cy="3.5" r="2" />
      <circle cx="5" cy="12.5" r="2" />
      <circle cx="11" cy="4.5" r="2" />
      <path d="M4.25 3.5H5.75V12.5H4.25zM10.25 6H11.75C11.75 9.6 8.9 11 5 11V9.5C8.1 9.5 10.25 8.4 10.25 6z" />
    </Icon>
  );
}

/** A price tag that hangs from its upper left corner, where the hole for its string is. */
export function TagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        fill-rule="evenodd"
        d="M2.6 1.5H7.3L14.3 8.5Q15 9.2 14.3 9.9L9.9 14.3Q9.2 15 8.5 14.3L1.5 7.3V2.6Q1.5 1.5 2.6 1.5zM4.9 3.6A1.3 1.3 0 1 0 4.9 6.2 1.3 1.3 0 1 0 4.9 3.6z"
      />
    </Icon>
  );
}

// Line glyphs.

/** A wheel with eight teeth round a hole: settings. */
export function GearIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M6.57 3.31 6.85 1.5H9.15L9.43 3.31A4.9 4.9 0 0 1 10.3 3.67L11.79 2.59 13.41 4.21 12.33 5.7A4.9 4.9 0 0 1 12.69 6.57L14.5 6.85V9.15L12.69 9.43A4.9 4.9 0 0 1 12.33 10.3L13.41 11.79 11.79 13.41 10.3 12.33A4.9 4.9 0 0 1 9.43 12.69L9.15 14.5H6.85L6.57 12.69A4.9 4.9 0 0 1 5.7 12.33L4.21 13.41 2.59 11.79 3.67 10.3A4.9 4.9 0 0 1 3.31 9.43L1.5 9.15V6.85L3.31 6.57A4.9 4.9 0 0 1 3.67 5.7L2.59 4.21 4.21 2.59 5.7 3.67A4.9 4.9 0 0 1 6.57 3.31z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  );
}

/** Cross hairs round a small circle: show where the selected lane is. */
export function RevealIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.25V4.5M8 11.5V14.75M1.25 8H4.5M11.5 8H14.75" />
    </Icon>
  );
}

/** An open eye: shown. */
export function EyeIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M1.25 8Q8 0.5 14.75 8 8 15.5 1.25 8z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  );
}

/** The same eye with no pupil and a stroke through it: hidden. */
export function EyeClosedIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M1.25 8Q8 0.5 14.75 8 8 15.5 1.25 8z" />
      <path d="M2.5 13.5 13.5 2.5" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M8 3.5V12.5M3.5 8H12.5" />
    </Icon>
  );
}

/** A box under a lid that overhangs it, with a handle on its front: stashes. */
export function StashIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <rect x="1.5" y="2.5" width="13" height="3" rx="0.75" />
      <path d="M2.75 5.5V13.5H13.25V5.5M6.5 8.5H9.5" />
    </Icon>
  );
}

/** A cloud: remotes. */
export function RemoteIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M4.5 12.75H11.75A2.75 2.75 0 0 0 12.1 7.3 4.25 4.25 0 0 0 4 6.6 3.1 3.1 0 0 0 4.5 12.75z" />
    </Icon>
  );
}

/** A magnifying glass: search. */
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <circle cx="6.75" cy="6.75" r="4.5" />
      <path d="M10.1 10.1 14.5 14.5" />
    </Icon>
  );
}

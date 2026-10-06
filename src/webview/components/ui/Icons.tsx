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

/** A ring with a dot in its middle and a tick on each side: find where you are. */
export function LocateIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <circle cx="8" cy="8" r="4.5" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
    </Icon>
  );
}

/** A cloud with an arrow coming down out of it: fetch. */
export function FetchIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M4.75 11.25H4.4A3 3 0 0 1 4 5.3 4.25 4.25 0 0 1 12.1 6 2.65 2.65 0 0 1 11.6 11.25H11.25" />
      <path d="M8 7.5V14.25M5.75 12 8 14.25 10.25 12" />
    </Icon>
  );
}

/** Two arrows pointing at each other's tails: compare. */
export function CompareIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M2 5H13M10.5 2.5 13 5 10.5 7.5M14 11H3M5.5 8.5 3 11 5.5 13.5" />
    </Icon>
  );
}

/** A window with a panel down its left side: the branches pane. */
export function SidebarIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.25" />
      <path d="M6 2.5V13.5" />
    </Icon>
  );
}

/** Two boxes, one behind the other: several repositories. */
export function ReposIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <rect x="1.5" y="5" width="10" height="9" rx="1.25" />
      <path d="M4.5 2.5H13.25A1.25 1.25 0 0 1 14.5 3.75V11" />
    </Icon>
  );
}

/** A bound book: a repository. */
export function RepoIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M3 13V3.25A1.75 1.75 0 0 1 4.75 1.5H13V11.5H4.75A1.75 1.75 0 0 0 3 13.25 1.75 1.75 0 0 0 4.75 15H13" />
    </Icon>
  );
}

/** Two arrows running into each other at a bar: changes that collide, a conflict. */
export function ConflictIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M8 1.75V14.25M1.5 8H5.5M3.75 5.75 6 8 3.75 10.25M14.5 8H10.5M12.25 5.75 10 8 12.25 10.25" />
    </Icon>
  );
}

/** A drawing pin, point down: keep at the top. A caller fills it to show it is pinned. */
export function PinIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M5.5 1.75H10.5M6.5 1.75V6.25L4.25 9.25H11.75L9.5 6.25V1.75M8 9.25V14.5" />
    </Icon>
  );
}

/** A clock face: by time. */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8L10.5 9.5" />
    </Icon>
  );
}

/** A diagonal cross: close or dismiss. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M4 4 12 12M12 4 4 12" />
    </Icon>
  );
}

/** A ring round two upright bars: work stopped partway, waiting to be continued. */
export function PausedIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.25 5.5V10.5M9.75 5.5V10.5" />
    </Icon>
  );
}

/** A cloud with an arrow rising into it from below: not yet published. */
export function PublishIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <path d="M5.25 11.5H4.5A2.9 2.9 0 0 1 4.1 5.75 4.1 4.1 0 0 1 11.9 6.4 2.55 2.55 0 0 1 11.5 11.5H10.75" />
      <path d="M8 14.75V8.25M5.75 10.5 8 8.25 10.25 10.5" />
    </Icon>
  );
}

/** A commit on a line that breaks off above it: HEAD on a commit, not on a branch. */
export function DetachedIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <circle cx="8" cy="9.75" r="2.25" />
      <path d="M8 12V14.75M8 1.25V3.25M8 5.25V7.5" />
    </Icon>
  );
}

/** A key with a round bow and two teeth: a signed commit. */
export function KeyIcon(props: IconProps) {
  return (
    <Icon {...LINE} {...props}>
      <circle cx="4.75" cy="8" r="3" />
      <path d="M7.75 8H14.25M11.5 8V10.25M14.25 8V10.75" />
    </Icon>
  );
}

/** What a shield carries: the verdict on a signature. */
export type ShieldMark =
  | "check"
  | "cross"
  | "question"
  | "exclamation"
  | "clock"
  | "slash"
  | "none";

const SHIELD_MARKS: Record<Exclude<ShieldMark, "none">, string> = {
  check: "M5.5 8.1 7.25 9.85 10.5 6.6",
  cross: "M6.1 6.1 9.9 9.9M9.9 6.1 6.1 9.9",
  question: "M6.5 6.4A1.5 1.5 0 1 1 8.6 7.75C8.15 8 8 8.3 8 8.75M8 10.9V10.95",
  exclamation: "M8 5.5V8.5M8 10.9V10.95",
  clock: "M8 5.25V8L9.75 9.25",
  slash: "M5.25 10.75 10.75 5.25"
};

/**
 * A shield with a mark on it: a tick, a cross, a question or exclamation mark, a clock's hands or
 * a stroke. Without a mark its outline is broken, as for a commit that has no signature.
 */
export function ShieldIcon({ mark, ...props }: IconProps & { mark: ShieldMark }) {
  return (
    <Icon {...LINE} {...props}>
      <path
        d="M8 1.5 13.25 3.5V7.5C13.25 10.75 11.1 13.25 8 14.5 4.9 13.25 2.75 10.75 2.75 7.5V3.5z"
        stroke-dasharray={mark === "none" ? "2 1.75" : undefined}
      />
      {mark === "none" ? null : <path d={SHIELD_MARKS[mark]} />}
    </Icon>
  );
}

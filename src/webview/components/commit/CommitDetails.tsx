import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { GitCommitDetails } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { ContainingRefs } from "@/webview/components/commit/ContainingRefs";
import { FileTree } from "@/webview/components/commit/FileTree";
import { SignatureLine } from "@/webview/components/commit/SignatureBadge";
import { onCheckedOutLine, openEditMessage } from "@/webview/components/repository/EditCommit";
import { openSplitCommit } from "@/webview/components/repository/SplitCommit";
import { Icon } from "@/webview/components/ui/Icons";
import { Loading } from "@/webview/components/ui/Loading";
import { COMMIT_DETAILS_HEIGHT, ROW_HEIGHT, TABLE_HEADER_HEIGHT } from "@/webview/constants";
import { closeCommitDetails, openAllCommitChanges } from "@/webview/lib/actions";
import { copyToClipboard } from "@/webview/lib/actions/clipboard";
import { CommitMessage, repositoryTracker } from "@/webview/lib/commit-message";
import { repositoryState } from "@/webview/lib/repository-actions";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import { getFullDate } from "@/webview/utils/date";
import { buildFileTree } from "@/webview/utils/fileTree";

/** Thickness of the line that closes off the details at the bottom, in pixels. */
const BOTTOM_LINE = 2;

/** Room kept below the details when they are scrolled into view without centring, in pixels. */
const MARGIN_BELOW = 8;

/**
 * How much of the top of the window the sticky headings cover: the page header, whose height
 * `MainHeader` keeps on the root element, and the heading row of the table the details are in.
 */
function stickyHeadings(row: HTMLElement) {
  const page = parseFloat(document.documentElement.style.getPropertyValue("--main-header-height"));
  const heading = row.closest("table")?.tHead;
  const table = heading ? heading.getBoundingClientRect().height : TABLE_HEADER_HEIGHT;
  return (Number.isFinite(page) ? page : 0) + table;
}

/**
 * Scroll the window so the details just opened can be read. By default they are centred;
 * otherwise the window moves as little as it can so the commit row above them stays clear of
 * the sticky headings and the details end a little above the bottom edge.
 */
function bringIntoView(row: HTMLElement) {
  const box = row.getBoundingClientRect();
  const view = window.innerHeight;
  if (getWebviewConfig().autoCenterCommitDetailsView) {
    window.scrollBy({ top: box.top + box.height / 2 - view / 2 });
    return;
  }
  const above = stickyHeadings(row) + ROW_HEIGHT;
  if (box.top < above) {
    window.scrollBy({ top: box.top - above });
  } else if (box.bottom + MARGIN_BELOW > view) {
    window.scrollBy({ top: box.bottom + MARGIN_BELOW - view });
  }
}

/**
 * The frame that opens under a table row: a fixed-height cell with a close button. The graph is
 * stretched by exactly its height, so the height never follows the content.
 */
export function DetailsRow({ children }: { children: ComponentChildren }) {
  const row = useRef<HTMLTableRowElement>(null);

  // Once per opening. Content arriving later, such as loaded details, does not scroll again.
  useEffect(() => {
    if (row.current !== null) {
      bringIntoView(row.current);
    }
  }, []);

  /** Close, and hand focus back to the row the details belong to without scrolling to it. */
  function close() {
    const owner = row.current?.previousElementSibling;
    closeCommitDetails();
    if (owner instanceof HTMLElement) {
      owner.focus({ preventScroll: true });
    }
  }

  const label = window.l10n.close;
  return (
    <tr
      ref={row}
      data-details-row
      style={{ height: `${COMMIT_DETAILS_HEIGHT}px` }}
      onKeyDown={(event) => {
        // Escape belongs to the details, not to whatever listens further up, such as a dialog.
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      {/* Under the graph column, left empty so the lanes show through. */}
      <td />
      <td
        colSpan={4}
        class="relative bg-btn p-0 align-top text-ui leading-4.5 whitespace-normal after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-line"
      >
        <div class="overflow-hidden" style={{ height: `${COMMIT_DETAILS_HEIGHT - BOTTOM_LINE}px` }}>
          {children}
        </div>
        <button
          type="button"
          class="absolute top-1 right-1 cursor-pointer opacity-60 hover:opacity-100"
          title={label}
          aria-label={label}
          onClick={close}
        >
          <Icon width="24" height="24">
            <path d="M4.2 3.5 8 7.3l3.8-3.8.7.7L8.7 8l3.8 3.8-.7.7L8 8.7l-3.8 3.8-.7-.7L7.3 8 3.5 4.2z" />
          </Icon>
        </button>
      </td>
    </tr>
  );
}

/**
 * The address for a `mailto:` link. The parts either side of the last `@` are encoded on their
 * own, so the `@` itself stays readable to mail clients.
 */
function mailto(email: string) {
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return `mailto:${encodeURIComponent(email)}`;
  }
  const local = encodeURIComponent(email.slice(0, at));
  return `mailto:${local}@${encodeURIComponent(email.slice(at + 1))}`;
}

/**
 * One line of commit facts. The template's text up to its first `{0}` is the bold label, the
 * value takes the placeholder's place, and the text up to the next `{0}` follows it. Each piece
 * is a separate node, so nothing in the template or the value is interpreted.
 */
function Fact({ template, children }: { template: string; children: ComponentChildren }) {
  const [label, after = ""] = template.split("{0}");
  return (
    <div class="truncate">
      <b>{label}</b>
      {children}
      {after}
    </div>
  );
}

function Author({ name, email }: { name: string; email: string }) {
  if (email === "") {
    return <>{name}</>;
  }
  return (
    <>
      {`${name} <`}
      <a class="text-inherit underline" href={mailto(email)}>
        {email}
      </a>
      {">"}
    </>
  );
}

/** How long a copy button says it copied, in milliseconds. */
const COPIED_FOR = 1500;

/** A small button that copies `text`, then says so for a moment. */
function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_FOR);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      class="ml-1.5 shrink-0 cursor-pointer rounded-sm px-1 text-xs text-muted hover:bg-btn-hover hover:text-fg focus:outline-1 focus:outline-focus"
      title={text}
      onClick={() => {
        void copyToClipboard(window.l10n.typeCommitHash, text).then(setCopied);
      }}
    >
      {/* The label keeps its width while it reads "Copied". */}
      <span class="grid">
        <span class={`col-start-1 row-start-1 ${copied ? "invisible" : ""}`}>{label}</span>
        <span class={`col-start-1 row-start-1 ${copied ? "" : "invisible"}`} aria-live="polite">
          {copied ? window.l10n.copiedToClipboard : ""}
        </span>
      </span>
    </button>
  );
}

/** A commit's facts and message beside the tree of the files it changed. */
export function CommitDetails({ details }: { details: GitCommitDetails | null }) {
  // A new reply for the same commit builds the tree again; the tree keeps its folders by hash.
  const nodes = useMemo(
    () => (details === null ? null : buildFileTree(details.fileChanges)),
    [details]
  );

  if (details === null || nodes === null) {
    return (
      <DetailsRow>
        <Loading class="h-full" />
      </DetailsRow>
    );
  }

  const l10n = window.l10n;
  return (
    <DetailsRow>
      <div class="flex h-full">
        <div class="w-9/20 shrink-0 overflow-auto border-x border-line p-2.5 select-text">
          {/* The buttons stay in view when a narrow panel cuts the ID short. */}
          <div class="flex items-center">
            <div class="min-w-0">
              <Fact template={l10n.detailCommit}>{details.hash}</Fact>
            </div>
            <CopyButton label={l10n.copyCommitHashShort} text={abbrevCommit(details.hash)} />
            <CopyButton label={l10n.copyCommitHashFull} text={details.hash} />
            {onCheckedOutLine(details.hash) && (
              <button
                type="button"
                class="ml-1.5 shrink-0 cursor-pointer rounded-sm px-1 text-xs text-muted hover:bg-btn-hover hover:text-fg focus:outline-1 focus:outline-focus"
                onClick={() => openEditMessage(details.hash)}
              >
                {l10n.editMessage + "…"}
              </button>
            )}
            {onCheckedOutLine(details.hash) && details.parents.length < 2 && (
              <button
                type="button"
                class="ml-1.5 shrink-0 cursor-pointer rounded-sm px-1 text-xs text-muted hover:bg-btn-hover hover:text-fg focus:outline-1 focus:outline-focus"
                onClick={() => openSplitCommit(details.hash)}
              >
                {l10n.splitCommit + "…"}
              </button>
            )}
          </div>
          <Fact template={l10n.detailParents}>{details.parents.join(", ")}</Fact>
          <Fact template={l10n.detailAuthor}>
            <Author name={details.author} email={details.email} />
          </Fact>
          <Fact template={l10n.detailDate}>{getFullDate(details.date)}</Fact>
          <Fact template={l10n.detailCommitter}>{details.committer}</Fact>
          <ContainingRefs hash={details.hash} />
          <SignatureLine hash={details.hash} />
          <CommitMessage body={details.body} tracker={repositoryTracker(repositoryState.value)} />
        </div>
        <div class="mr-8 flex min-w-0 flex-1 flex-col border-r border-line">
          {details.fileChanges.length > 0 && (
            <div
              class="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-2 py-0.5 text-xs"
              data-file-list-header
            >
              <span class="truncate text-muted">
                {l10n.comparedFiles} ({details.fileChanges.length})
              </span>
              <button
                type="button"
                class="shrink-0 cursor-pointer rounded-sm px-1 hover:bg-btn-hover focus:outline-1 focus:outline-focus"
                onClick={() => openAllCommitChanges(details.hash)}
              >
                {l10n.openAllChanges}
              </button>
            </div>
          )}
          <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-scroll py-1">
            <FileTree nodes={nodes} commitHash={details.hash} />
          </div>
        </div>
      </div>
    </DetailsRow>
  );
}

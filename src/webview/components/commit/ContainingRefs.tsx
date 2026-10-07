import type { ComponentChildren } from "preact";

import type { RefDetails } from "@/backend/types";
import { BranchIcon, RemoteIcon, TagIcon } from "@/webview/components/ui/Icons";
import { focusBranchInGraph } from "@/webview/lib/actions";
import { useContainingRefs } from "@/webview/lib/containing-refs";
import { revealCommit } from "@/webview/lib/jump-to-head";

/** Branches shown as chips at most; the rest are counted, and named in the count's tooltip. */
export const BRANCHES_SHOWN = 10;

/** `{0}` of a template replaced as written, even when the value holds `$`. */
const fill = (template: string, value: string | number) =>
  template.replace("{0}", () => String(value));

/**
 * The template's text either side of `{0}`, with `value` between. Each piece is a node of its
 * own, so nothing in the template or the value is read as markup.
 */
function Filled({ template, children }: { template: string; children: ComponentChildren }) {
  const [before, after = ""] = template.split("{0}");
  return (
    <>
      {before}
      {children}
      {after}
    </>
  );
}

function Chip({
  title,
  icon,
  onClick,
  children
}: {
  title: string;
  icon: ComponentChildren;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class="inline-flex max-w-48 cursor-pointer items-center gap-0.5 rounded-sm bg-btn px-1 align-middle text-xs hover:bg-btn-hover focus:outline-1 focus:outline-focus"
      title={title}
      onClick={onClick}
    >
      {icon}
      <span class="truncate">{children}</span>
    </button>
  );
}

function BranchChip({ branch }: { branch: string }) {
  const remote = branch.startsWith("remotes/");
  const name = remote ? branch.slice("remotes/".length) : branch;
  const Glyph = remote ? RemoteIcon : BranchIcon;
  return (
    <Chip
      title={fill(window.l10n.focusBranchChip, name)}
      icon={<Glyph class="size-3 shrink-0" />}
      onClick={() => focusBranchInGraph(branch)}
    >
      {name}
    </Chip>
  );
}

function TagChip({ tag }: { tag: RefDetails }) {
  return (
    <Chip
      title={fill(window.l10n.selectTaggedCommit, tag.name)}
      icon={<TagIcon class="size-3 shrink-0" />}
      onClick={() => revealCommit(tag.hash)}
    >
      {tag.name}
    </Chip>
  );
}

/** A muted count of names left out, which lists them all in its tooltip. */
function More({ label, names }: { label: string; names: string[] }) {
  return (
    <span class="text-xs text-muted" title={names.join("\n")}>
      {label}
    </span>
  );
}

/**
 * Where the commit has gone since: the branches that contain it, the first tag released with
 * it, and the tag before it. Loaded on its own after the details show; while that runs it reads
 * "Checking…", and a commit on no branch and in no tag shows nothing at all.
 */
export function ContainingRefs({ hash }: { hash: string }) {
  const { refs, loading } = useContainingRefs(hash);
  const l10n = window.l10n;
  if (refs === null) {
    return loading ? (
      <div class="mt-1 text-xs text-muted" data-containing-refs="loading">
        {l10n.checkingRefs}
      </div>
    ) : null;
  }
  const { branches, tags, follows } = refs;
  if (branches.length === 0 && tags.length === 0) {
    return null;
  }
  const hidden = branches.slice(BRANCHES_SHOWN);
  const [first, ...later] = tags;
  return (
    <div class="mt-1 space-y-1" data-containing-refs="loaded">
      {branches.length > 0 && (
        <div class="flex flex-wrap items-center gap-1" data-contained-in>
          <b>{l10n.detailContainedIn}</b>
          {branches.slice(0, BRANCHES_SHOWN).map((branch) => (
            <BranchChip key={branch} branch={branch} />
          ))}
          {hidden.length > 0 && (
            <More
              label={fill(l10n.moreBranches, hidden.length)}
              names={hidden.map((branch) => branch.replace(/^remotes\//, ""))}
            />
          )}
        </div>
      )}
      {(first !== undefined || follows !== null) && (
        <div class="flex flex-wrap items-center gap-1" data-released-in>
          {first !== undefined && (
            <span>
              <Filled template={l10n.firstReleasedIn}>
                <TagChip tag={first} />
              </Filled>
            </span>
          )}
          {later.length > 0 && (
            <More
              label={fill(later.length === 1 ? l10n.laterTag : l10n.laterTags, later.length)}
              names={later.map((tag) => tag.name)}
            />
          )}
          {follows !== null && (
            <span data-follows>
              <Filled template={l10n.followsTag}>
                <TagChip tag={follows} />
              </Filled>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

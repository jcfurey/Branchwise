import type { ComponentChildren } from "preact";

import type { RemoteDetails, RepositoryState } from "@/backend/types";
import { type CustomLink, useCustomLinks } from "@/webview/lib/custom-links";

/** Where a remote's issues and merge requests live, for the hosts whose links are known. */
export type IssueTracker = { kind: "github" | "gitlab"; host: string; base: string };

/**
 * The tracker of the remote at `url`, which may be written as `https://host/owner/repo.git`,
 * `ssh://git@host:22/owner/repo` or `git@host:owner/repo.git`. Only github.com and hosts with
 * `gitlab` in their name are known; anything else, or a local path, has none.
 */
export function issueTracker(url: string): IssueTracker | null {
  let host: string;
  let path: string;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!["https:", "http:", "ssh:", "git:", "git+ssh:", "ssh+git:"].includes(parsed.protocol)) {
      return null;
    }
    host = parsed.hostname;
    path = decodeURIComponent(parsed.pathname);
  } else if (scp !== null) {
    host = scp[1]!;
    path = scp[2]!;
  } else {
    return null;
  }
  host = host.toLowerCase().replace(/^www\./, "");
  path = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  // An owner and a repository at least; GitLab nests groups deeper.
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(path)) {
    return null;
  }
  const kind = host === "github.com" ? "github" : host.includes("gitlab") ? "gitlab" : null;
  return kind === null ? null : { kind, host, base: `https://${host}/${path}` };
}

/**
 * The remote an upstream such as `origin/main` belongs to. Remote names may hold slashes, so the
 * longest name that fits wins.
 */
export function upstreamRemote(state: RepositoryState, upstream: string): RemoteDetails | null {
  let found: RemoteDetails | null = null;
  for (const remote of state.remotes) {
    if (upstream.startsWith(remote.name + "/") && remote.name.length > (found?.name.length ?? 0)) {
      found = remote;
    }
  }
  return found;
}

/** The tracker of `remote`'s first fetch address, or `null` when its host is not known. */
export function remoteTracker(remote: RemoteDetails): IssueTracker | null {
  const url = remote.fetchUrls[0];
  return url === undefined ? null : issueTracker(url);
}

/**
 * The tracker of the remote the checked-out branch tracks, else of `origin`, else of the first
 * remote, or `null` when that remote's host is not known.
 */
export function repositoryTracker(state: RepositoryState | null): IssueTracker | null {
  if (state === null || state.remotes.length === 0) {
    return null;
  }
  const upstream = state.branches.find((branch) => branch.name === state.head)?.upstream ?? "";
  const remote =
    upstreamRemote(state, upstream) ??
    state.remotes.find((item) => item.name === "origin") ??
    state.remotes[0]!;
  return remoteTracker(remote);
}

type Rule = {
  pattern: RegExp;
  render: (match: RegExpExecArray, tracker: IssueTracker | null) => ComponentChildren | null;
};

function Link({ href, children }: { href: string; children: ComponentChildren }) {
  return (
    <a class="text-link underline" href={href} title={href} rel="noreferrer">
      {children}
    </a>
  );
}

function issueUrl(tracker: IssueTracker, number: string, base = tracker.base) {
  return tracker.kind === "github" ? `${base}/issues/${number}` : `${base}/-/issues/${number}`;
}

/** Inline forms, tried in this order where several start at the same place. */
const RULES: Rule[] = [
  {
    pattern: /`([^`\n]+)`/g,
    render: (match) => <code class="rounded-sm bg-code px-1 font-mono">{match[1]}</code>
  },
  {
    // A link ends before trailing punctuation, which usually belongs to the sentence.
    pattern: /\bhttps?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]]/g,
    render: (match) => <Link href={match[0]}>{match[0]}</Link>
  },
  {
    pattern: /\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g,
    render: (match) => <b>{match[1]}</b>
  },
  {
    pattern: /(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g,
    render: (match) => <i>{match[1]}</i>
  },
  {
    // owner/repo#12, or group/subgroup/project#12 on GitLab.
    pattern: /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]+)#(\d+)\b/g,
    render: (match, tracker) =>
      tracker === null ? null : (
        <Link href={issueUrl(tracker, match[2]!, `https://${tracker.host}/${match[1]}`)}>
          {match[0]}
        </Link>
      )
  },
  {
    pattern: /(?<![\w&#/])(?:#|GH-)(\d+)\b/g,
    render: (match, tracker) =>
      tracker === null || (match[0].startsWith("GH-") && tracker.kind !== "github") ? null : (
        <Link href={issueUrl(tracker, match[1]!)}>{match[0]}</Link>
      )
  },
  {
    pattern: /(?<![\w!])!(\d+)\b/g,
    render: (match, tracker) =>
      tracker?.kind !== "gitlab" ? null : (
        <Link href={`${tracker.base}/-/merge_requests/${match[1]}`}>{match[0]}</Link>
      )
  }
];

/**
 * `text` with its inline code, links, emphasis and issue references made into elements, and
 * `custom` links, given by their place in `text` and earliest first, made into links. Whatever
 * starts first wins, a built-in form on a tie, and anything it covers stays inside it as text,
 * so links never nest.
 */
function inline(
  text: string,
  tracker: IssueTracker | null,
  custom: readonly CustomLink[] = []
): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let at = 0;
  let next = 0;
  while (at < text.length) {
    let best: { index: number; length: number; node: ComponentChildren } | null = null;
    for (const rule of RULES) {
      rule.pattern.lastIndex = at;
      // Later matches of a rule whose earliest one renders nothing are still worth trying.
      for (let match = rule.pattern.exec(text); match !== null; match = rule.pattern.exec(text)) {
        if (best !== null && match.index >= best.index) {
          break;
        }
        const node = rule.render(match, tracker);
        if (node !== null) {
          best = { index: match.index, length: match[0].length, node };
          break;
        }
      }
    }
    // Custom links that start inside what came before are covered by it.
    while (next < custom.length && custom[next]!.start < at) {
      next++;
    }
    const link = custom[next];
    if (link !== undefined && (best === null || link.start < best.index)) {
      const label = text.slice(link.start, link.end);
      best = {
        index: link.start,
        length: label.length,
        node: <Link href={link.url}>{label}</Link>
      };
    }
    if (best === null) {
      out.push(text.slice(at));
      break;
    }
    if (best.index > at) {
      out.push(text.slice(at, best.index));
    }
    out.push(best.node);
    at = best.index + best.length;
  }
  return out;
}

/** The custom links that lie wholly inside `text`, which starts at `offset` of the message. */
function linksWithin(custom: readonly CustomLink[], offset: number, text: string) {
  const end = offset + text.length;
  return custom
    .filter((link) => link.start >= offset && link.end <= end)
    .map((link) => ({ start: link.start - offset, end: link.end - offset, url: link.url }));
}

/**
 * A commit message as the details show it: line breaks kept, fenced code blocks set apart,
 * inline code, `**bold**` and `*italic*` styled, and web addresses and issue or merge request
 * references, such as `#12`, `GH-12`, `!12` or `owner/repo#12`, linked to `tracker`. References
 * that the `branchwise.issueLinks` patterns match are linked too, once they have been found, but
 * never inside code. Nothing in the message is read as markup.
 */
export function CommitMessage({ body, tracker }: { body: string; tracker: IssueTracker | null }) {
  const custom = useCustomLinks(body);
  const blocks: ComponentChildren[] = [];
  const lines = body.split("\n");
  // Where each line starts in `body`, so custom links can be placed in the paragraph holding them.
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  let text: string[] = [];
  let first = 0;
  const flush = () => {
    if (text.length > 0) {
      const paragraph = text.join("\n");
      blocks.push(
        <p class="break-words whitespace-pre-wrap">
          {inline(paragraph, tracker, linksWithin(custom, starts[first]!, paragraph))}
        </p>
      );
      text = [];
    }
  };
  for (let index = 0; index < lines.length; index++) {
    const fence = /^\s*(```|~~~)/.exec(lines[index]!);
    const end = fence
      ? lines.findIndex((line, at) => at > index && line.trimStart().startsWith(fence[1]!))
      : -1;
    if (fence === null || end < 0) {
      if (text.length === 0) {
        first = index;
      }
      text.push(lines[index]!);
      continue;
    }
    flush();
    blocks.push(
      <pre class="overflow-x-auto rounded-sm bg-code p-1.5 font-mono whitespace-pre">
        {lines.slice(index + 1, end).join("\n")}
      </pre>
    );
    index = end;
  }
  flush();
  return <div class="mt-4 space-y-2">{blocks}</div>;
}

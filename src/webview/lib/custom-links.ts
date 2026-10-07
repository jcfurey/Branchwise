import { useEffect, useState } from "preact/hooks";

import type { IssueLink } from "@/types";
import { getWebviewConfig } from "@/webview/lib/webview-config";

// Custom issue links come from patterns the user wrote, and a JavaScript regular expression
// cannot be stopped once it runs: one that backtracks badly could freeze the page. So they never
// run on the page itself. A worker matches them, each message at most once, and is terminated
// when it takes longer than `TIME_LIMIT`; that message then shows its built-in links only.

/** A custom link in a message: the text from `start` up to `end` opens `url`. */
export type CustomLink = { start: number; end: number; url: string };

/** Characters of a message scanned for custom links. Text beyond them shows none. */
export const SCAN_LIMIT = 10_000;

/** Custom links found in one message at most, across all patterns. */
export const MATCH_LIMIT = 100;

/** How long a message's custom links may take, in milliseconds, before the worker is stopped. */
export const TIME_LIMIT = 250;

/** Answers remembered at most; the oldest goes first. */
const CACHE_SIZE = 500;

/**
 * The custom links of `text`, earliest first. Only the first `scanLimit` characters are searched,
 * and the search stops after `matchLimit` links. A match of empty text links nothing, and an
 * address that does not start with `http://` or `https://` once filled in is dropped. Each `$0`
 * in a template becomes the whole match and `$1` to `$9` its groups, escaped as URL components.
 *
 * The worker runs this function from its source text, so it must use nothing from outside it.
 */
export function findCustomLinks(
  links: ReadonlyArray<{ pattern: string; url: string }>,
  text: string,
  scanLimit: number,
  matchLimit: number
): CustomLink[] {
  const scanned = text.slice(0, scanLimit);
  const found: CustomLink[] = [];
  for (const link of links) {
    let expression: RegExp;
    try {
      expression = new RegExp(link.pattern, "g");
    } catch {
      continue;
    }
    for (
      let match = expression.exec(scanned);
      match !== null && found.length < matchLimit;
      match = expression.exec(scanned)
    ) {
      if (match[0] === "") {
        // Move on, or the same empty match would come back for ever.
        expression.lastIndex += 1;
        continue;
      }
      const groups = match;
      const url = link.url.replaceAll(/\$(\d)/g, (_placeholder, index: string) =>
        encodeURIComponent(groups[Number(index)] ?? "")
      );
      if (/^https?:\/\//i.test(url)) {
        found.push({ start: match.index, end: match.index + match[0].length, url });
      }
    }
  }
  return found.toSorted((a, b) => a.start - b.start || b.end - a.end);
}

type Job = {
  key: string;
  links: readonly IssueLink[];
  text: string;
  done: (found: CustomLink[]) => void;
};

/** Answers by patterns and message, so that a message shown again is not matched again. */
const answers = new Map<string, CustomLink[]>();
/** Jobs waiting for the worker, which takes one at a time so each has the whole time limit. */
const queue: Job[] = [];
let worker: Worker | null = null;
let running: { job: Job; timer: ReturnType<typeof setTimeout> } | null = null;
/** Set once a worker could not be started, so that later messages do not try again. */
let unavailable = false;

function remember(key: string, found: CustomLink[]) {
  if (answers.size >= CACHE_SIZE) {
    answers.delete(answers.keys().next().value!);
  }
  answers.set(key, found);
}

/** A worker that answers `{ links, text }` with the custom links found, or `null`. */
function startWorker(): Worker | null {
  if (unavailable) {
    return null;
  }
  try {
    const source = [
      `const find = ${findCustomLinks.toString()};`,
      `onmessage = (event) => postMessage(find(event.data.links, event.data.text, ${SCAN_LIMIT}, ${MATCH_LIMIT}));`
    ].join("\n");
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const started = new Worker(url);
    URL.revokeObjectURL(url);
    // A worker that was stopped for taking too long may still have answered; that is ignored.
    started.addEventListener("message", (event: MessageEvent<CustomLink[]>) => {
      if (worker === started) {
        finish(event.data);
      }
    });
    started.addEventListener("error", () => {
      if (worker === started) {
        finish([]);
      }
    });
    return started;
  } catch {
    unavailable = true;
    return null;
  }
}

function finish(found: CustomLink[]) {
  const current = running;
  if (current === null) {
    return;
  }
  clearTimeout(current.timer);
  running = null;
  remember(current.job.key, found);
  current.job.done(found);
  next();
}

function next() {
  if (running !== null) {
    return;
  }
  const job = queue.shift();
  if (job === undefined) {
    return;
  }
  worker ??= startWorker();
  if (worker === null) {
    // No custom links rather than running the patterns on the page.
    remember(job.key, []);
    job.done([]);
    next();
    return;
  }
  const active = worker;
  running = {
    job,
    timer: setTimeout(() => {
      // The worker may never finish: stop it, and start another for the next message.
      active.terminate();
      worker = null;
      finish([]);
    }, TIME_LIMIT)
  };
  active.postMessage({ links: job.links, text: job.text });
}

/** Find the custom links of `text` in the worker, or take them from earlier. */
function requestCustomLinks(
  links: readonly IssueLink[],
  text: string,
  done: (found: CustomLink[]) => void
) {
  const key = JSON.stringify([links, text]);
  const known = answers.get(key);
  if (known !== undefined) {
    done(known);
    return () => {};
  }
  const job: Job = { key, links, text, done };
  queue.push(job);
  next();
  return () => {
    const at = queue.indexOf(job);
    if (at >= 0) {
      queue.splice(at, 1);
    } else if (running?.job === job) {
      // Still matched to the end, so the answer is there next time; only nobody hears it now.
      job.done = () => {};
    }
  };
}

/**
 * The custom links of `text` under the `branchwise.issueLinks` setting: `[]` while there are
 * none, and while they are being found the first time.
 */
export function useCustomLinks(text: string): CustomLink[] {
  const links = getWebviewConfig().issueLinks;
  const key = JSON.stringify([links, text]);
  const [found, setFound] = useState<{ key: string; links: CustomLink[] } | null>(null);
  useEffect(() => {
    if (links.length === 0) {
      return;
    }
    return requestCustomLinks(links, text, (result) => setFound({ key, links: result }));
  }, [key]);
  if (links.length === 0) {
    return [];
  }
  return answers.get(key) ?? (found?.key === key ? found.links : []);
}

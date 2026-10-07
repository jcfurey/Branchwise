// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueLink, WebviewConfig } from "@/types";

/** A fresh copy of the modules involved, so each test starts without a worker or answers. */
type Modules = {
  links: typeof import("@/webview/lib/custom-links");
  message: typeof import("@/webview/lib/commit-message");
  config: typeof import("@/webview/lib/webview-config");
};

const JIRA: IssueLink = {
  pattern: "\\b[A-Z][A-Z0-9]+-\\d+\\b",
  url: "https://jira.example.com/browse/$0"
};
const LINEAR: IssueLink = {
  pattern: "\\bENG-(\\d+)\\b",
  url: "https://linear.app/acme/issue/ENG-$1"
};

const settings = (issueLinks: readonly IssueLink[]): WebviewConfig => ({
  autoCenterCommitDetailsView: true,
  commitHoverCards: true,
  conflictForecast: "localAndRemote",
  dateFormat: "Date & Time",
  dragAndDrop: true,
  graphColours: [],
  graphStyle: "rounded",
  initialLoadCommits: 300,
  issueLinks,
  loadMoreCommits: 100,
  locale: "en",
  showChangesColumn: false,
  showCurrentBranchByDefault: false,
  singleKeyShortcuts: true
});

/**
 * Stands in for the page's worker. It runs the real matcher, rebuilt from the source text the
 * page would load, and answers on a later task, unless it is told to hang.
 */
class FakeWorker {
  static created: FakeWorker[] = [];
  static hang = false;
  static source = "";
  listeners = new Map<string, (event: { data: unknown }) => void>();
  terminated = false;
  received: unknown[] = [];
  constructor() {
    FakeWorker.created.push(this);
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(type, listener);
  }
  postMessage(data: { links: IssueLink[]; text: string }) {
    this.received.push(data);
    if (FakeWorker.hang) {
      return;
    }
    // The worker's own script, run with this object standing in for its global scope.
    // `onmessage` is there from the start, so the script's assignment lands on this object.
    const scope: {
      postMessage: (value: unknown) => void;
      onmessage: ((event: unknown) => void) | undefined;
    } = {
      postMessage: (value) => {
        if (!this.terminated) {
          this.listeners.get("message")?.({ data: value });
        }
      },
      onmessage: undefined
    };
    new Function("scope", `with (scope) { ${FakeWorker.source} }`)(scope);
    setTimeout(() => scope.onmessage!({ data }));
  }
  terminate() {
    this.terminated = true;
  }
}

let modules: Modules;
let container: HTMLDivElement;

async function load(issueLinks: readonly IssueLink[]) {
  vi.resetModules();
  const [links, message, config] = await Promise.all([
    import("@/webview/lib/custom-links"),
    import("@/webview/lib/commit-message"),
    import("@/webview/lib/webview-config")
  ]);
  config.initializeWebviewConfig(settings(issueLinks));
  modules = { links, message, config };
}

const github = { kind: "github" as const, host: "github.com", base: "https://github.com/o/r" };

function show(body: string, tracker: typeof github | null = github) {
  act(() => render(h(modules.message.CommitMessage, { body, tracker }), container));
}

/** Each link: its text and where it goes. */
const anchors = () =>
  [...container.querySelectorAll("a")].map((anchor) => [anchor.textContent, anchor.href]);

/** Let the fake worker answer, and the page draw the answer. */
async function answered() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.created = [];
  FakeWorker.hang = false;
  vi.stubGlobal("Worker", FakeWorker);
  // jsdom has no object URLs; the fake worker reads the script from the blob instead.
  Object.assign(URL, {
    createObjectURL: (blob: unknown) => {
      FakeWorker.source = (blob as { source: string }).source;
      return "blob:worker";
    },
    revokeObjectURL: () => {}
  });
  vi.stubGlobal(
    "Blob",
    class {
      source: string;
      constructor(parts: string[]) {
        this.source = parts.join("");
      }
    }
  );
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("finding custom links", () => {
  beforeEach(() => load([]));

  it("fills $0 with the match and $1 to $9 with its groups, escaped, earliest first", () => {
    const { findCustomLinks } = modules.links;
    expect(findCustomLinks([LINEAR, JIRA], "Fix ENG-42 and ABC-7", 1000, 10)).toEqual([
      { start: 4, end: 10, url: "https://linear.app/acme/issue/ENG-42" },
      { start: 4, end: 10, url: "https://jira.example.com/browse/ENG-42" },
      { start: 15, end: 20, url: "https://jira.example.com/browse/ABC-7" }
    ]);
    expect(
      findCustomLinks(
        [{ pattern: "see (\\S+)", url: "https://x.example/?q=$1&n=$9" }],
        "see a/b&c",
        99,
        9
      )
    ).toEqual([{ start: 0, end: 9, url: "https://x.example/?q=a%2Fb%26c&n=" }]);
  });

  it("scans only the first characters, and stops after the most links", () => {
    const { findCustomLinks } = modules.links;
    const text = "ABC-1 ".repeat(300);
    expect(findCustomLinks([JIRA], text, 30, 1000)).toHaveLength(5);
    expect(findCustomLinks([JIRA], text, 100_000, 100)).toHaveLength(100);
    // Across patterns too.
    expect(findCustomLinks([JIRA, JIRA], text, 100_000, 100)).toHaveLength(100);
  });

  it("links nothing for empty matches, and gets past them", () => {
    const { findCustomLinks } = modules.links;
    const lookahead = { pattern: "(?=ABC)|ABC-\\d", url: "https://x.example/$0" };
    expect(findCustomLinks([lookahead], "x ABC-1 ABC-2", 99, 9)).toEqual([]);
    expect(findCustomLinks([{ pattern: "\\d*", url: "https://x/$0" }], "a 12", 99, 9)).toEqual([
      { start: 2, end: 4, url: "https://x/12" }
    ]);
  });

  it("drops a link that would not be a web address", () => {
    const { findCustomLinks } = modules.links;
    const filled = { pattern: "\\S+", url: "$0" };
    expect(findCustomLinks([filled], "https://evil.example javascript:alert(1)", 99, 9)).toEqual(
      []
    );
    const scheme = { pattern: "x", url: "javascript:alert('$0')" };
    expect(findCustomLinks([scheme], "x", 99, 9)).toEqual([]);
    const broken = { pattern: "(", url: "https://x.example" };
    expect(findCustomLinks([broken, JIRA], "ABC-1", 99, 9)).toHaveLength(1);
  });

  it("works from its own source text, as the worker runs it", () => {
    const { findCustomLinks } = modules.links;
    const rebuilt = new Function(
      `return ${findCustomLinks.toString()}`
    )() as typeof findCustomLinks;
    const text = "ENG-9 fixes ABC-12, see https://x";
    expect(rebuilt([JIRA, LINEAR], text, 1000, 10)).toEqual(
      findCustomLinks([JIRA, LINEAR], text, 1000, 10)
    );
  });
});

describe("custom links in a commit message", () => {
  it("adds them once the worker has found them, the first entry winning a tie", async () => {
    await load([LINEAR, JIRA]);
    show("Fix ABC-12 and ENG-7");
    expect(anchors()).toEqual([]);
    await answered();
    expect(anchors()).toEqual([
      ["ABC-12", "https://jira.example.com/browse/ABC-12"],
      ["ENG-7", "https://linear.app/acme/issue/ENG-7"]
    ]);
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("lets the earliest form win, a built-in one on a tie, and never nests links", async () => {
    const hashes = { pattern: "#\\d+", url: "https://tracker.example/$0" };
    const see = { pattern: "see #\\d+", url: "https://tracker.example/see" };
    await load([JIRA, hashes, see]);
    show("Fixes #12, see #13. https://jira.example.com/browse/ABC-1 is ABC-2 and `ABC-3` *ABC-4*");
    await answered();
    expect(anchors()).toEqual([
      // A tie at the same place: the built-in GitHub link.
      ["#12", "https://github.com/o/r/issues/12"],
      // The custom match starts first, so the reference inside it stays text.
      ["see #13", "https://tracker.example/see"],
      // The address starts first, so the key inside it is not linked again.
      ["https://jira.example.com/browse/ABC-1", "https://jira.example.com/browse/ABC-1"],
      ["ABC-2", "https://jira.example.com/browse/ABC-2"]
    ]);
    // Inside code or emphasis, which start first, nothing is linked.
    expect(container.querySelector("code")?.textContent).toBe("ABC-3");
    expect(container.querySelector("i")?.textContent).toBe("ABC-4");
    expect(container.querySelector("a a")).toBeNull();
  });

  it("places links in the right paragraph around fenced code, and none inside it", async () => {
    await load([JIRA]);
    show("Subject ABC-1\n\n```\nABC-2\n```\nAfter ABC-3\nand ABC-4");
    await answered();
    expect(anchors().map(([label]) => label)).toEqual(["ABC-1", "ABC-3", "ABC-4"]);
    expect(container.querySelector("pre")?.textContent).toBe("ABC-2");
  });

  it("keeps working without a tracker, and leaves the built-in links alone without patterns", async () => {
    await load([JIRA]);
    show("ABC-1 #2", null);
    await answered();
    expect(anchors()).toEqual([["ABC-1", "https://jira.example.com/browse/ABC-1"]]);

    FakeWorker.created = [];
    await load([]);
    show("ABC-1 #2");
    await answered();
    expect(anchors()).toEqual([["#2", "https://github.com/o/r/issues/2"]]);
    expect(FakeWorker.created).toHaveLength(0);
  });

  it("matches a message once, and again when the patterns change", async () => {
    await load([JIRA]);
    show("ABC-1");
    await answered();
    show("ABC-1 again");
    await answered();
    show("ABC-1");
    await answered();
    expect(FakeWorker.created[0]!.received).toHaveLength(2);
    act(() => {
      modules.config.updateWebviewConfig(settings([LINEAR, JIRA]));
    });
    await answered();
    expect(FakeWorker.created[0]!.received).toHaveLength(3);
  });

  it("stops a worker that takes too long, shows the built-in links, and starts another", async () => {
    await load([{ pattern: "(a+)+$", url: "https://x.example/$0" }]);
    FakeWorker.hang = true;
    show("#5 " + "a".repeat(40) + "!");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(modules.links.TIME_LIMIT);
    });
    const [stuck] = FakeWorker.created;
    expect(stuck!.terminated).toBe(true);
    expect(anchors()).toEqual([["#5", "https://github.com/o/r/issues/5"]]);

    // The message is not tried again; the next one gets a new worker.
    FakeWorker.hang = false;
    show("#5 " + "a".repeat(40) + "!");
    await answered();
    expect(FakeWorker.created).toHaveLength(1);
    show("aaa");
    await answered();
    expect(FakeWorker.created).toHaveLength(2);
    expect(anchors()).toEqual([["aaa", "https://x.example/aaa"]]);
  });

  it("shows no custom links, rather than match on the page, when no worker can start", async () => {
    await load([JIRA]);
    vi.stubGlobal("Worker", function RefusedWorker() {
      throw new Error("Refused by the content security policy");
    });
    show("ABC-1 #2");
    await answered();
    expect(anchors()).toEqual([["#2", "https://github.com/o/r/issues/2"]]);
  });
});

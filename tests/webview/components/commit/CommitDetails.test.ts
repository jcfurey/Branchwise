// @vitest-environment jsdom
import { type ComponentChildren, Fragment, h, render } from "preact";
import { act } from "preact/test-utils";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi
} from "vitest";

import type { GitCommitDetails } from "@/backend/types";
import { CommitDetails, DetailsRow } from "@/webview/components/commit/CommitDetails";
import { commitDetails, expandedCommit } from "@/webview/lib/stores";
import { buildFileTree } from "@/webview/utils/fileTree";

import {
  attachHost,
  plainText,
  reconfigure,
  speak
} from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

vi.mock("@/webview/utils/fileTree", async (original) => {
  const actual = await original<typeof import("@/webview/utils/fileTree")>();
  return { ...actual, buildFileTree: vi.fn(actual.buildFileTree) };
});

const ENGLISH = {
  detailCommit: "Commit ID: {0}",
  detailParents: "Parent commits: {0}",
  detailAuthor: "Author: {0}",
  detailDate: "Date: {0}",
  detailCommitter: "Committer: {0}",
  close: "Close",
  unknownDate: "Unknown date"
};

/** The commit of the specification's first example, with no changed files. */
function sample(overrides: Partial<GitCommitDetails> = {}): GitCommitDetails {
  return {
    hash: "c".repeat(40),
    parents: ["p".repeat(40), "q".repeat(40)],
    author: "Ann <x>",
    email: "ann+tag@ex ample.com",
    date: 1_700_000_000,
    committer: "Bob",
    body: "Subject\n\n  indented body <b>",
    fileChanges: [],
    ...overrides
  };
}

/** A fresh list holding one modified file, as each reply from the extension would be. */
function oneChange(): GitCommitDetails["fileChanges"] {
  return [{ oldFilePath: "a.txt", newFilePath: "a.txt", type: "M", additions: 1, deletions: 1 }];
}

let host: HTMLDivElement;
/** Stands in for `window.scrollBy`, which jsdom does not implement. */
let scrollBy: Mock<(options?: ScrollToOptions) => void>;

/** Draw `content` as the details of a focusable row, inside a table with a heading row. */
function drawUnderOwner(content: ComponentChildren) {
  act(() =>
    render(
      h(
        "table",
        null,
        h("thead", null, h("tr", null, h("th", null, "heading"))),
        h("tbody", null, h(Fragment, null, h("tr", { id: "owner", tabIndex: -1 }), content))
      ),
      host
    )
  );
}

const detailsRow = () => host.querySelector<HTMLTableRowElement>("tr[data-details-row]")!;
const closeButton = () => detailsRow().querySelector<HTMLButtonElement>("button")!;
/** Each one-line fact: the bold label that starts it, and the whole line's text. */
const facts = () =>
  [...detailsRow().querySelectorAll("b")].map((label) => ({
    label: label.textContent,
    text: plainText(label.parentElement?.textContent)
  }));

beforeAll(() => {
  vi.stubEnv("TZ", "UTC");
  setupWebviewTest();
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  speak(ENGLISH);
  scrollBy = vi.fn();
  Object.defineProperty(window, "scrollBy", { value: scrollBy, configurable: true });
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  document.documentElement.style.removeProperty("--main-header-height");
  vi.restoreAllMocks();
});

describe("the details frame", () => {
  it("has a fixed-height row with an empty graph cell and a four-column content cell", () => {
    drawUnderOwner(h(DetailsRow, null, h("p", null, "child")));

    const row = detailsRow();
    expect(row.getAttribute("data-details-row")).toBe("true");
    expect(row.style.height).toBe("250px");
    expect(row.hasAttribute("data-commit-hash")).toBe(false);
    expect(row.cells).toHaveLength(2);
    expect(row.cells[0]!.childNodes).toHaveLength(0);
    const content = row.cells[1]!;
    expect(content.colSpan).toBe(4);
    expect(content.getAttribute("colspan")).toBe("4");
    const block = content.firstElementChild as HTMLElement;
    expect(block.style.height).toBe("248px");
    expect(block.innerHTML).toBe("<p>child</p>");
    const button = closeButton();
    expect(button.getAttribute("type")).toBe("button");
    expect(button.title).toBe("Close");
    expect(button.getAttribute("aria-label")).toBe("Close");
    const glyph = button.querySelector("svg")!;
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect([glyph.getAttribute("width"), glyph.getAttribute("height")]).toEqual(["24", "24"]);
  });

  it("closes on the button and hands focus back to the row above without scrolling", () => {
    expandedCommit.value = "owner";
    drawUnderOwner(h(DetailsRow, null, "content"));
    const owner = host.querySelector<HTMLElement>("#owner")!;
    const focus = vi.spyOn(owner, "focus");

    act(() => closeButton().click());

    expect(expandedCommit.value).toBeNull();
    expect(commitDetails.value).toBeNull();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(owner);
  });

  it("keeps Escape to itself and lets other keys through", () => {
    expandedCommit.value = "owner";
    drawUnderOwner(h(DetailsRow, null, h("button", { id: "inside" }, "inner")));
    const heard = vi.fn();
    document.addEventListener("keydown", heard);
    try {
      const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      act(() => {
        closeButton().dispatchEvent(enter);
      });
      expect(enter.defaultPrevented).toBe(false);
      expect(heard).toHaveBeenCalledOnce();
      expect(expandedCommit.value).toBe("owner");

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true
      });
      act(() => {
        host.querySelector("#inside")!.dispatchEvent(escape);
      });
      expect(escape.defaultPrevented).toBe(true);
      expect(heard).toHaveBeenCalledOnce();
      expect(expandedCommit.value).toBeNull();
      expect(document.activeElement?.id).toBe("owner");
    } finally {
      document.removeEventListener("keydown", heard);
    }
  });

  it("still closes when nothing comes before it", () => {
    expandedCommit.value = "gone";
    act(() => render(h("table", null, h("tbody", null, h(DetailsRow, null, "only"))), host));

    expect(() => act(() => closeButton().click())).not.toThrow();
    expect(expandedCommit.value).toBeNull();
  });
});

describe("scrolling the details into view", () => {
  let box: { top: number; height: number };
  let heading: number;

  beforeEach(() => {
    box = { top: 0, height: 250 };
    heading = 32;
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element
    ) {
      if (this.hasAttribute("data-details-row")) {
        return { top: box.top, bottom: box.top + box.height, height: box.height } as DOMRect;
      }
      return {
        top: 0,
        bottom: heading,
        height: this.tagName === "THEAD" ? heading : 0
      } as DOMRect;
    });
  });

  /** Open details whose row starts `top` pixels down the window, then let them load. */
  function openAt(top: number) {
    box.top = top;
    scrollBy.mockClear();
    act(() => render(null, host));
    drawUnderOwner(h(CommitDetails, { details: null }));
    const opened = scrollBy.mock.calls.map(([options]) => options as ScrollToOptions);
    drawUnderOwner(h(CommitDetails, { details: sample() }));
    expect(scrollBy).toHaveBeenCalledTimes(opened.length);
    return opened;
  }

  it("centres the details once when auto-centring is on", () => {
    expect(openAt(100)).toEqual([{ top: -275 }]);
    expect(openAt(900)).toEqual([{ top: 525 }]);
    expect(openAt(375)).toEqual([{ top: 0 }]);
  });

  it("otherwise keeps the commit row below both sticky headings and the details above the edge", () => {
    const restore = reconfigure({ autoCenterCommitDetailsView: false });
    try {
      // No page header: 32px of table heading and the 24px commit row stay clear.
      expect(openAt(10)).toEqual([{ top: -46 }]);
      expect(openAt(40)).toEqual([{ top: -16 }]);
      expect(openAt(56)).toEqual([]);
      expect(openAt(500)).toEqual([]);
      expect(openAt(742)).toEqual([]);
      expect(openAt(743)).toEqual([{ top: 1 }]);
      expect(openAt(800)).toEqual([{ top: 58 }]);

      // A page header adds its own height, as MainHeader reports it on the root element.
      document.documentElement.style.setProperty("--main-header-height", "40px");
      expect(openAt(80)).toEqual([{ top: -16 }]);
      expect(openAt(96)).toEqual([]);

      // A taller heading row, such as one that wrapped, is measured rather than assumed.
      heading = 50;
      expect(openAt(100)).toEqual([{ top: -14 }]);
    } finally {
      restore();
    }
  });

  it("assumes the usual heading height in a table without one", () => {
    const restore = reconfigure({ autoCenterCommitDetailsView: false });
    try {
      box.top = 40;
      act(() => render(h("table", null, h("tbody", null, h(DetailsRow, null, "x"))), host));
      expect(scrollBy.mock.calls).toEqual([[{ top: -16 }]]);
    } finally {
      restore();
    }
  });
});

describe("commit facts", () => {
  it("shows the loading indicator until the details arrive", () => {
    drawUnderOwner(h(CommitDetails, { details: null }));

    expect(host.querySelector('[data-details-row] [role="status"]')).not.toBeNull();
    expect(detailsRow().querySelectorAll("b")).toHaveLength(0);
    expect(closeButton()).not.toBeNull();
  });

  it("lists the facts as text, with the author's address as a link", () => {
    drawUnderOwner(h(CommitDetails, { details: sample() }));

    expect(facts()).toEqual([
      { label: "Commit ID: ", text: `Commit ID: ${"c".repeat(40)}` },
      {
        label: "Parent commits: ",
        text: `Parent commits: ${"p".repeat(40)}, ${"q".repeat(40)}`
      },
      { label: "Author: ", text: "Author: Ann <x> <ann+tag@ex ample.com>" },
      { label: "Date: ", text: "Date: Tuesday, November 14, 2023 at 10:13:20 PM UTC" },
      { label: "Committer: ", text: "Committer: Bob" }
    ]);
    const link = detailsRow().querySelector("a")!;
    expect(link.textContent).toBe("ann+tag@ex ample.com");
    expect(detailsRow().querySelector("p")!.textContent).toBe("Subject\n\n  indented body <b>");
    expect(detailsRow().querySelector("p b")).toBeNull();
    expect(detailsRow().querySelector("ul")!.children).toHaveLength(0);
  });

  it("keeps the @ of the address readable in the mailto link", () => {
    const hrefs = ["ann+tag@ex ample.com", "odd@name@example.org", "no at sign"].map((email) => {
      drawUnderOwner(h(CommitDetails, { details: sample({ email }) }));
      return detailsRow().querySelector("a")!.getAttribute("href");
    });

    expect(hrefs).toEqual([
      "mailto:ann%2Btag@ex%20ample.com",
      "mailto:odd%40name@example.org",
      "mailto:no%20at%20sign"
    ]);
  });

  it("shows only the name when there is no address", () => {
    drawUnderOwner(h(CommitDetails, { details: sample({ author: "Ann", email: "" }) }));

    expect(facts()[2]).toEqual({ label: "Author: ", text: "Author: Ann" });
    expect(detailsRow().querySelector("a")).toBeNull();
  });

  it.each([Number.NaN, 99_999_999_999_999, null as unknown as number])(
    "reads an unusable date %s as unknown",
    (date) => {
      drawUnderOwner(h(CommitDetails, { details: sample({ date }) }));

      expect(facts()[3]).toEqual({ label: "Date: ", text: "Date: Unknown date" });
    }
  );

  it("splits templates at the placeholder and fills them literally", () => {
    speak({
      ...ENGLISH,
      detailCommit: "{0} is the commit",
      detailParents: "No placeholder",
      detailAuthor: "A {0} B {0} C",
      detailCommitter: "By $& $' {0} $$"
    });
    drawUnderOwner(
      h(CommitDetails, { details: sample({ committer: "Bob $& $1", parents: ["p1"] }) })
    );

    const [commit, parents, author, , committer] = facts();
    expect(commit).toEqual({ label: "", text: `${"c".repeat(40)} is the commit` });
    expect(parents).toEqual({ label: "No placeholder", text: "No placeholderp1" });
    expect(author).toEqual({
      label: "A ",
      text: "A Ann <x> <ann+tag@ex ample.com> B "
    });
    expect(committer).toEqual({ label: "By $& $' ", text: "By $& $' Bob $& $1 $$" });
  });

  it("builds the file tree once per details object", () => {
    const build = vi.mocked(buildFileTree);
    build.mockClear();
    drawUnderOwner(h(CommitDetails, { details: null }));
    expect(build).not.toHaveBeenCalled();

    const details = sample({ fileChanges: oneChange() });
    drawUnderOwner(h(CommitDetails, { details }));
    drawUnderOwner(h(CommitDetails, { details }));
    expect(build).toHaveBeenCalledOnce();
    expect(build).toHaveBeenLastCalledWith(details.fileChanges);
    expect(detailsRow().querySelector("li > button")?.textContent).toContain("a.txt");

    drawUnderOwner(h(CommitDetails, { details: sample({ fileChanges: oneChange() }) }));
    expect(build).toHaveBeenCalledTimes(2);
  });
});

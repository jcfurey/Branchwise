// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContainingRefs as Refs, RepositoryQuery } from "@/backend/types";
import { BRANCHES_SHOWN, ContainingRefs } from "@/webview/components/commit/ContainingRefs";
import { focusBranchInGraph } from "@/webview/lib/actions";
import { revealCommit } from "@/webview/lib/jump-to-head";
import { handleRepositoryQuery, repositoryRevision } from "@/webview/lib/repository-actions";
import { selectedRepo, showRemoteBranch } from "@/webview/lib/stores";

import { attachHost, speak } from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

vi.mock("@/webview/lib/actions", async (original) => ({
  ...(await original<typeof import("@/webview/lib/actions")>()),
  focusBranchInGraph: vi.fn()
}));
vi.mock("@/webview/lib/jump-to-head", async (original) => ({
  ...(await original<typeof import("@/webview/lib/jump-to-head")>()),
  revealCommit: vi.fn()
}));

const ENGLISH = {
  checkingRefs: "Checking…",
  detailContainedIn: "Contained in:",
  moreBranches: "and {0} more",
  firstReleasedIn: "First released in {0}",
  laterTag: "also in {0} later tag",
  laterTags: "also in {0} later tags",
  followsTag: "Follows {0}",
  focusBranchChip: "Focus {0} in the graph",
  selectTaggedCommit: "Select the commit tagged {0}"
};

type Posted = { command: string; repo: string; requestId: string; query?: RepositoryQuery };

const outbox = (): Posted[] => vscodeApi.postMessage.mock.calls.map(([sent]) => sent as Posted);
const reads = () =>
  outbox().filter(
    (message) => message.command === "repositoryQuery" && message.query?.kind === "containingRefs"
  );
const cancels = () => outbox().filter(({ command }) => command === "cancelRepositoryQuery");

/** Answer the newest read with `refs`, or with a failure for `null`. */
function answer(refs: Refs | null) {
  const { repo, requestId } = reads().at(-1)!;
  act(() =>
    handleRepositoryQuery({
      repo,
      requestId,
      data: refs === null ? null : { kind: "containingRefs", ...refs },
      status: refs === null ? "failed" : null
    })
  );
}

const tag = (name: string, hash = name.padEnd(40, "0")) => ({ name, hash });

let host: HTMLDivElement;
/** A different commit for each test, so answers cached by an earlier test never show. */
let hash: string;
let count = 0;

const draw = (commit = hash) => act(() => render(h(ContainingRefs, { hash: commit }), host));
const text = () => host.textContent;
const chips = () => [...host.querySelectorAll("button")];

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak(ENGLISH);
  selectedRepo.value = "/work";
  showRemoteBranch.value = true;
  count += 1;
  hash = String(count).padStart(40, "a");
  vscodeApi.postMessage.mockClear();
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.mocked(focusBranchInGraph).mockClear();
  vi.mocked(revealCommit).mockClear();
});

describe("the branches and tags that contain a commit", () => {
  it("asks once the details show, under the graph's visibility, and reads Checking meanwhile", () => {
    draw();
    expect(text()).toBe("Checking…");
    expect(reads()).toHaveLength(1);
    expect(reads()[0]!.query).toEqual({
      kind: "containingRefs",
      hash,
      showRemoteBranches: true,
      hiddenRemotes: []
    });
  });

  it("shows branch chips up to the cap, and counts the rest with all their names", () => {
    draw();
    const branches = [
      "main",
      ...Array.from({ length: BRANCHES_SHOWN + 2 }, (_, at) => `topic-${at}`),
      "remotes/origin/main"
    ];
    answer({ branches, tags: [], follows: null });

    const shown = chips().map((chip) => chip.textContent);
    expect(shown).toEqual(branches.slice(0, BRANCHES_SHOWN));
    const more = host.querySelector<HTMLElement>("[data-contained-in] span[title]")!;
    expect(more.textContent).toBe("and 4 more");
    expect(more.title).toBe("topic-9\ntopic-10\ntopic-11\norigin/main");

    chips()[1]!.click();
    expect(focusBranchInGraph).toHaveBeenCalledWith("topic-0");
    expect(chips()[1]!.title).toBe("Focus topic-0 in the graph");
  });

  it("names remote branches without their prefix and focuses them by their list name", () => {
    draw();
    answer({ branches: ["remotes/origin/main"], tags: [], follows: null });
    expect(chips().map((chip) => chip.textContent)).toEqual(["origin/main"]);
    chips()[0]!.click();
    expect(focusBranchInGraph).toHaveBeenCalledWith("remotes/origin/main");
  });

  it("names the first release, counts the later ones and the tag before, each selecting its commit", () => {
    draw();
    const later = [tag("v1.3.0"), tag("v2.0.0")];
    answer({ branches: [], tags: [tag("v1.2.0"), ...later], follows: tag("v1.1.0") });

    const released = host.querySelector("[data-released-in]")!;
    expect(released.textContent).toBe("First released in v1.2.0also in 2 later tagsFollows v1.1.0");
    const laterCount = released.querySelector<HTMLElement>("span[title]")!;
    expect(laterCount.title).toBe("v1.3.0\nv2.0.0");
    expect(host.querySelector("[data-contained-in]")).toBeNull();

    chips()[0]!.click();
    expect(revealCommit).toHaveBeenCalledWith(tag("v1.2.0").hash);
    chips()[1]!.click();
    expect(revealCommit).toHaveBeenLastCalledWith(tag("v1.1.0").hash);
  });

  it("uses the singular for one later tag", () => {
    draw();
    answer({ branches: ["main"], tags: [tag("v1"), tag("v2")], follows: null });
    expect(host.querySelector("[data-released-in]")!.textContent).toBe(
      "First released in v1also in 1 later tag"
    );
  });

  it("shows nothing for a commit on no branch and in no tag, nor after a failure", () => {
    draw();
    answer({ branches: [], tags: [], follows: tag("v1") });
    expect(host.innerHTML).toBe("");

    draw("f".repeat(40));
    expect(text()).toBe("Checking…");
    answer(null);
    expect(host.innerHTML).toBe("");
  });

  it("cancels the read when the details close or show another commit", () => {
    draw();
    const first = reads()[0]!;
    draw("e".repeat(40));
    expect(cancels()).toEqual([
      { command: "cancelRepositoryQuery", repo: "/work", requestId: first.requestId }
    ]);
    const second = reads().at(-1)!;
    act(() => render(null, host));
    expect(cancels().at(-1)).toEqual({
      command: "cancelRepositoryQuery",
      repo: "/work",
      requestId: second.requestId
    });
  });

  it("keeps answers by commit until the refs change", () => {
    draw();
    answer({ branches: ["main"], tags: [], follows: null });
    act(() => render(null, host));
    draw();
    // Opened again: the answer comes from the cache at once.
    expect(reads()).toHaveLength(1);
    expect(chips().map((chip) => chip.textContent)).toEqual(["main"]);

    act(() => {
      repositoryRevision.value++;
    });
    expect(reads()).toHaveLength(2);
    // The last answer stays up while the new one loads.
    expect(chips().map((chip) => chip.textContent)).toEqual(["main"]);
    answer({ branches: ["main", "topic"], tags: [], follows: null });
    expect(chips().map((chip) => chip.textContent)).toEqual(["main", "topic"]);
  });
});

// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkspaceEntry } from "@/backend/types";
import { handleRepositoryQuery, repositoryRevision } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { useSettledRepositoryQuery } from "@/webview/lib/use-repository-query";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

setupWebviewTest();

let container: HTMLDivElement;
let shown: ReturnType<typeof useSettledRepositoryQuery<"workspace">>;

let alsoShown: ReturnType<typeof useSettledRepositoryQuery<"workspace">>;

function Listing() {
  shown = useSettledRepositoryQuery<"workspace">({ kind: "workspace" });
  return null;
}

/** A second component showing the same listing, as the workspace sync dialog does. */
function AlsoListing() {
  alsoShown = useSettledRepositoryQuery<"workspace">({ kind: "workspace" });
  return null;
}

let nearbyShown: ReturnType<typeof useSettledRepositoryQuery<"workspace">>;

/** The Workspace pane's other read: only the selected repository again, the rest as last read. */
function NearbyListing() {
  nearbyShown = useSettledRepositoryQuery<"workspace">({ kind: "workspace", refresh: "selected" });
  return null;
}

beforeEach(() => {
  selectedRepo.value = "/ws/app";
  repositoryRevision.value = 0;
  vscodeApi.postMessage.mockClear();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

const posted = () => vscodeApi.postMessage.mock.calls.map(([message]) => message);
const reads = () => posted().filter((message) => message.command === "repositoryQuery");
const cancels = () => posted().filter((message) => message.command === "cancelRepositoryQuery");

function entry(path: string): WorkspaceEntry {
  return {
    path,
    parent: null,
    submodulePath: null,
    recorded: null,
    committed: null,
    head: "0".repeat(40),
    branch: "main",
    dirty: 0,
    ahead: 0,
    behind: 0,
    initialized: true,
    error: null,
    operation: null,
    conflicts: 0,
    stashes: 0,
    detached: false,
    upstream: null,
    aheadBranches: 0,
    remotes: 0,
    fetched: null
  };
}

function answer(paths: string[], read = reads().at(-1)) {
  act(() =>
    handleRepositoryQuery({
      repo: read.repo,
      requestId: read.requestId,
      data: { kind: "workspace", entries: paths.map(entry) },
      status: null
    })
  );
}

const bump = () =>
  act(() => {
    repositoryRevision.value++;
  });

describe("a long read that settles", () => {
  it("finishes the read under way when the revision moves on, then reads once more", () => {
    act(() => render(h(Listing, {}), container));
    expect(reads()).toHaveLength(1);

    // The repository keeps changing while the slow read runs: none of it starts the read over.
    bump();
    bump();
    bump();
    expect(reads()).toHaveLength(1);
    expect(cancels()).toHaveLength(0);
    expect(shown.loading).toBe(true);

    answer(["/ws/app"]);
    // The answer shows at once, and one read catches up with every change since.
    expect(shown.data?.entries.map((item) => item.path)).toStrictEqual(["/ws/app"]);
    expect(shown.loading).toBe(true);
    expect(reads()).toHaveLength(2);

    answer(["/ws/app", "/ws/lib"]);
    expect(shown.data?.entries.map((item) => item.path)).toStrictEqual(["/ws/app", "/ws/lib"]);
    expect(shown.loading).toBe(false);
    expect(reads()).toHaveLength(2);
  });

  it("reads again at once for a new revision when no read is under way", () => {
    act(() => render(h(Listing, {}), container));
    answer(["/ws/app"]);
    expect(shown.loading).toBe(false);

    bump();
    expect(reads()).toHaveLength(2);
    expect(shown.loading).toBe(true);
    // The last listing stays while the new one is read.
    expect(shown.data?.entries.map((item) => item.path)).toStrictEqual(["/ws/app"]);
  });

  it("stops the read under way when another repository is selected", () => {
    act(() => render(h(Listing, {}), container));
    const first = reads()[0];

    act(() => {
      selectedRepo.value = "/ws/lib";
    });
    expect(cancels()).toMatchObject([{ repo: "/ws/app", requestId: first.requestId }]);
    expect(reads().at(-1)).toMatchObject({ repo: "/ws/lib", query: { kind: "workspace" } });
  });

  it("stops reading when it leaves the page, and reads nothing on later changes", () => {
    act(() => render(h(Listing, {}), container));
    act(() => render(null, container));
    expect(cancels()).toHaveLength(1);

    bump();
    expect(reads()).toHaveLength(1);
  });

  it("shares one read between the components showing the same listing", () => {
    act(() => render(h("div", {}, h(Listing, {}), h(AlsoListing, {})), container));
    expect(reads()).toHaveLength(1);

    answer(["/ws/app"]);
    expect(shown.data?.entries.map((item) => item.path)).toStrictEqual(["/ws/app"]);
    expect(alsoShown.data?.entries.map((item) => item.path)).toStrictEqual(["/ws/app"]);

    // One of them goes; the other keeps the read, and only it.
    act(() => render(h("div", {}, h(Listing, {})), container));
    expect(cancels()).toHaveLength(0);
    bump();
    expect(reads()).toHaveLength(2);
  });

  it("lets a component that arrives during a read join it, showing the last answer meanwhile", () => {
    act(() => render(h("div", {}, h(Listing, {})), container));
    answer(["/ws/app"]);
    bump();
    expect(reads()).toHaveLength(2);

    act(() => render(h("div", {}, h(Listing, {}), h(AlsoListing, {})), container));
    expect(reads()).toHaveLength(2);
    expect(alsoShown.data?.entries.map((item) => item.path)).toStrictEqual(["/ws/app"]);
    expect(alsoShown.loading).toBe(true);

    answer(["/ws/app", "/ws/lib"]);
    expect(alsoShown.data?.entries.map((item) => item.path)).toStrictEqual(["/ws/app", "/ws/lib"]);
    expect(alsoShown.loading).toBe(false);
    expect(reads()).toHaveLength(2);
  });

  it("numbers the answers, so that a component with two reads can show the later", () => {
    act(() => render(h("div", {}, h(Listing, {}), h(NearbyListing, {})), container));
    const [listing, nearby] = reads();
    expect(nearby.query).toStrictEqual({ kind: "workspace", refresh: "selected" });
    expect([shown.answered, nearbyShown.answered]).toStrictEqual([0, 0]);

    answer(["/ws/app"], nearby);
    expect(nearbyShown.answered).toBeGreaterThan(0);
    expect(shown.answered).toBe(0);

    answer(["/ws/app", "/ws/lib"], listing);
    expect(shown.answered).toBeGreaterThan(nearbyShown.answered);
  });
});

// @vitest-environment jsdom
// Timing report for the Branches pane and branch dropdown. Run with NGG_BENCH_REFS=1; the
// normal suite skips it. It prints the medians as JSON. See docs/performance.md.

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { beforeAll, expect, it, vi } from "vitest";

import type { RepositoryState } from "@/backend/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

vi.mock("@/webview/lib/vscode", () => ({
  vscode: { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() }
}));

const SAMPLES = 5;
const hash = "a".repeat(40);

function state(count: number): RepositoryState {
  return {
    remotes: [{ name: "origin", fetchUrls: ["https://example.test/repo.git"], pushUrls: [] }],
    pushDefault: null,
    branches: Array.from({ length: count }, (_, i) => ({
      name: `branch-${i}`,
      hash,
      upstream: "",
      ahead: 0,
      behind: 0,
      gone: false
    })),
    remoteBranches: Array.from({ length: count }, (_, i) => ({
      name: `origin/remote-${i}`,
      hash
    })),
    tags: Array.from({ length: count }, (_, i) => ({ name: `tag-${i}`, hash })),
    worktrees: [],
    head: "branch-0",
    operation: null,
    conflicts: []
  };
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]! * 10) / 10;
}

function time(run: () => void) {
  const start = performance.now();
  act(run);
  return performance.now() - start;
}

beforeAll(() => {
  setupWebviewTest();
  Element.prototype.scrollIntoView = () => {};
});

/** The webview's type configuration has no Node types; the tests still run in Node. */
const environment = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;

it.runIf(environment?.NGG_BENCH_REFS === "1")(
  "measures the Branches pane and branch dropdown at 3k and 10k refs",
  async () => {
    const { RefsPane } = await import("@/webview/components/repository/RefsPane");
    const { Dropdown } = await import("@/webview/components/ui/Dropdown");
    const { repositoryState } = await import("@/webview/lib/repository-actions");
    const stores = await import("@/webview/lib/stores");
    stores.selectedRepo.value = "/repo";
    stores.selectedBranch.value = "*";
    stores.showRemoteBranch.value = true;
    const report: Record<string, Record<string, number>> = {};
    for (const count of [3000, 10_000]) {
      const container = document.createElement("div");
      document.body.append(container);
      repositoryState.value = state(count);
      const samples: Record<string, number[]> = {
        filterKeystroke: [],
        clearFilter: [],
        openMenu: [],
        openDropdown: []
      };
      act(() => render(h(RefsPane, {}), container));
      const filter = container.querySelector<HTMLInputElement>("input")!;
      const type = (value: string) => {
        filter.value = value;
        filter.dispatchEvent(new Event("input", { bubbles: true }));
      };
      for (let sample = 0; sample < SAMPLES; sample++) {
        samples.filterKeystroke!.push(time(() => type("1")));
        samples.clearFilter!.push(time(() => type("")));
        samples.openMenu!.push(
          time(() => {
            stores.contextMenu.value = { x: 0, y: 0, entries: [], source: `ref:tag:tag-${sample}` };
          })
        );
        act(() => {
          stores.contextMenu.value = null;
        });
      }
      act(() => render(null, container));
      const options = state(count).branches.map((branch) => ({
        label: branch.name,
        value: branch.name
      }));
      for (let sample = 0; sample < SAMPLES; sample++) {
        act(() =>
          render(
            h(Dropdown, { label: "Branch", options, value: "branch-0", onChange: () => {} }),
            container
          )
        );
        samples.openDropdown!.push(time(() => container.querySelector("button")!.click()));
        act(() => render(null, container));
      }
      container.remove();
      report[String(count)] = Object.fromEntries(
        Object.entries(samples).map(([name, values]) => [name, median(values)])
      );
    }
    // eslint-disable-next-line no-console
    console.log(`benchmark-refs ${JSON.stringify(report)}`);
    expect(Object.keys(report)).toEqual(["3000", "10000"]);
  },
  600_000
);

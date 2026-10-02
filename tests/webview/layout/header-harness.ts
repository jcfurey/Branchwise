import { h, render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { expect, vi } from "vitest";

import type { GitRepo } from "@/types";
import { MainHeader } from "@/webview/layout/MainHeader";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import {
  emptyFilter,
  historyFilter,
  refsVisible,
  searchVisible,
  selectedCommits,
  workspaceVisible
} from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

/** A stand-in for the browser's observer that the tests can call back by hand. */
export class FakeResizeObserver {
  static latest: FakeResizeObserver | undefined;
  readonly targets: Element[] = [];
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.latest = this;
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  unobserve() {}

  /** Report a size change, as the browser does after the header wraps. */
  report() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

export const REPOS: GitRepo[] = [
  { name: "a", path: "/r/a" },
  { name: "b", path: "/r/b" }
];

let host: HTMLDivElement | undefined;

/** Two repositories, the first selected with its branches loaded, only the Branches pane open. */
export function resetHeader() {
  resetGraphRequests();
  stores.selectedRepo.value = "/r/a";
  stores.branchList.value = ["main", "remotes/origin/x"];
  stores.selectedBranch.value = "*";
  stores.branchDisplay.value = "filter";
  stores.showRemoteBranch.value = true;
  stores.repoStates.value = {};
  stores.commitList.value = undefined;
  stores.commitHead.value = "head";
  stores.contextMenu.value = null;
  stores.dialog.value = null;
  refsVisible.value = true;
  workspaceVisible.value = false;
  searchVisible.value = false;
  historyFilter.value = emptyFilter();
  selectedCommits.value = [];
  FakeResizeObserver.latest = undefined;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // The pickers bring their active option into view when they open.
  Element.prototype.scrollIntoView = () => {};
  vi.clearAllMocks();
}

export function mount(children: ComponentChildren = h(MainHeader, { repos: REPOS })) {
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(children, host!));
  return host;
}

export function unmount() {
  if (host !== undefined) {
    act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

export function header() {
  const element = host?.querySelector("header");
  if (!element) {
    throw new Error("The header is not shown");
  }
  return element;
}

/** A header button by its text or its accessible name. */
export function headerButton(name: string) {
  const button = [...header().querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name || candidate.getAttribute("aria-label") === name
  );
  expect(button, `header button ${name}`).toBeDefined();
  return button!;
}

/** The trigger of the picker whose label reads `<label>:`. */
export function picker(label: string) {
  const trigger = [...header().querySelectorAll('button[aria-haspopup="listbox"]')].find(
    (button) => {
      const labelId = button.getAttribute("aria-labelledby")?.split(" ")[0];
      return labelId !== undefined && document.getElementById(labelId)?.textContent === `${label}:`;
    }
  );
  expect(trigger, `picker ${label}`).toBeDefined();
  return trigger as HTMLButtonElement;
}

/** Open a picker and read its options as label and title. */
export function pickerOptions(label: string) {
  act(() => picker(label).click());
  const options = [...header().querySelectorAll<HTMLElement>("[role=option]")];
  return options.map((option) => [option.textContent, option.getAttribute("title")]);
}

/** Choose an option of the picker that is open. */
export function choose(text: string) {
  const option = [...header().querySelectorAll<HTMLElement>("[role=option]")].find(
    (candidate) => candidate.textContent === text
  );
  expect(option, `option ${text}`).toBeDefined();
  act(() => option!.click());
}

// @vitest-environment jsdom
import { h, render } from "preact";
import { expect, it } from "vitest";

import { NoCommitsPage } from "@/webview/pages/NoCommitsPage";

import { setupWebviewTest } from "@tests/webview/test-utils";

it("says the repository has no commits and how to make the first", () => {
  setupWebviewTest();
  const host = document.createElement("div");
  render(h(NoCommitsPage, null), host);

  expect(host.childElementCount).toBe(1);
  const main = host.firstElementChild!;
  expect(main.tagName).toBe("MAIN");

  const headings = main.querySelectorAll("h1");
  expect(headings).toHaveLength(1);
  expect(headings[0]!.textContent).toBe("noCommits");
  const paragraphs = main.querySelectorAll("p");
  expect(paragraphs).toHaveLength(1);
  expect(paragraphs[0]!.textContent).toBe("createFirstCommit");
  expect(main.textContent).toBe("noCommitscreateFirstCommit");

  const drawings = [...main.querySelectorAll("svg")];
  expect(drawings.length).toBeGreaterThan(0);
  expect(drawings.every((svg) => svg.getAttribute("aria-hidden") === "true")).toBe(true);
  expect(main.querySelector("button, [role], [id]")).toBeNull();

  render(null, host);
});

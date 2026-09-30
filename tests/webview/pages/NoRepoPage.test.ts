// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import { NoRepoPage } from "@/webview/pages/NoRepoPage";

import { setupWebviewTest } from "@tests/webview/test-utils";

let host: HTMLDivElement;

const button = () => host.querySelector("button")!;
const alert = () => host.querySelector('[role="alert"]');

/** Make `git.init` answer with whatever `answer` returns, and watch the calls. */
function initAnswers(answer: () => Promise<boolean>) {
  return vi.spyOn(rpcClient, "request").mockImplementation(answer as never);
}

/** Run `action`, then let the page's pending `await` resume before the result is drawn. */
async function settle(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeAll(() => {
  setupWebviewTest();
  // Key names, except for the one template the page fills in.
  Object.defineProperty(window, "l10n", {
    value: new Proxy(
      {},
      { get: (_target, key) => (key === "unableToInitializeRepo" ? "Unable: {0}" : String(key)) }
    ),
    configurable: true
  });
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(h(NoRepoPage, null), host));
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.restoreAllMocks();
});

describe("NoRepoPage", () => {
  it("says there is no repository and offers to create one", () => {
    const section = host.querySelector('main > section[aria-labelledby="no-repo-title"]');
    expect(section).not.toBeNull();
    const title = host.querySelector("#no-repo-title")!;
    expect(title.tagName).toBe("H1");
    expect(title.textContent).toBe("noRepo");

    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(button().disabled).toBe(false);
    expect(button().type).toBe("button");
    expect(button().textContent).toBe("initializeRepo");
    expect(alert()).toBeNull();

    expect([...host.querySelectorAll("[id]")].map((element) => element.id)).toEqual([
      "no-repo-title"
    ]);
    const drawings = [...host.querySelectorAll("svg")];
    expect(drawings.length).toBeGreaterThan(0);
    expect(drawings.every((svg) => svg.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });

  it("asks once and stays busy until the extension answers", () => {
    const request = initAnswers(() => new Promise(() => {}));
    // Two clicks in a row, before the page has drawn the button disabled.
    act(() => {
      button().click();
      button().click();
    });
    expect(request).toHaveBeenCalledExactlyOnceWith("git.init", null);
    expect(button().disabled).toBe(true);

    act(() => button().click());
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([true, false])("goes quiet again when the flow ends with %s", async (created) => {
    const answer = Promise.withResolvers<boolean>();
    initAnswers(() => answer.promise);
    act(() => button().click());

    await settle(() => answer.resolve(created));
    expect(button().disabled).toBe(false);
    expect(alert()).toBeNull();
    expect(host.querySelector("h1")?.textContent).toBe("noRepo");
  });

  it.each([
    [
      "an error's message",
      new Error("command 'git.init' not found"),
      "command 'git.init' not found"
    ],
    ["a string as it is", "plain words", "plain words"],
    ["anything else as text", undefined, "undefined"],
    ["an empty message as nothing", new Error(""), ""]
  ])("shows why it failed, using %s", async (_how, reason, shown) => {
    initAnswers(() => Promise.reject(reason));
    await settle(() => button().click());
    expect(alert()?.tagName).toBe("P");
    expect(alert()?.textContent).toBe(`Unable: ${shown}`);
    expect(button().disabled).toBe(false);
  });

  it("shows an error that the request throws before it returns", async () => {
    initAnswers(() => {
      throw new Error("could not post");
    });
    await settle(() => button().click());
    expect(alert()?.textContent).toBe("Unable: could not post");
    expect(button().disabled).toBe(false);
  });

  it("puts the reason in the message exactly as it is written", async () => {
    initAnswers(() => Promise.reject(new Error("cost $& and $1 and $$ and $' and $`")));
    await settle(() => button().click());
    expect(alert()?.textContent).toBe("Unable: cost $& and $1 and $$ and $' and $`");
  });

  it("clears the last error as soon as it tries again", async () => {
    const request = initAnswers(() => Promise.reject(new Error("first")));
    await settle(() => button().click());
    expect(alert()).not.toBeNull();

    request.mockImplementation((() => new Promise(() => {})) as never);
    act(() => button().click());
    expect(alert()).toBeNull();
    expect(button().disabled).toBe(true);
  });

  it("does nothing when the answer comes after the page has gone", async () => {
    const answer = Promise.withResolvers<boolean>();
    initAnswers(() => answer.promise);
    act(() => button().click());
    act(() => render(null, host));

    await settle(() => answer.reject(new Error("too late")));
    expect(host.innerHTML).toBe("");
  });

  it("gives the focus back to the button once it can take it again", async () => {
    const answer = Promise.withResolvers<boolean>();
    initAnswers(() => answer.promise);
    button().focus();
    act(() => {
      button().click();
      // What the browser does with the focus of a button that becomes disabled. jsdom does not,
      // and ignores blur() once the button is disabled, so it happens before the page redraws.
      button().blur();
    });
    expect(button().disabled).toBe(true);
    expect(document.activeElement).toBe(document.body);

    await settle(() => answer.reject(new Error("no")));
    expect(document.activeElement).toBe(button());
  });

  it("leaves the focus where the user moved it while waiting", async () => {
    const answer = Promise.withResolvers<boolean>();
    initAnswers(() => answer.promise);
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    act(() => button().click());
    elsewhere.focus();

    await settle(() => answer.resolve(true));
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

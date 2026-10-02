// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openActivity } from "@/webview/components/history/ActivityView";
import { QueryStatus } from "@/webview/components/history/QueryControls";
import { Dialog } from "@/webview/components/ui/Dialog";
import { closeDialog, openErrorDialog } from "@/webview/lib/actions";
import { copyToClipboard } from "@/webview/lib/actions/clipboard";
import { activity } from "@/webview/lib/activity";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import { dialog } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

/** Strings that read as their keys, apart from the ones given. */
function withStrings(strings: Record<string, string> = {}) {
  Object.defineProperty(window, "l10n", {
    value: new Proxy({} as typeof window.l10n, {
      get: (_target, key) => strings[String(key)] ?? String(key)
    }),
    configurable: true
  });
}

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  dialog.value = null;
  vscodeApi.postMessage.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  withStrings();
});

const copyFailure = (reason: string | null) => ({
  kind: "error",
  message: "unableToCopyToClipboard",
  reason
});

describe("the request", () => {
  it("carries exactly the text, and is posted before the call returns", async () => {
    const request = vi.spyOn(rpcClient, "request");
    const copying = copyToClipboard("Commit Hash", "abc");

    expect(request).toHaveBeenCalledWith("clipboard.copy", "abc");
    const [posted] = vscodeApi.postMessage.mock.lastCall as [{ id: string }];
    expect(posted).toEqual({
      kind: "rpc.request",
      id: expect.any(String),
      method: "clipboard.copy",
      params: "abc"
    });

    const data = { kind: "rpc.response", id: posted.id, success: true, result: true };
    window.dispatchEvent(new MessageEvent("message", { data }));
    await copying;
    expect(dialog.value).toBeNull();
  });
});

describe("the outcome", () => {
  it.each([true, "yes"])("of a copy answered %j leaves the screen as it was", async (result) => {
    vi.spyOn(rpcClient, "request").mockResolvedValue(result as never);
    await expect(copyToClipboard("Commit Hash", "abc")).resolves.toBe(true);
    expect(dialog.value).toBeNull();
  });

  it.each([false, undefined, 0])(
    "of a copy answered %j is a failure without a reason",
    async (result) => {
      vi.spyOn(rpcClient, "request").mockResolvedValue(result as never);
      await expect(copyToClipboard("Commit Hash", "abc")).resolves.toBe(false);
      expect(dialog.value).toMatchObject(copyFailure(null));
    }
  );

  it("of a failed request shows the request's error as the reason", async () => {
    vi.spyOn(rpcClient, "request").mockRejectedValue(new Error("nope"));
    await expect(copyToClipboard("Commit Hash", "abc")).resolves.toBe(false);
    expect(dialog.value).toMatchObject(copyFailure("nope"));
  });

  it("of a request failing with something other than an Error shows it as text", async () => {
    vi.spyOn(rpcClient, "request").mockRejectedValue(404);
    await copyToClipboard("Commit Hash", "abc");
    expect(dialog.value).toMatchObject(copyFailure("404"));
  });

  it("of a request that is never answered comes at the deadline, with its text", async () => {
    vi.useFakeTimers();
    document.documentElement.dataset["rpcTimeout"] = "Nothing heard from {0}";
    rpcClient.init();
    let settled = false;
    const copying = copyToClipboard("T", "d").then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(dialog.value).toBeNull();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await copying;
    expect(dialog.value).toMatchObject(copyFailure("Nothing heard from clipboard.copy"));
    delete document.documentElement.dataset["rpcTimeout"];
  });
});

describe("the failure's title", () => {
  it("puts the type, literally, at every placeholder", async () => {
    withStrings({ unableToCopyToClipboard: "Unable to copy the {0} to the clipboard {0}" });
    vi.spyOn(rpcClient, "request").mockResolvedValue(false as never);

    await copyToClipboard("Tag $& Name", "v1");

    expect(dialog.value).toMatchObject({
      message: "Unable to copy the Tag $& Name to the clipboard Tag $& Name"
    });
  });
});

describe("copying error details", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    withStrings({
      unableToCopyToClipboard: "Unable to copy the {0} to the clipboard",
      errorDetails: "error details",
      copyError: "Copy Error Details"
    });
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    act(() => render(null, container));
    container.remove();
    closeDialog();
  });

  function press(label: string) {
    const target = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label
    );
    expect(target).toBeDefined();
    return act(async () => target!.click());
  }

  it.each<[string, () => void, string]>([
    [
      "an error dialog",
      () => {
        act(() => render(h(Dialog, null), container));
        act(() => openErrorDialog("Push failed", "rejected"));
      },
      "rejected"
    ],
    [
      "a query error",
      () => {
        act(() => render(h(QueryStatus, { loading: false, error: "bad query" }), container));
      },
      "bad query"
    ],
    [
      "a Git Activity entry",
      () => {
        activity.value = [
          {
            id: "a1",
            repo: "/r",
            title: "Fetch",
            detail: "",
            started: 0,
            finished: 5,
            error: "offline"
          }
        ];
        act(() => render(h(Dialog, null), container));
        act(() => openActivity());
      },
      "Fetch\n/r\noffline"
    ]
  ])("from %s names them as error details when it fails", async (_label, show, copied) => {
    const request = vi.spyOn(rpcClient, "request").mockResolvedValue(false as never);
    show();

    await press("Copy Error Details");

    expect(request).toHaveBeenCalledWith("clipboard.copy", copied);
    expect(dialog.value).toMatchObject({
      kind: "error",
      message: "Unable to copy the error details to the clipboard"
    });
  });
});

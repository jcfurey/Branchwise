import { describe, expect, expectTypeOf, it } from "vitest";

// The globals of `src/webview/global.d.ts` and the settings of `src/webview/tsconfig.json`, as
// `tsc -p tests/webview` sees them. Every line under `@ts-expect-error` must fail to compile. The
// probes below are compiled, never called: this file runs without a page.

type WebviewApi = ReturnType<typeof acquireVsCodeApi>;
type Outgoing = Parameters<WebviewApi["postMessage"]>[0];

/** Hands `sample` back unchanged, once the compiler agrees that it is a `Shape`. */
function shaped<Shape>(sample: Shape): Shape {
  return sample;
}

function readSavedState(api: WebviewApi) {
  // @ts-expect-error: the saved state must be checked before use.
  const saved: string = api.getState();
  return saved;
}

function readString() {
  const text: string = window.l10n.repo;
  return text;
}

function useHostGlobals() {
  // @ts-expect-error: the webview runs without Node.
  process.cwd();
  return document.createElement("div");
}

describe("the webview API", () => {
  it("offers exactly the three methods the page uses", () => {
    expectTypeOf<keyof WebviewApi>().toEqualTypeOf<"getState" | "setState" | "postMessage">();
  });

  it("posts requests of either protocol and nothing the extension sends", () => {
    const ready = shaped<Outgoing>({ command: "viewReady" });
    const init = shaped<Outgoing>({
      kind: "rpc.request",
      id: "1",
      method: "git.init",
      params: null
    });
    // @ts-expect-error: refresh travels the other way only.
    shaped<Outgoing>({ command: "refresh" });
    // @ts-expect-error: not a command at all.
    shaped<Outgoing>({ command: "nope" });

    expect([ready, init]).toHaveLength(2);
  });

  it("returns saved state unchecked", () => {
    expect(readSavedState).toBeTypeOf("function");
    expectTypeOf<ReturnType<WebviewApi["getState"]>>().toBeUnknown();
  });
});

describe("page globals", () => {
  it("types every string of window.l10n as present", () => {
    expect(readString).toBeTypeOf("function");
  });

  it("resolves stylesheet imports without typed exports", () => {
    expectTypeOf<typeof import("@/webview/styles.css")>().toBeAny();
  });

  it("offers the DOM but no Node globals", () => {
    expect(useHostGlobals).toBeTypeOf("function");
  });
});

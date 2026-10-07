import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  GitRepo,
  RepoUpdate,
  RpcMethod,
  RpcNotification,
  RpcNotificationMap,
  RpcNotificationName,
  RpcRequest,
  RpcResponse,
  ScanRepoResult,
  SidebarPane,
  WebviewInitialize
} from "@/types";

// These checks run when `tsc -p tests` compiles this file. Each line under `@ts-expect-error`
// has to be rejected, so a looser type breaks the type check rather than passing silently.

/** Hands `sample` back unchanged, once the compiler agrees that it is a `Shape`. */
function shaped<Shape>(sample: Shape): Shape {
  return sample;
}

/** What a request carries, read after asking which method it is for. */
function carried(request: RpcRequest): string | null {
  if (request.method === "clipboard.copy" || request.method === "url.open") {
    const text: string = request.params;
    return text;
  }
  if (request.method === "goTo.show") {
    const repo: string = request.params.repo;
    return repo;
  }
  return request.params;
}

/** The same read without asking first. Compiled, never called. */
function uncheckedText(request: RpcRequest) {
  // @ts-expect-error: only the clipboard and browser methods take a string.
  const text: string = request.params;
  return text;
}

const initCall = { kind: "rpc.request", id: "g", method: "git.init" } as const;
const clipboardAnswer = { kind: "rpc.response", id: "1" } as const;
const rescanNote = { kind: "rpc.notify", id: "x", name: "repo.rescan" } as const;

describe("requests", () => {
  it("narrow their parameters by method", () => {
    const copy = shaped<RpcRequest>({
      kind: "rpc.request",
      id: "c1",
      method: "clipboard.copy",
      params: "abc123"
    });
    const scan = shaped<RpcRequest>({
      kind: "rpc.request",
      id: "s1",
      method: "repo.scan",
      params: null
    });

    expect([carried(copy), carried(scan)]).toEqual(["abc123", null]);
    expect(uncheckedText).toBeTypeOf("function");
  });

  it("carry null for a method without parameters, never nothing", () => {
    const init = shaped<RpcRequest<"git.init">>({ ...initCall, params: null });
    // @ts-expect-error: undefined would vanish on the wire, and the extension ignores the request.
    shaped<RpcRequest<"git.init">>({ ...initCall, params: undefined });
    // @ts-expect-error: the key itself is required.
    shaped<RpcRequest<"git.init">>(initCall);
    // @ts-expect-error: parameters of another method do not fit.
    shaped<RpcRequest>({ ...initCall, params: "text" });

    expect(Object.hasOwn(init, "params")).toBe(true);
    expectTypeOf<RpcRequest<never>>().toBeNever();
  });
});

describe("responses", () => {
  it("are a success with the method's result or a failure with its text", () => {
    const done = shaped<RpcResponse<"clipboard.copy">>({
      ...clipboardAnswer,
      success: true,
      result: true
    });
    const failed = shaped<RpcResponse<"clipboard.copy">>({
      ...clipboardAnswer,
      success: false,
      error: "x"
    });
    // @ts-expect-error: the clipboard answers with a boolean.
    shaped<RpcResponse<"clipboard.copy">>({ ...clipboardAnswer, success: true, result: "yes" });
    // @ts-expect-error: a failure says why.
    shaped<RpcResponse<"clipboard.copy">>({ ...clipboardAnswer, success: false });

    expect([done.success, failed.success]).toEqual([true, false]);
    expectTypeOf<Extract<RpcResponse, { success: true }>["result"]>().toEqualTypeOf<
      boolean | WebviewInitialize | ScanRepoResult
    >();
  });
});

describe("names", () => {
  it("are exactly the methods, notifications and panes the two sides handle", () => {
    expectTypeOf<RpcMethod>().toEqualTypeOf<
      | "clipboard.copy"
      | "webview.initialize"
      | "git.init"
      | "git.clone"
      | "folder.open"
      | "repo.scan"
      | "settings.open"
      | "docs.open"
      | "walkthrough.open"
      | "goTo.show"
      | "url.open"
    >();
    expectTypeOf<RpcNotificationName>().toEqualTypeOf<
      | "view.showPane"
      | "view.goTo"
      | "view.reveal"
      | "repo.select"
      | "repo.rescan"
      | "config.changed"
      | "repo.updated"
    >();
    expectTypeOf<SidebarPane>().toEqualTypeOf<"refs" | "workspace">();
  });

  it("give each answer record its own keys", () => {
    expectTypeOf<keyof WebviewInitialize>().toEqualTypeOf<"l10n" | "config">();
    expectTypeOf<keyof ScanRepoResult>().toEqualTypeOf<"repos">();
  });
});

describe("notifications", () => {
  it("pair every name with its own payload", () => {
    const rescan = shaped<RpcNotification>({ ...rescanNote, message: null });
    // @ts-expect-error: a rescan carries no path.
    shaped<RpcNotification>({ ...rescanNote, message: { path: "/a" } });
    // @ts-expect-error: the payload key is required even when it is null.
    shaped<RpcNotification>(rescanNote);

    expect(rescan.message).toBeNull();
    expectTypeOf<RpcNotification<never>>().toBeNever();
    expectTypeOf<RpcNotification<"repo.updated">["message"]>().toEqualTypeOf<RepoUpdate>();
  });
});

describe("repository records", () => {
  it("need both a name and a path, and an update needs its path", () => {
    const repo = shaped<GitRepo>({ name: "app", path: "/work/app" });
    // @ts-expect-error: a repository without its path cannot be selected.
    shaped<GitRepo>({ name: "a" });
    // @ts-expect-error: nor can one without a name be listed.
    shaped<GitRepo>({ path: "/a" });
    // @ts-expect-error: an update names the repository that changed.
    shaped<RepoUpdate>({});

    expect(repo).toEqual({ name: "app", path: "/work/app" });
    expectTypeOf<RpcNotificationMap["repo.select"]>().toEqualTypeOf<GitRepo>();
    expectTypeOf<RpcNotificationMap["repo.updated"]>().toEqualTypeOf<RepoUpdate>();
  });
});

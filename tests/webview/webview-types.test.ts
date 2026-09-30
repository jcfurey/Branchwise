import { describe, expect, expectTypeOf, it } from "vitest";

import type { BranchDisplay as StoredDisplay, FocusDimming as StoredDimming } from "@/types";
import type {
  ActionCommand,
  BranchDisplay,
  CommitBranchType,
  ContextMenuState,
  DialogInput,
  DialogState,
  DialogValues,
  FocusDimming
} from "@/webview/types";

// Checked by `tsc -p tests/webview`: every line under `@ts-expect-error` must fail to compile.

/** Hands `sample` back unchanged, once the compiler agrees that it is a `Shape`. */
function shaped<Shape>(sample: Shape): Shape {
  return sample;
}

const ignore = () => {};

/** The element a dialog belongs to, which only a form records. */
function owner(state: DialogState) {
  if (state.kind === "form") {
    expectTypeOf(state.source).toEqualTypeOf<string | null>();
    expectTypeOf(state.token).toEqualTypeOf<number>();
    return state.source;
  }
  return undefined;
}

describe("form values", () => {
  it("follow the inputs position by position", () => {
    const choices: Array<{ label: string; value: string }> = [{ label: "Soft", value: "soft" }];
    const inputs = [
      { kind: "text", value: "" },
      { kind: "checkbox", label: "Force", value: false },
      { kind: "select", value: "soft", options: choices },
      { kind: "ref", value: "topic" },
      { kind: "textarea", value: "" }
    ] as const;

    expectTypeOf<DialogValues<typeof inputs>>().toEqualTypeOf<
      readonly [string, boolean, string, string, string]
    >();
    expectTypeOf<DialogValues<Array<DialogInput>>>().toEqualTypeOf<Array<string | boolean>>();
    expect(inputs).toHaveLength(5);
  });

  it("refuse controls that lack or add a field", () => {
    const text = shaped<DialogInput>({ kind: "text", value: "", placeholder: "Name" });
    // @ts-expect-error: a checkbox carries its own label.
    shaped<DialogInput>({ kind: "checkbox", value: true });
    // @ts-expect-error: a ref field has no placeholder.
    shaped<DialogInput>({ kind: "ref", value: "", placeholder: "name" });
    // @ts-expect-error: a drop-down lists its options.
    shaped<DialogInput>({ kind: "select", value: "" });
    // @ts-expect-error: an absent label is left out rather than undefined.
    shaped<DialogInput>({ kind: "text", value: "", label: undefined });

    expect(text.kind).toBe("text");
  });
});

describe("dialog state", () => {
  it("needs the token of its opening", () => {
    const failure = { kind: "error", message: "m", reason: null } as const;
    const opened = shaped<DialogState>({ ...failure, token: 1 });
    // @ts-expect-error: the dialog is keyed by its token.
    shaped<DialogState>(failure);

    expect(opened.token).toBe(1);
  });

  it("narrows on kind to that body's fields and the token", () => {
    const confirm = shaped<DialogState>({
      kind: "form",
      message: "Delete the tag?",
      inputs: [],
      action: "Delete",
      onSubmit: ignore,
      source: null,
      destructive: true,
      token: 8
    });
    const running = shaped<DialogState>({
      kind: "running",
      message: "Pushing",
      detail: "git push origin main",
      started: 1_767_225_600_000,
      onCancel: ignore,
      token: 9
    });

    expect([owner(confirm), owner(running)]).toEqual([null, undefined]);
  });
});

describe("menus", () => {
  it("hold rows and separators under the key of their owner", () => {
    const menu = shaped<ContextMenuState>({
      x: 120,
      y: 48,
      entries: [{ title: "Checkout", onClick: ignore }, null, { title: "Delete", onClick: ignore }],
      source: "ref:head:main"
    });

    expect(menu.entries.filter((entry) => entry === null)).toHaveLength(1);
  });
});

describe("action commands", () => {
  it("leave the repository to runAction and keep every other field", () => {
    const deleteTag = shaped<ActionCommand>({ command: "deleteTag", tagName: "v1" });
    const push = {
      command: "pushBranch",
      branchName: "main",
      remote: "origin",
      remoteBranch: "main",
      setUpstream: false
    } as const;
    const correlated = shaped<ActionCommand>({ ...push, requestId: "action-1" });
    // @ts-expect-error: the repository comes from the selection.
    shaped<ActionCommand>({ command: "deleteTag", tagName: "v1", repo: "/r" });
    // @ts-expect-error: a push is always correlated.
    shaped<ActionCommand>(push);

    expect([deleteTag.command, correlated.command]).toEqual(["deleteTag", "pushBranch"]);
  });
});

describe("branch values", () => {
  it("take the all-branches marker and any branch name", () => {
    const values: Array<CommitBranchType> = ["*", "main", "remotes/origin/main"];

    expectTypeOf<string>().toExtend<CommitBranchType>();
    expect(values).toHaveLength(3);
  });

  it("re-export the stored preference types themselves", () => {
    expectTypeOf<BranchDisplay>().toEqualTypeOf<StoredDisplay>();
    expectTypeOf<FocusDimming>().toEqualTypeOf<StoredDimming>();
  });
});

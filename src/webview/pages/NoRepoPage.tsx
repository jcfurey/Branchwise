import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { Button } from "@/webview/components/ui/Button";
import { Icon } from "@/webview/components/ui/Icons";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";

/** `template` with its `{0}` replaced by `reason` as it is: a function replacement expands no `$`. */
function fill(template: string, reason: string) {
  return template.replace("{0}", () => reason);
}

/** A folder with a small graph of three commits inside it. */
function Illustration() {
  return (
    <div class="mx-auto mb-6 flex size-28 items-center justify-center rounded-full border border-line-soft bg-btn">
      <svg
        viewBox="0 0 64 64"
        class="size-20 stroke-muted"
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path
          class="fill-editor"
          d="M10 18A3 3 0 0 1 13 15H24L28 19H51A3 3 0 0 1 54 22V46A3 3 0 0 1 51 49H13A3 3 0 0 1 10 46z"
        />
        <path class="stroke-focus" d="M22 31H42M32 31V40" />
        <circle cx="22" cy="31" r="3.5" class="fill-editor" />
        <circle cx="42" cy="31" r="3.5" class="fill-editor" />
        <circle cx="32" cy="40" r="3.5" class="fill-editor" />
      </svg>
    </div>
  );
}

/** The request each button sends the extension. */
type Start = "git.init" | "git.clone" | "folder.open";

/** A folder with a plus on its front: a new repository here. */
const INITIALIZE_GLYPH = (
  <>
    <path d="M1.75 4.25A1 1 0 0 1 2.75 3.25H6.25L7.75 4.75H13.25A1 1 0 0 1 14.25 5.75V12.25A1 1 0 0 1 13.25 13.25H2.75A1 1 0 0 1 1.75 12.25z" />
    <path d="M8 7.25V11.25M6 9.25H10" />
  </>
);

/** An arrow coming down into an open tray: a repository brought over from elsewhere. */
const CLONE_GLYPH = (
  <>
    <path d="M8 1.75V9.25M5 6.5L8 9.5L11 6.5" />
    <path d="M2.25 9.75V13.25H13.75V9.75" />
  </>
);

/** A folder whose front panel tips open. */
const OPEN_GLYPH = (
  <>
    <path d="M1.75 12.25V4.25A1 1 0 0 1 2.75 3.25H6.25L7.75 4.75H12.25A1 1 0 0 1 13.25 5.75V7" />
    <path d="M1.75 12.75L3.75 7.75H14.75L12.75 12.75z" />
  </>
);

function Glyph({ children }: { children: ComponentChildren }) {
  return (
    <Icon
      class="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {children}
    </Icon>
  );
}

/**
 * Shown when the workspace has no Git repository. Its buttons start VS Code's own "Initialize
 * Repository" and "Clone Repository" flows, or open another folder. The page is replaced once
 * the repository list gains a repository; opening a folder reloads the window instead.
 */
export function NoRepoPage() {
  const l10n = window.l10n;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const actions = useRef<HTMLDivElement>(null);
  // Refs rather than state: a second click can come before the buttons are drawn disabled.
  const pending = useRef(false);
  const mounted = useRef(true);
  const settled = useRef(false);
  /** The button last pressed, which gets the focus back when the buttons are enabled again. */
  const pressed = useRef<Start>("git.init");

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  // The browser drops the focus of a button that becomes disabled. Once the buttons are enabled
  // again the one pressed gets the focus back, unless the focus has gone somewhere else meanwhile.
  useEffect(() => {
    if (busy || !settled.current) {
      return;
    }
    settled.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      actions.current
        ?.querySelector<HTMLButtonElement>(`button[data-start="${pressed.current}"]`)
        ?.focus();
    }
  }, [busy]);

  async function start(method: Start, failed: string) {
    if (pending.current) {
      return;
    }
    pending.current = true;
    pressed.current = method;
    setBusy(true);
    setError(undefined);

    let failure: string | undefined;
    try {
      // Whether the flow created a repository or the user cancelled, the repository list tells.
      await rpcClient.request(method, null);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      failure = fill(failed, message);
    }

    pending.current = false;
    if (mounted.current) {
      settled.current = true;
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <main class="flex min-h-screen items-center justify-center px-6 py-16">
      <section aria-labelledby="no-repo-title" class="w-full max-w-lg text-center">
        <Illustration />
        <h1 id="no-repo-title" class="text-xl font-semibold">
          {l10n.noRepo}
        </h1>
        <div ref={actions} class="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            variant="primary"
            data-start="git.init"
            disabled={busy}
            onClick={() => void start("git.init", l10n.unableToInitializeRepo)}
          >
            <Glyph>{INITIALIZE_GLYPH}</Glyph>
            {l10n.initializeRepo}
          </Button>
          <Button
            data-start="git.clone"
            disabled={busy}
            onClick={() => void start("git.clone", l10n.unableToCloneRepo)}
          >
            <Glyph>{CLONE_GLYPH}</Glyph>
            {l10n.cloneRepo}
          </Button>
          <Button
            data-start="folder.open"
            disabled={busy}
            onClick={() => void start("folder.open", l10n.unableToOpenFolder)}
          >
            <Glyph>{OPEN_GLYPH}</Glyph>
            {l10n.openFolder}
          </Button>
        </div>
        {error !== undefined && (
          <p role="alert" class="mt-5 text-git-deleted">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

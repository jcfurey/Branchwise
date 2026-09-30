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

/**
 * Shown when the workspace has no Git repository. Its button starts VS Code's own "Initialize
 * Repository" flow; the page is replaced once the repository list gains the new repository.
 */
export function NoRepoPage() {
  const l10n = window.l10n;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const actions = useRef<HTMLDivElement>(null);
  // Refs rather than state: a second click can come before the button is drawn disabled.
  const pending = useRef(false);
  const mounted = useRef(true);
  const settled = useRef(false);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  // The browser drops the focus of a button that becomes disabled. Once the button is enabled
  // again it gets the focus back, unless the focus has gone somewhere else in the meantime.
  useEffect(() => {
    if (busy || !settled.current) {
      return;
    }
    settled.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      actions.current?.querySelector("button")?.focus();
    }
  }, [busy]);

  async function initialize() {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(undefined);

    let failure: string | undefined;
    try {
      // Whether it created a repository or the user cancelled, the repository list tells.
      await rpcClient.request("git.init", null);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      failure = fill(window.l10n.unableToInitializeRepo, message);
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
        <div ref={actions} class="mt-6">
          <Button variant="primary" disabled={busy} onClick={() => void initialize()}>
            <Icon
              class="size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M1.75 4.25A1 1 0 0 1 2.75 3.25H6.25L7.75 4.75H13.25A1 1 0 0 1 14.25 5.75V12.25A1 1 0 0 1 13.25 13.25H2.75A1 1 0 0 1 1.75 12.25z" />
              <path d="M8 7.25V11.25M6 9.25H10" />
            </Icon>
            {l10n.initializeRepo}
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

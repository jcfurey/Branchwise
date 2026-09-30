/**
 * Shown in place of the graph while the repository has no commit. It only says what to do: the
 * first commit is made in Source Control, and the graph appears once it exists.
 */
export function NoCommitsPage() {
  const l10n = window.l10n;

  return (
    <main class="flex min-h-96 items-center justify-center px-6 py-16">
      <div class="max-w-md text-center">
        <svg
          viewBox="0 0 48 48"
          class="mx-auto mb-5 size-20 stroke-muted"
          fill="none"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M15 13V27C15 32 18 35 23 35H33M15 24C15 17 33 20 33 13" />
          <circle cx="15" cy="13" r="3.5" class="fill-editor" />
          <circle cx="33" cy="13" r="3.5" class="fill-editor" />
          <circle cx="33" cy="35" r="3.5" class="fill-editor" />
        </svg>
        <h1 class="mb-2 text-xl font-semibold">{l10n.noCommits}</h1>
        <p class="text-muted">{l10n.createFirstCommit}</p>
      </div>
    </main>
  );
}

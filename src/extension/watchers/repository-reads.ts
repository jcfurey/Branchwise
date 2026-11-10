/**
 * The reads a refresh starts over that have not answered yet: the page's branches, its commits
 * and the repository state. While one runs, the watcher holds the next refresh back.
 */
let running = 0;

/**
 * Count a read from now until the function returned is called, which may be called more than
 * once.
 */
export function repositoryReadStarted(): () => void {
  running += 1;
  let ended = false;
  return () => {
    if (!ended) {
      ended = true;
      running -= 1;
    }
  };
}

/** Whether a read of the repository that a refresh would start over is still running. */
export function repositoryReadsRunning(): boolean {
  return running > 0;
}

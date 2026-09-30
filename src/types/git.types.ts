/**
 * A repository the page can show. `path` is its root folder as the extension normalises it
 * (forward slashes, and a lower-case drive letter on Windows); the page selects it by that string,
 * and its saved state is stored under it. `name` is the folder's own name, shown in the picker.
 */
export type GitRepo = { name: string; path: string };

/** Files of the watched repository changed. `path` is that repository's root, as in `GitRepo`. */
export type RepoUpdate = { path: string };

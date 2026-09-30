import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { normalizeRepoPath } from "@/backend/utils/repoPath";

import { git } from "@tests/backend/helpers";

/**
 * A temporary folder, reached by its real path, to lay out repositories, plain folders and links
 * in. Paths are written relative to it with forward slashes.
 */
export function scratchTree(label: string) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `bw-${label}-`)));
  const at = (relative = "") => path.join(root, ...relative.split("/"));
  return {
    root,
    at,
    /** The form repository search reports `relative` in. */
    key: (relative = "") => normalizeRepoPath(at(relative)),
    folder(relative: string) {
      fs.mkdirSync(at(relative), { recursive: true });
    },
    file(relative: string) {
      fs.mkdirSync(path.dirname(at(relative)), { recursive: true });
      fs.writeFileSync(at(relative), "not a folder\n");
    },
    /** A new repository; `seeded` gives it a first commit, which worktrees need. */
    repo(relative: string, seeded = false) {
      fs.mkdirSync(at(relative), { recursive: true });
      git(["init", "-q"], at(relative));
      if (seeded) {
        git(["commit", "-q", "--allow-empty", "-m", "seed"], at(relative));
      }
    },
    /** A directory link; Windows makes junctions without extra privileges. */
    link(relative: string, target: string) {
      fs.mkdirSync(path.dirname(at(relative)), { recursive: true });
      fs.symlinkSync(at(target), at(relative), "junction");
    },
    remove() {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

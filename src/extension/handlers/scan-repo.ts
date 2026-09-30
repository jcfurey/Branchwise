import { basename } from "node:path";

import { extConfig } from "@/extension/config";
import { logger } from "@/extension/util/logger";
import { listRepos } from "@/extension/workspace-scan";
import type { ScanRepoResult } from "@/types";

/**
 * The repositories the page offers in its picker and Workspace pane, named after their folders.
 * `listRepos` decides which they are and when an earlier scan can be reused.
 */
export async function scanRepos(): Promise<ScanRepoResult> {
  const gitPath = extConfig.gitPath();
  const paths = await listRepos(gitPath, extConfig.maxDepthOfRepoSearch());
  logger.info(`Repository scan completed: ${paths.length} found; Git binary: ${gitPath}`);
  return { repos: paths.map((path) => ({ name: basename(path), path })) };
}

import type { SimpleGit } from "simple-git";

import { gitProcessOf } from "@/backend/gitClient";

/** Each Git executable's version as `[major, minor]`, asked once per executable. */
const versions = new Map<string, Promise<[number, number]>>();

async function gitVersion(git: SimpleGit): Promise<[number, number]> {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const pending = versions.get(binary);
  if (pending !== undefined) {
    try {
      return await pending;
    } catch {
      // Another request's check failed, perhaps because that request was cancelled.
    }
  }
  const version = git.raw(["--version"]).then((output): [number, number] => {
    const [major = 0, minor = 0] = (output.match(/(\d+)\.(\d+)/)?.slice(1) ?? []).map(Number);
    return [major, minor];
  });
  versions.set(binary, version);
  // A check that failed is tried again next time.
  version.catch(() => {
    if (versions.get(binary) === version) {
      versions.delete(binary);
    }
  });
  return version;
}

/** Whether the client's Git is at least `major.minor`, for features newer Gits brought. */
export async function gitVersionAtLeast(git: SimpleGit, major: number, minor: number) {
  const [actualMajor, actualMinor] = await gitVersion(git);
  return actualMajor > major || (actualMajor === major && actualMinor >= minor);
}

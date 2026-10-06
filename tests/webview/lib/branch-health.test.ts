import { describe, expect, it } from "vitest";

import type { BranchDetails } from "@/backend/types";
import { branchHealth, orderBranches, STALE_DAYS } from "@/webview/lib/branch-health";

const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

const branch = (name: string, patch: Partial<BranchDetails> = {}): BranchDetails => ({
  name,
  hash: "a".repeat(40),
  upstream: "",
  ahead: 0,
  behind: 0,
  gone: false,
  date: NOW,
  merged: false,
  ...patch
});

describe("branchHealth", () => {
  it("flags a merged branch, except the checked-out one and one still at HEAD's commit", () => {
    expect(branchHealth(branch("done", { merged: true }), "main", null, NOW).merged).toBe(true);
    expect(branchHealth(branch("main", { merged: true }), "main", null, NOW).merged).toBe(false);
    const head = "a".repeat(40);
    expect(branchHealth(branch("new", { merged: true }), "main", head, NOW).merged).toBe(false);
    expect(
      branchHealth(branch("done", { merged: true, hash: "b".repeat(40) }), "main", head, NOW).merged
    ).toBe(true);
  });

  it("counts a branch stale from the stale threshold, in whole days", () => {
    const at = (days: number) =>
      branchHealth(branch("b", { date: NOW - days * DAY - 60 }), "main", null, NOW).staleDays;
    expect(at(STALE_DAYS - 1)).toBeNull();
    expect(at(STALE_DAYS)).toBe(STALE_DAYS);
    expect(at(400)).toBe(400);
    // A branch whose date is unknown is not called stale.
    expect(branchHealth(branch("b", { date: 0 }), "main", null, NOW).staleDays).toBeNull();
  });

  it("calls a branch diverged only when it is both ahead and behind a live upstream", () => {
    const diverged = (patch: Partial<BranchDetails>) =>
      branchHealth(branch("b", { upstream: "origin/b", ...patch }), "main", null, NOW).diverged;
    expect(diverged({ ahead: 1, behind: 1 })).toBe(true);
    expect(diverged({ ahead: 1 })).toBe(false);
    expect(diverged({ behind: 1 })).toBe(false);
    expect(diverged({ ahead: 1, behind: 1, gone: true })).toBe(false);
    expect(branchHealth(branch("b", { ahead: 1, behind: 1 }), "main", null, NOW).diverged).toBe(
      false
    );
  });
});

describe("orderBranches", () => {
  const branches = [
    branch("beta", { date: NOW - 10 }),
    branch("alpha", { date: NOW - 20 }),
    branch("gamma", { date: NOW - 10 }),
    branch("delta", { date: NOW })
  ];
  const names = (list: BranchDetails[]) => list.map((entry) => entry.name);

  it("sorts by name, or by newest commit with names breaking ties", () => {
    expect(names(orderBranches(branches, "name", []))).toEqual(["alpha", "beta", "delta", "gamma"]);
    expect(names(orderBranches(branches, "recent", []))).toEqual([
      "delta",
      "beta",
      "gamma",
      "alpha"
    ]);
  });

  it("puts pinned branches first in the order pinned, and passes over pins of missing branches", () => {
    expect(names(orderBranches(branches, "name", ["gamma", "gone", "alpha"]))).toEqual([
      "gamma",
      "alpha",
      "beta",
      "delta"
    ]);
  });
});

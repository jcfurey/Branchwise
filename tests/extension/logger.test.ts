import { beforeEach, expect, it, vi } from "vitest";

type Level = "error" | "warn" | "info" | "debug";
type Recorder = Record<Level, ReturnType<typeof vi.fn>> & { dispose: ReturnType<typeof vi.fn> };

const output = vi.hoisted(() => {
  const opened: Recorder[] = [];
  const createOutputChannel = vi.fn(() => {
    const channel = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      dispose: vi.fn()
    };
    opened.push(channel);
    return channel;
  });
  return { opened, createOutputChannel };
});
vi.mock("vscode", () => ({ window: { createOutputChannel: output.createOutputChannel } }));

/** The logger keeps its channel for the whole module, so each test loads a new copy. */
async function loadLogger() {
  vi.resetModules();
  return (await import("@/extension/util/logger")).logger;
}

function extensionContext() {
  return { subscriptions: [] as unknown[] } as unknown as import("vscode").ExtensionContext;
}

beforeEach(() => {
  output.opened.length = 0;
  output.createOutputChannel.mockClear();
});

it("creates nothing when it is imported", async () => {
  await loadLogger();
  expect(output.createOutputChannel).not.toHaveBeenCalled();
});

it("drops lines quietly until it is initialised", async () => {
  const logger = await loadLogger();
  expect(() => {
    logger.error("early error");
    logger.warn("early warning");
    logger.info("early info");
    logger.debug("early debug");
  }).not.toThrow();
  expect(output.createOutputChannel).not.toHaveBeenCalled();
});

it("opens one Branchwise log channel that the extension disposes", async () => {
  const logger = await loadLogger();
  const ctx = extensionContext();
  logger.init(ctx);
  expect(output.createOutputChannel).toHaveBeenCalledExactlyOnceWith("Branchwise", { log: true });
  expect(ctx.subscriptions).toEqual([output.opened[0]]);
});

it("passes every line to the channel method of the same level, unchanged", async () => {
  const logger = await loadLogger();
  logger.init(extensionContext());
  const channel = output.opened[0]!;
  const failure = new Error("x");
  const detail = { a: 2 };

  logger.error(failure, 1, detail);
  logger.warn("w", 2);
  logger.info("i");
  logger.debug("d", undefined, null);

  expect(channel.error.mock.calls).toEqual([[failure, 1, detail]]);
  expect(channel.error.mock.calls[0]![0]).toBe(failure);
  expect(channel.warn.mock.calls).toEqual([["w", 2]]);
  expect(channel.info.mock.calls).toEqual([["i"]]);
  expect(channel.debug.mock.calls).toEqual([["d", undefined, null]]);
  expect(channel.debug.mock.calls[0]).toHaveLength(3);
});

it("returns nothing from any method", async () => {
  const logger = await loadLogger();
  expect(logger.init(extensionContext())).toBeUndefined();
  expect(logger.error("e")).toBeUndefined();
  expect(logger.warn("w")).toBeUndefined();
  expect(logger.info("i")).toBeUndefined();
  expect(logger.debug("d")).toBeUndefined();
});

it("writes to the newest channel after a second initialisation", async () => {
  const logger = await loadLogger();
  const first = extensionContext();
  const second = extensionContext();
  logger.init(first);
  logger.init(second);
  logger.info("z");
  const [older, newer] = output.opened;
  expect(newer!.info).toHaveBeenCalledExactlyOnceWith("z");
  expect(older!.info).not.toHaveBeenCalled();
  expect(older!.dispose).not.toHaveBeenCalled();
  expect(first.subscriptions).toEqual([older]);
  expect(second.subscriptions).toEqual([newer]);
});

it("offers exactly the members that callers and their test doubles rely on", async () => {
  const logger = await loadLogger();
  expect(Object.keys(logger)).toEqual(["init", "error", "warn", "info", "debug"]);
});

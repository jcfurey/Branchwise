import { beforeEach, expect, test, vi } from "vitest";

import { copyToClipboard } from "@/extension/handlers/clipboard";

const writeText = vi.hoisted(() => vi.fn());

vi.mock("vscode", () => ({ env: { clipboard: { writeText } } }));

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});

test.each(["hello", ""])("writes %j to the clipboard and reports success", async (text) => {
  await expect(copyToClipboard(text)).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
});

test.each([5, null, undefined, {}, ["text"]])(
  "rejects %j without touching the clipboard",
  async (params) => {
    let pending: Promise<boolean> | undefined;
    expect(() => {
      pending = copyToClipboard(params);
    }).not.toThrow();
    await expect(pending).rejects.toThrow(new Error("Invalid copyToClipboard parameters"));
    expect(writeText).not.toHaveBeenCalled();
  }
);

test("reports failure when the clipboard refuses the text", async () => {
  writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
  await expect(copyToClipboard("x")).resolves.toBe(false);
});

test("reports failure when writing throws at once", async () => {
  writeText.mockImplementationOnce(() => {
    throw new Error("no clipboard");
  });
  await expect(copyToClipboard("x")).resolves.toBe(false);
});

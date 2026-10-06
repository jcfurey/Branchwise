import { beforeEach, expect, test, vi } from "vitest";

import { openUrl } from "@/extension/handlers/open-url";

const vscode = vi.hoisted(() => ({
  openExternal: vi.fn(),
  parse: vi.fn((value: string, strict: boolean) => ({ parsed: value, strict }))
}));

vi.mock("vscode", () => ({
  env: { openExternal: vscode.openExternal },
  Uri: { parse: vscode.parse }
}));

beforeEach(() => {
  vi.clearAllMocks();
  vscode.openExternal.mockResolvedValue(true);
});

test.each([
  "https://github.com/owner/repo/commit/abc",
  "http://gitlab.internal/team/project/-/tree/feature/x"
])("opens %s in the browser", async (url) => {
  await expect(openUrl(url)).resolves.toBe(true);
  expect(vscode.parse).toHaveBeenCalledExactlyOnceWith(url, true);
  expect(vscode.openExternal).toHaveBeenCalledExactlyOnceWith({ parsed: url, strict: true });
});

test("reports a site the user declined to open", async () => {
  vscode.openExternal.mockResolvedValue(false);
  await expect(openUrl("https://github.com/owner/repo")).resolves.toBe(false);
});

test.each([
  null,
  5,
  "",
  "file:///etc/passwd",
  "vscode://settings",
  "command:workbench.action.quit",
  "https://",
  "https:///path",
  "javascript:alert(1)"
])("refuses %j without opening anything", async (params) => {
  await expect(openUrl(params)).rejects.toThrow("Invalid openUrl parameters");
  expect(vscode.openExternal).not.toHaveBeenCalled();
});

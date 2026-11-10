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
  "http://gitlab.internal/team/project/-/tree/feature/x",
  // A branch named `fix/a+b&c`, escaped inside the value: taken apart and put together again,
  // the `+` would read as a space and the `&` would start another parameter.
  "https://gitlab.com/o/r/-/merge_requests/new?merge_request%5Bsource_branch%5D=fix%2Fa%2Bb%26c"
])("opens %s in the browser exactly as written", async (url) => {
  await expect(openUrl(url)).resolves.toBe(true);
  expect(vscode.parse).toHaveBeenCalledExactlyOnceWith(url, true);
  expect(vscode.openExternal).toHaveBeenCalledExactlyOnceWith(url);
});

test("refuses an address VS Code cannot read, without opening anything", async () => {
  vscode.parse.mockImplementationOnce(() => {
    throw new Error("[UriError]: Scheme is missing");
  });
  await expect(openUrl("https://example.com/%")).rejects.toThrow("Scheme is missing");
  expect(vscode.openExternal).not.toHaveBeenCalled();
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

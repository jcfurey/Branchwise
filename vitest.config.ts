import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** Absolute path of a file or folder, relative to this file's folder (the repository root). */
const fromRoot = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/** `@/…` names a module under `src/`, `@tests/…` one under `tests/`, as in `tsconfig.base.json`. */
const aliases = [
  { find: /^@\//, replacement: fromRoot("./src/") },
  { find: /^@tests\//, replacement: fromRoot("./tests/") }
];

/** Points every Git process a test starts at the fixture configuration in `tests/fixtures/`. */
const gitConfig = "tests/git-config.ts";

export default defineConfig({
  test: {
    // Only `pnpm run test:coverage` asks for coverage, which the CI step "Check menu coverage"
    // runs on the `webview` project. The table goes to the terminal; no report files are written.
    coverage: {
      provider: "v8",
      include: ["src/webview/lib/menus.tsx"],
      reporter: ["text", "text-summary"],
      thresholds: {
        "src/webview/lib/menus.tsx": { functions: 80 }
      }
    },
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: "backend",
          include: ["tests/backend/**/*.test.ts"],
          setupFiles: [gitConfig],
          // These tests start real Git processes and build repositories in their hooks, which
          // takes far longer than the 5 s default on Windows runners.
          testTimeout: 30_000,
          hookTimeout: 30_000
        }
      },
      {
        resolve: {
          alias: [
            ...aliases,
            // Product modules that import the VS Code API get the shared stand-in instead.
            { find: /^vscode$/, replacement: fromRoot("./tests/extension/__mocks__/vscode.ts") }
          ]
        },
        test: {
          name: "extension",
          include: ["tests/extension/**/*.test.ts"],
          setupFiles: [gitConfig]
        }
      },
      {
        resolve: { alias: aliases },
        test: {
          name: "webview",
          include: ["tests/webview/**/*.test.ts"],
          setupFiles: ["tests/webview/setup.ts"]
        }
      }
    ]
  }
});

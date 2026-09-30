// Builds everything the extension ships in out/: the extension host bundle, and the webview page's
// script and stylesheet.
//
//   node esbuild.js                development build: readable output with source maps
//   node esbuild.js --production   minified, no source maps
//   node esbuild.js --watch        rebuild whenever an input changes (combines with --production)
//
// esbuild takes the @/ path mapping and the webview's Preact JSX settings from the tsconfig.json
// nearest to each source file. Type errors do not stop the build; `pnpm run typecheck` reports them.
const fs = require("node:fs");
const path = require("node:path");

const tailwindcss = require("@tailwindcss/postcss");
const esbuild = require("esbuild");
const postcss = require("postcss");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** Paths in options and in reports are relative to the repository root, wherever this runs. */
const root = __dirname;

const outputs = {
  extension: "out/extension.js",
  script: "out/web.min.js",
  // esbuild names the CSS that the script imports after the script.
  stylesheet: "out/web.min.css"
};

// Progress is printed in the form of the `$esbuild-watch` problem matcher, which the VS Code tasks
// use: a start line, each problem as a message line followed by an indented `file:line:column:`
// line, then an end line, which also follows a failed build. The matcher ends a build at the first
// end line, and takes the problems printed since the start line as the complete list. So builds
// that overlap form one round with one pair of lines, and in watch mode a change seen by one
// bundle's watcher rebuilds the other bundle too, in the same round.

/** Builds that are running. */
let running = 0;
/** Whether a round has ended. The first round of watch mode builds both bundles anyway. */
let ended = false;
/** Whether an error has been printed, so that a failed build is not reported twice. */
let reported = false;
/** In watch mode, the build context of each bundle. */
const contexts = new Map();
/** Bundles whose next build this script started, not their watcher. */
const requested = new Set();

/** VS Code's column for an esbuild location: esbuild counts bytes from 0, VS Code characters from 1. */
function editorColumn({ column, lineText }) {
  if (!lineText) {
    return column + 1;
  }
  return Buffer.from(lineText).subarray(0, column).toString().length + 1;
}

function print(symbol, severity, { text, location }) {
  console.error(`${symbol} [${severity}] ${text.replaceAll(/\s*\n\s*/g, " ")}`);
  if (location) {
    console.error(`    ${location.file}:${location.line}:${editorColumn(location)}:`);
  }
}

/** Starts a build of every other bundle; their results are reported like any other build's. */
function rebuildOthers(bundle) {
  for (const [other, context] of contexts) {
    if (other !== bundle) {
      requested.add(other);
      context.rebuild().catch(() => undefined);
    }
  }
}

/** Reports the builds of one bundle. */
function reporter(bundle) {
  return {
    name: "reporter",
    setup(build) {
      build.onStart(() => {
        running += 1;
        const fromScript = requested.delete(bundle);
        if (running === 1) {
          console.log("[watch] build started");
          if (ended && !fromScript) {
            rebuildOthers(bundle);
          }
        }
      });
      build.onEnd(({ errors, warnings }) => {
        for (const message of errors) {
          print("✘", "ERROR", message);
        }
        for (const message of warnings) {
          print("▲", "WARNING", message);
        }
        reported ||= errors.length > 0;
        running -= 1;
        if (running === 0) {
          console.log("[watch] build finished");
          ended = true;
        }
      });
    }
  };
}

/**
 * `styles.css` is written in Tailwind's language, which esbuild cannot read, so every stylesheet of
 * the webview is first run through Tailwind's PostCSS plugin. esbuild then bundles and minifies the
 * plain CSS that comes out, resolving what it still references from the stylesheet's own folder.
 * Tailwind's own optimisation stays off in every mode, whatever NODE_ENV says, so the CSS is what
 * tests/webview/styles.test.ts checks, only minified by esbuild for a production build.
 *
 * The rules Tailwind writes depend on the class names in every file it scans, including files that
 * nothing imports, so in watch mode each file it read and each folder it scanned is watched too: a
 * class added anywhere, or a new file or folder, rebuilds the stylesheet.
 */
function tailwind() {
  const plugin = tailwindcss({ optimize: false });
  return {
    name: "tailwind",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async ({ path: file }) => {
        const source = await fs.promises.readFile(file, "utf8");
        try {
          const result = await postcss([plugin]).process(source, { from: file });
          const watchFiles = [file];
          const watchDirs = [];
          for (const message of result.messages) {
            if (message.type === "dependency") {
              watchFiles.push(message.file);
            } else if (message.type === "dir-dependency") {
              watchDirs.push(message.dir);
            }
          }
          return {
            contents: result.css,
            loader: "css",
            resolveDir: path.dirname(file),
            watchFiles,
            watchDirs
          };
        } catch (error) {
          return { errors: [stylesheetError(error, file, source)], watchFiles: [file] };
        }
      });
    }
  };
}

/** An error from Tailwind or PostCSS, placed in the stylesheet at the line they give, if any. */
function stylesheetError(error, file, source) {
  const line = error.line ?? 1;
  const lineText = source.split(/\r?\n/)[line - 1] ?? "";
  const characters = (error.column ?? 1) - 1;
  const text = error.reason ?? error.message ?? String(error);
  return {
    text: error.plugin ? `${error.plugin}: ${text}` : text,
    location: {
      file: path.relative(root, file),
      line,
      column: Buffer.byteLength(lineText.slice(0, characters)),
      lineText
    }
  };
}

const shared = {
  absWorkingDir: root,
  bundle: true,
  minify: production,
  // Development maps sit next to each output and name the sources on disk instead of holding them.
  sourcemap: !production,
  sourcesContent: false,
  // The reporter prints everything.
  logLevel: "silent"
};

/** The extension host bundle, which VS Code loads with require. `vscode` is the host's own. */
const extension = {
  ...shared,
  entryPoints: ["src/main.ts"],
  outfile: outputs.extension,
  platform: "node",
  format: "cjs",
  target: "es2024",
  external: ["vscode"],
  plugins: [reporter("extension")]
};

/** The webview's classic script (the page loads it without a module loader) and its stylesheet. */
const webview = {
  ...shared,
  entryPoints: ["src/webview/main.tsx"],
  outfile: outputs.script,
  platform: "browser",
  format: "iife",
  target: "es2020",
  plugins: [reporter("webview"), tailwind()]
};

async function main() {
  if (production) {
    // out/ is packaged whole, so maps from an earlier development build must not stay behind.
    for (const output of Object.values(outputs)) {
      fs.rmSync(path.join(root, `${output}.map`), { force: true });
    }
  }
  if (watch) {
    // Both bundles build at once, then again whenever an input changes. A failed build keeps
    // watching, and the next change that fixes it builds again.
    const [extensionContext, webviewContext] = await Promise.all([
      esbuild.context(extension),
      esbuild.context(webview)
    ]);
    contexts.set("extension", extensionContext).set("webview", webviewContext);
    await Promise.all([extensionContext.watch(), webviewContext.watch()]);
    return;
  }
  // The extension first; a failure ends the run before the webview is built.
  await esbuild.build(extension);
  await esbuild.build(webview);
}

main().catch((error) => {
  if (!reported) {
    console.error(error);
  }
  process.exitCode = 1;
});

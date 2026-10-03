// Writes THIRD-PARTY-NOTICES.txt: the license of every package whose code ships in the VSIX.
//
//   node scripts/third-party-notices.cjs           write the file
//   node scripts/third-party-notices.cjs --check   fail if the file is out of date
//
// The packages are the ones esbuild bundles into out/extension.js and out/web.min.js, read from
// its metafile, so the list follows the code. Tailwind is added on its own: the stylesheet it
// generates ships in out/web.min.css, though no Tailwind code is bundled. Versions are left out,
// so that a dependency update changes the file only when the license itself changes.
const fs = require("node:fs");
const path = require("node:path");

const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const output = path.join(root, "THIRD-PARTY-NOTICES.txt");

/** Licenses that allow the code to ship in the VSIX with its notice. Anything else stops here. */
const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"]);

/** Packages whose code ships although no import of it is bundled. */
const GENERATED = ["tailwindcss"];

/**
 * License texts for packages that do not include one, each taken from the package's source
 * repository, which its package.json names.
 */
const MISSING_TEXTS = {
  // https://github.com/microsoft/vscode-l10n/blob/main/LICENSE
  "@vscode/l10n": "scripts/third-party-licenses/vscode-l10n.txt"
};

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

/** The folders of the packages esbuild bundles from the two entry points that ship. */
async function bundledPackages() {
  // Stylesheets go through Tailwind in the real build; their imports bundle no package code.
  const noStyles = {
    name: "no-styles",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "css" }));
    }
  };
  const builds = [
    { entryPoints: ["src/main.ts"], platform: "node", format: "cjs", external: ["vscode"] },
    {
      entryPoints: ["src/webview/main.tsx"],
      platform: "browser",
      format: "iife",
      plugins: [noStyles]
    }
  ];
  const folders = new Set();
  for (const options of builds) {
    // Two builds, one after the other.
    // eslint-disable-next-line no-await-in-loop
    const { metafile } = await esbuild.build({
      ...options,
      absWorkingDir: root,
      bundle: true,
      write: false,
      outdir: "out",
      metafile: true,
      logLevel: "silent"
    });
    for (const input of Object.keys(metafile.inputs)) {
      const folder = packageFolder(input);
      if (folder !== null) {
        folders.add(folder);
      }
    }
  }
  for (const name of GENERATED) {
    folders.add(path.relative(root, path.dirname(require.resolve(`${name}/package.json`))));
  }
  return [...folders];
}

/** `node_modules/.pnpm/x@1/node_modules/@scope/name/dist/a.js` gives the folder of `@scope/name`. */
function packageFolder(input) {
  const at = input.lastIndexOf("node_modules/");
  if (at < 0) {
    return null;
  }
  const parts = input.slice(at + "node_modules/".length).split("/");
  const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  return input.slice(0, at) + "node_modules/" + name;
}

/** The repository URL a package.json names, in a form a reader can open. */
function repositoryUrl(manifest) {
  const repository = manifest.repository;
  const url = typeof repository === "string" ? repository : repository?.url;
  if (!url) {
    return manifest.homepage ?? "";
  }
  return (
    url
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/^github:/, "https://github.com/")
      // npm reads a bare "owner/repo" as a GitHub repository.
      .replace(/^([\w.-]+\/[\w.-]+)$/, "https://github.com/$1")
      .replace(/\.git$/, "")
  );
}

/** One package's entry: its name, license and source, and the license text it ships with. */
function entry(folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, folder, "package.json"), "utf8"));
  const license = typeof manifest.license === "string" ? manifest.license : manifest.license?.type;
  if (!ALLOWED.has(license)) {
    throw new Error(
      `${manifest.name} is under ${license ?? "no declared license"}; review it first`
    );
  }
  const file = fs.readdirSync(path.join(root, folder)).find((name) => LICENSE_FILE.test(name));
  const textPath = file === undefined ? MISSING_TEXTS[manifest.name] : path.join(folder, file);
  if (textPath === undefined) {
    throw new Error(`${manifest.name} includes no license text; add one to MISSING_TEXTS`);
  }
  const text = fs.readFileSync(path.join(root, textPath), "utf8").replaceAll("\r\n", "\n").trim();
  return { name: manifest.name, license, source: repositoryUrl(manifest), text };
}

/** The whole file, packages in name order. */
async function notices() {
  const entries = (await bundledPackages())
    .map(entry)
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const rule = "-".repeat(78);
  const header = [
    "Third-party notices for Branchwise",
    "",
    "Branchwise is licensed under the Apache License 2.0; see LICENSE. Its packaged files also",
    "contain code from the packages below, each distributed under its own license, which is",
    "reproduced here. This file is generated by scripts/third-party-notices.cjs."
  ];
  const sections = entries.map((item) =>
    [
      rule,
      `${item.name}`,
      `License: ${item.license}`,
      `Source: ${item.source}`,
      "",
      item.text
    ].join("\n")
  );
  return [...header, "", ...sections, ""].join("\n");
}

async function main() {
  const expected = await notices();
  if (process.argv.includes("--check")) {
    // A Windows checkout may have turned the line endings into CRLF.
    const actual = fs.existsSync(output)
      ? fs.readFileSync(output, "utf8").replaceAll("\r\n", "\n")
      : "";
    if (actual !== expected) {
      process.stderr.write(
        "THIRD-PARTY-NOTICES.txt is out of date. Run `pnpm run notices` and commit the result.\n"
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write("THIRD-PARTY-NOTICES.txt is up to date.\n");
    return;
  }
  fs.writeFileSync(output, expected);
  process.stdout.write(`Wrote ${path.relative(root, output)}.\n`);
}

module.exports = { notices, packageFolder, repositoryUrl };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}

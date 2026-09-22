import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(pkgRoot, "package.json");
const publish = process.argv.includes("--publish");

/* vsce rejects npm-scoped names; rush requires them. Unscope the
   manifest for packaging, then restore it. The .vsix already carries
   the unscoped name, so publish from the file needs no second rewrite. */
const original = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(original);
manifest.name = manifest.name.replace(/^@[^/]+\//, "");
const vsixFile = `${manifest.name}-${manifest.version}.vsix`;

const npx = (args) =>
  execFileSync("npx", ["--yes", ...args], { cwd: pkgRoot, stdio: "inherit" });

try {
  execFileSync("node", [path.join(pkgRoot, "scripts/build-extension.mjs")], {
    cwd: pkgRoot,
    stdio: "inherit",
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  npx([
    "@vscode/vsce",
    "package",
    "--allow-missing-repository",
    "--skip-license",
    "--out",
    vsixFile,
  ]);
} finally {
  await writeFile(manifestPath, original);
}

if (publish) {
  // Marketplace (VS Code) needs `VSCE_PAT`; Open VSX (Cursor, VSCodium,
  // Windsurf, ...) needs `OVSX_PAT`. Both tools read those env vars.
  const missing = ["VSCE_PAT", "OVSX_PAT"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`package-vsix: set ${missing.join(" and ")} to publish`);
    process.exit(1);
  }
  npx(["@vscode/vsce", "publish", "--packagePath", vsixFile]);
  npx(["ovsx", "publish", vsixFile]);
  console.log(`nucleus-quark-highlighter: published ${vsixFile}`);
}

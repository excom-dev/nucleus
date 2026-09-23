import { execFileSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
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
const { version } = manifest;
const extensionId = `${manifest.publisher}.${manifest.name}`;
const vsixFile = `${manifest.name}-${version}.vsix`;

const npx = (args, options = {}) =>
  execFileSync("npx", ["--yes", ...args], {
    cwd: pkgRoot,
    stdio: "inherit",
    ...options,
  });

try {
  execFileSync("node", [path.join(pkgRoot, "scripts/build-extension.mjs")], {
    cwd: pkgRoot,
    stdio: "inherit",
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  npx(["@vscode/vsce", "package", "--out", vsixFile]);
} finally {
  await writeFile(manifestPath, original);
}

if (!publish) process.exit(0);

// Marketplace (VS Code) needs `VSCE_PAT`; Open VSX (Cursor, VSCodium,
// Windsurf, ...) needs `OVSX_PAT`. Both tools read those env vars. Each
// registry is published only when its token is set, so the Marketplace can
// ship without an Open VSX account (Open VSX is off until the owner signs
// the Eclipse publisher agreement; Cursor users install the vsix by hand).
if (!process.env.VSCE_PAT && !process.env.OVSX_PAT) {
  console.error("package-vsix: set VSCE_PAT and/or OVSX_PAT to publish");
  process.exit(1);
}

/* Both registries reject a version they already hold, and the publish
   workflow runs on every push to `main` whether or not this package was
   bumped — so each registry is published only when it lacks this version.
   A lookup failure (extension not yet published, network) counts as absent
   and lets the publish itself report the real error. */
const publishedVersion = (args, pick) => {
  try {
    const json = execFileSync("npx", ["--yes", ...args], {
      cwd: pkgRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return pick(JSON.parse(json)) ?? null;
  } catch {
    return null;
  }
};

const registries = [
  {
    name: "Visual Studio Marketplace",
    token: "VSCE_PAT",
    current: () =>
      publishedVersion(
        ["@vscode/vsce", "show", extensionId, "--json"],
        (data) => data.versions?.[0]?.version,
      ),
    publish: () => npx(["@vscode/vsce", "publish", "--packagePath", vsixFile]),
  },
  {
    name: "Open VSX",
    token: "OVSX_PAT",
    current: () =>
      publishedVersion(
        ["ovsx", "get", extensionId, "--metadata"],
        (data) => data.version,
      ),
    publish: () => npx(["ovsx", "publish", vsixFile]),
  },
];

let published = false;
for (const registry of registries) {
  if (!process.env[registry.token]) {
    console.log(`${registry.name}: skipped (${registry.token} not set)`);
    continue;
  }
  if (registry.current() === version) {
    console.log(`${registry.name}: ${extensionId}@${version} already published`);
    continue;
  }
  registry.publish();
  console.log(`${registry.name}: published ${extensionId}@${version}`);
  published = true;
}

// Lets the workflow attach the vsix to a GitHub release on a real publish.
if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `published=${published}\nversion=${version}\nvsix=${vsixFile}\n`,
  );
}

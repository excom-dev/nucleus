// `node node_modules/@excom/heft-rig/scripts/kit-check.mjs`, from a site
// package, before a deploy build (`--kit=unpkg`): the Nucleus Kit on unpkg at the
// installed version must be the kit built here, file for file (unpkg's `?meta`
// listing carries each file's integrity hash). Prerendered pages hydrate with the
// kit from unpkg: built from other code, they would not match. Checks what a page
// loads (the progressive entry, `progressive/*.js`, the stylesheets) and exits 1
// naming the first file that differs.
import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
// the site plugin's, by path: a dependency on it would be a cycle (it devDepends on the rig)
import { KIT, kitOf } from "../../vite-plugin-nucleus/src/kit.mjs";

/** A `dist` file a page loads. */
const loaded = (path) =>
  path === "nucleus-kit.progressive.min.js" || /^progressive\/[^/]+\.js$/.test(path) || /^[^/]+\.css$/.test(path);

const integrityOf = async (file) => `sha256-${createHash("sha256").update(await readFile(file)).digest("base64")}`;

/**
 * The `?meta` listing, waiting out a version unpkg does not serve yet (404): after a publish it
 * can take minutes, longer than the publish step itself.
 */
async function listingOf(url, fetch, attempts, delay, log) {
  const seconds = Math.round(((attempts - 1) * delay) / 1000);
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (response.status !== 404) throw new Error(`${url} answered ${response.status}`);
    if (attempt >= attempts) {
      throw new Error(`${url} answered 404 for ${seconds} s: unpkg does not serve this version (yet). Deploy again once it does.`);
    }
    if (attempt === 1) log(`unpkg does not serve this version yet: asking again for up to ${seconds} s`);
    await new Promise((done) => setTimeout(done, delay));
  }
}

/**
 * Compares the installed kit's `dist` with the published one; throws naming the
 * first file that differs, resolves with `{ version, files }` when none does.
 * @param {{ root?: string, fetch?: typeof fetch, attempts?: number, delay?: number, log?: (line: string) => void }} [options]
 *   `attempts` × `delay`: how long a version unpkg does not serve yet is waited for (8 minutes)
 */
export async function checkPublishedKit({
  root = process.cwd(),
  fetch = globalThis.fetch,
  attempts = 33,
  delay = 15_000,
  log = console.log,
} = {}) {
  const { dir, version } = await kitOf(root);
  const dist = join(dir, "dist");
  const built = (await readdir(dist, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter(loaded);
  const local = Object.fromEntries(await Promise.all(built.map(async (path) => [path, await integrityOf(join(dist, path))])));
  const meta = `https://unpkg.com/${KIT}@${version}/dist/?meta`;
  const { files } = await listingOf(meta, fetch, attempts, delay, log);
  const published = Object.fromEntries(
    files.map(({ path, integrity }) => [path.replace(/^\/dist\//, ""), integrity]).filter(([path]) => loaded(path))
  );
  const differing = [...new Set([...Object.keys(local), ...Object.keys(published)])]
    .sort()
    .find((path) => local[path] !== published[path]);
  if (differing) {
    const how = !local[differing] ? "is not built here" : !published[differing] ? "is not on unpkg" : "differs";
    throw new Error(
      `The Nucleus Kit changed since ${version} was published: dist/${differing} ${how} (${meta}). Publish a new version before deploying.`
    );
  }
  return { version, files: built.length };
}

async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const [argRealPath, fileRealPath] = await Promise.all([
      realpath(resolve(process.cwd(), process.argv[1])),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return argRealPath === fileRealPath;
  } catch {
    return false;
  }
}

if (await isMain()) {
  try {
    const { version, files } = await checkPublishedKit();
    console.log(`${KIT}@${version} on unpkg is the kit built here (${files} files)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

// should only be run in the CI...
export async function applyExports(packageRoot = process.cwd()) {
  if (packageRoot.replace(/\\/g, "/").endsWith("/packages/heft-rig")) {
    return;
  }
  const pkg = JSON.parse(
    await readFile(path.resolve(packageRoot, "package.json"), "utf8"),
  );
  let exportsMap;
  try {
    exportsMap = JSON.parse(
      await readFile(
        path.resolve(packageRoot, "dist/exports.generated.json"),
        "utf8",
      ),
    );
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  pkg.exports = exportsMap;

  await writeFile(
    path.resolve(packageRoot, "package.json"),
    JSON.stringify(pkg, null, 2),
  );
}


async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const resolvedArg = path.resolve(process.cwd(), process.argv[1]);
    const thisFile = fileURLToPath(import.meta.url);
    const [argRealPath, fileRealPath] = await Promise.all([
      realpath(resolvedArg),
      realpath(thisFile),
    ]);
    return argRealPath === fileRealPath;
  } catch {
    return false;
  }
}

if (await isMain()) {
  await applyExports();
}

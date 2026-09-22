import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * @param {string} packageRoot
 * @returns {Promise<object | null>}
 */
export async function readPackageJson(packageRoot) {
  const pkgPath = resolve(packageRoot, "package.json");
  try {
    await access(pkgPath);
  } catch {
    return null;
  }
  return JSON.parse(await readFile(pkgPath, "utf-8"));
}

/**
 * @param {string} packageRoot
 * @returns {Promise<string | undefined>}
 */
export async function getPackageType(packageRoot) {
  const pkg = await readPackageJson(packageRoot);
  return pkg?.excom?.packageType;
}

/**
 * @param {string} packageRoot
 * @returns {Promise<boolean>}
 */
export async function isSitePackage(packageRoot) {
  return (await getPackageType(packageRoot)) === "site";
}

// Node file access for stage.test.ts (this package's type check has no node types).
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export { join };

// Not new URL("…", import.meta.url): Vite rewrites that pattern under vitest.
export const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const tempDir = () => mkdtemp(join(tmpdir(), "wrenfield-stage-"));
export const removeDir = (dir) => rm(dir, { recursive: true, force: true });
export const read = (...path) => readFile(join(...path), "utf8");
export const write = async (file, text) => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
};
export const entries = async (dir) => (await readdir(dir)).sort();

/** Every file under `dir`, relative and sorted. */
export const tree = async (dir) =>
  (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();

/**
 * Shared temp-dir fixtures for the docs / CEM pipeline script tests.
 * Everything is written under `os.tmpdir()` (realpath'd so symlink
 * checks in `cem-types.mjs` behave like the real `packages/` tree).
 */
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type FileMap = Record<string, string>;

export function makeTempDir(prefix = "heft-rig-docs-"): string {
  return mkdtempSync(path.join(realpathSync(tmpdir()), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Write `{ "relative/path": "content" }` under `root`, creating directories. */
export function writeFiles(root: string, files: FileMap): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
}

/** Symlink `<pkgRoot>/node_modules/<name>` → `target` (like pnpm workspace links). */
export function linkNodeModule(pkgRoot: string, name: string, target: string): void {
  const link = path.join(pkgRoot, "node_modules", name);
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(target, link, "dir");
}

export function packageJson(name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      name,
      version: "1.2.3",
      description: `${name} description`,
      type: "module",
      ...extra,
    },
    null,
    2,
  );
}

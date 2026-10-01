// Stages the public files into dist/ for `wrangler deploy`: only this list
// ships, and the Kit CDN URLs pin to the Kit version in this workspace.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
// The linked icons live in img/; sw.js imports backend/.
const PUBLIC = [
  "index.html",
  "sw.js",
  "shell.css",
  "shell.quark",
  "manifest.webmanifest",
  "_headers",
  "backend",
  "views",
  "img",
  "models",
  "data",
];
const BARE_KIT_IMPORT = /"@excom\/nucleus-kit\/([^"]+)"/g;
const REWRITTEN_FILES = ["index.html", "shell.css"];

export const stage = async ({
  root = ROOT,
  out = join(root, "dist"),
  kitVersion,
} = {}) => {
  const version =
    kitVersion ??
    JSON.parse(
      await readFile(join(root, "../nucleus-kit/package.json"), "utf8")
    ).version;
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await Promise.all(
    PUBLIC.map((name) =>
      cp(join(root, name), join(out, name), { recursive: true })
    )
  );
  const cdnBase = `https://unpkg.com/@excom/nucleus-kit@${version}/dist`;
  let rewrites = 0;
  for (const file of REWRITTEN_FILES) {
    const filePath = join(out, file);
    const content = await readFile(filePath, "utf8");
    const matches = content.match(BARE_KIT_IMPORT);
    if (matches) {
      rewrites += matches.length;
      await writeFile(
        filePath,
        content.replaceAll(BARE_KIT_IMPORT, (_, path) => {
          const cdnPath = /\.css$/.test(path) ? path : `${path}.min.js`;
          return `"${cdnBase}/${cdnPath}"`;
        })
      );
    }
  }
  if (rewrites === 0)
    throw new Error("No bare @excom/nucleus-kit imports found to rewrite");
  return version;
};

if (import.meta.main)
  console.log(`Staged dist/ with nucleus-kit@${await stage()}`);

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
const KIT_URL = /(unpkg\.com\/@excom\/nucleus-kit@)[^/]+/g;

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
  const page = join(out, "index.html");
  const html = await readFile(page, "utf8");
  if (html.search(KIT_URL) < 0)
    throw new Error("index.html has no unpkg Kit URL to pin");
  await writeFile(page, html.replaceAll(KIT_URL, `$1${version}`));
  return version;
};

if (import.meta.main)
  console.log(`Staged dist/ with nucleus-kit@${await stage()}`);

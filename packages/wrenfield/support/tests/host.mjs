// The host (Workers static assets, as @excom/vite-plugin-nucleus emulates it) serving a build of `files` ({ path: text }), with the
// app's wrangler.jsonc, from a temporary directory.
import { answerOf } from "@excom/vite-plugin-nucleus/host";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** What the host answers for each of `urls`: `[status, file]`, the file relative to the build. */
export const hostAnswers = async (files, urls) => {
  const site = mkdtempSync(join(tmpdir(), "wrenfield-host-"));
  const dist = join(site, "dist");
  try {
    writeFileSync(join(site, "wrangler.jsonc"), readFileSync(join(PACKAGE, "wrangler.jsonc")));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dist, path)), { recursive: true });
      writeFileSync(join(dist, path), text);
    }
    return await Promise.all(
      urls.map(async (url) => {
        const { status, file } = await answerOf(dist, { url });
        return [status, file?.slice(dist.length + 1)];
      }),
    );
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
};

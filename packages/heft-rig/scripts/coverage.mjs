import { fileURLToPath } from "node:url";
import path from "node:path";
import { realpath } from "node:fs/promises";
import vitestConfig, { runVitest } from "./vitest.mjs";

export default vitestConfig;

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
  await runVitest({ extraArgs: ["--coverage"], argv: process.argv.slice(2) });
}


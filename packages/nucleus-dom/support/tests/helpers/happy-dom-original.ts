import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The prototype of happy-dom's class in `file` (under `lib/`), from a second
 * copy of its module: no shim has patched it, so its methods are happy-dom's
 * own, to run on any node of a shimmed window.
 */
export const originalPrototype = async <T>(file: string): Promise<T> => {
  const lib = dirname(createRequire(import.meta.url).resolve("happy-dom"));
  const url = pathToFileURL(join(lib, file)).href;
  return (await import(/* @vite-ignore */ `${url}?original`)).default.prototype;
};

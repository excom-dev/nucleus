import { builtin } from "./node";

/** Reads `relPath` (UTF-8) relative to a module: `readFileRelative(import.meta.url, "./cart.html")`. */
export const readFileRelative = (
  importMetaUrl: string,
  relPath: string
): string =>
  builtin("node:fs").readFileSync(new URL(relPath, importMetaUrl), "utf8");

/** Reads the demo `support/demos/<name>.html` from a test in `support/tests`. */
export const readDemo = (importMetaUrl: string, name: string): string =>
  readFileRelative(importMetaUrl, `../demos/${name}.html`);

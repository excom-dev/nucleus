import type { CSSOptions } from "vite";

/** Vite `css` option of a Nucleus Stack site: the PostCSS chain `nucleus()` sets. */
export const cssConfig: CSSOptions;

/** Runs the PostCSS chain of `cssConfig` on a stylesheet `css` read from the file `from`. */
export function transformCss(css: string, from: string): Promise<string>;

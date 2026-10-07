// The CSS config of a Nucleus Stack site is `@excom/vite-plugin-nucleus/css`,
// taken by path (a dependency would be a cycle: the plugin devDepends on the
// rig). Library builds and WXT (`nucleus-devtools`) import it from here.
import { transformCss } from "../../vite-plugin-nucleus/css.mjs";

export { cssConfig, transformCss } from "../../vite-plugin-nucleus/css.mjs";

/**
 * Vite plugin that runs {@link transformCss} before Vite's own CSS
 * pipeline, so `@import` is inlined and mixins expand in one pass.
 *
 * @returns {import("vite").Plugin}
 */
export function heftRigCssPlugin() {
  return {
    name: "heft-rig-css",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".css")) return null;
      return { code: await transformCss(code, file), map: null };
    },
  };
}

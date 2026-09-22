import postcss from "postcss";
import postcssPresetEnv from "postcss-preset-env";
import atImport from "postcss-import";
import postcssCustomSelectors from "postcss-custom-selectors";
import postcssCustomSelectorsAtRuleParams from "./postcss-custom-selectors-atrule-params.mjs";
import importExtGlob from "postcss-import-ext-glob";
import postcssMixins from "postcss-mixins";

/**
 * Shared Vite `css` option (PostCSS chain) for every consumer — package
 * Vite builds, docs-site, and WXT (`nucleus-devtools`). Keep this
 * the single list; do not fork plugins per bundler.
 *
 * @type {import("vite").CSSOptions}
 */
export const cssConfig = {
  postcss: {
    plugins: [
      /*
       * `postcss-import-ext-glob` turns `@import-glob "pattern"` into
       * `@import "/abs/path"` for `postcss-import`. Registered twice:
       *
       *   1. Top of the chain — globs in the entry expand BEFORE Vite's
       *      auto-injected `postcss-import`.
       *   2. Nested inside our `postcss-import` — transitive
       *      `@import-glob`s (e.g. `valence/src/components.css`) still
       *      expand on the recursive pass.
       *
       * NOTE: `vite dev` unshifts its own `postcss-import` to position 0
       * whenever the entry has `@import`. That instance has no glob
       * support, so `@import-glob` in files Vite pre-resolves (bare
       * `@import "@scope/pkg/..."`) is dropped. For `dev` and `build`
       * portability, transitively imported CSS must list imports
       * explicitly — no `@import-glob`. Globs are fine in the package
       * being built (Vite's atImport does not run first).
       */
      importExtGlob(),
      atImport({
        plugins: [importExtGlob()],
      }),
      postcssMixins,
      /*
       * `postcss-custom-selectors` expands `@custom-selector :--name a, b, c;`
       * and substitutes `:--name` / `:--name:hover`. Semantic tag aliases
       * (`:--article` → `article, [role="article"], .tag-article`) without
       * nested `@mixin` ladders.
       *
       * After `postcss-mixins` so mixin-emitted `:--name` still expands.
       * Nested rules stay native CSS Nesting (browsers `:is()` selector-list
       * parents); no `postcss-nesting`.
       *
       * Upstream only rewrites `Rule.selector`, so `@scope (:--dialog) to (...)`
       * would ship unexpanded. Companion plugin expands `:--*` in `@scope` /
       * `@container` params first (while `@custom-selector` defs exist); stock
       * plugin then handles rules and drops defs (`preserve: false`).
       */
      postcssCustomSelectorsAtRuleParams(),
      postcssCustomSelectors(),
      // Don't let preset-env flatten nesting; ship nested CSS as authored.
      postcssPresetEnv({
        stage: 3,
        features: {
          "nesting-rules": false,
        },
        warnForUnsupportedFeatures: false, // Suppress warnings
      }),
    ],
  },
};

/**
 * Run {@link cssConfig} on a CSS source. Use this when the host bundler
 * (WXT) does not reliably apply `css.postcss`.
 *
 * @param {string} css
 * @param {string} from
 * @returns {Promise<string>}
 */
export async function transformCss(css, from) {
  const result = await postcss(cssConfig.postcss.plugins).process(css, {
    from,
  });
  return result.css;
}

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

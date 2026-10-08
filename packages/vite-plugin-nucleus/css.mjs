import postcssCustomSelectorsAtRuleParams from "./src/postcss-custom-selectors-atrule-params.mjs";
import { Features } from "lightningcss";
import postcss from "postcss";
import postcssCustomSelectors from "postcss-custom-selectors";
import atImport from "postcss-import";
import importExtGlob from "postcss-import-ext-glob";
import postcssMixins from "postcss-mixins";
import postcssPresetEnv from "postcss-preset-env";

/**
 * Vite `css` option of a Nucleus Stack site. The PostCSS chain: `@import` and
 * `@import-glob` inlined, mixins, custom selectors, preset-env stage 3, nesting
 * shipped as authored. The minifier: `light-dark()` shipped as authored.
 * `nucleus()` sets it; another Vite config (a library build, a browser
 * extension) can set it too.
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
       *   2. Nested inside our `postcss-import` — `@import-glob`s in
       *      imported files still expand on the recursive pass.
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
  /*
   * Vite's CSS minifier would lower `light-dark(a, b)` to
   * `var(--lightningcss-light, a) var(--lightningcss-dark, b)`, and define
   * those two variables only in a stylesheet that declares `color-scheme`
   * itself. An app's sheet does not: Valence declares it, compiled on its own
   * (and loaded on its own in a `kit: "unpkg"` build). Both fallbacks would
   * then apply at once and every colour set with `light-dark()` be invalid.
   * So it ships as written: Chrome 123, Firefox 120, Safari 17.5.
   */
  lightningcss: {
    exclude: Features.LightDark,
  },
};

/**
 * Run {@link cssConfig} on a CSS source: for a bundler that does not apply
 * Vite's `css.postcss` to every stylesheet (a Vite plugin's `transform`).
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

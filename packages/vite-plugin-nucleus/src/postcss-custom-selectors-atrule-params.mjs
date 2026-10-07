/**
 * Companion to `postcss-custom-selectors`.
 *
 * Upstream only rewrites `Rule.selector`, it never touches at-rule params.
 * That leaves `@scope (:--dialog) to (:not(.contents, :--article))` unexpanded.
 *
 * This plugin runs *before* `postcss-custom-selectors`, reads the still-present
 * `@custom-selector` definitions, and expands `:--*` references inside `@scope`
 * (and `@container`) params using the same `:is(...)` wrapping convention.
 */

const CUSTOM_SELECTOR_RE = /^(:--[\w-]+)\s+([\s\S]+)$/;
const CUSTOM_PSEUDO_RE = /:--[\w-]+/g;
const ATRULES_WITH_SELECTOR_PARAMS = new Set(["scope", "container"]);

/**
 * @returns {import("postcss").Plugin}
 */
export default function postcssCustomSelectorsAtRuleParams() {
  return {
    postcssPlugin: "postcss-custom-selectors-atrule-params",
    prepare() {
      /** @type {Map<string, string>} */
      const customSelectors = new Map();

      return {
        postcssPlugin: "postcss-custom-selectors-atrule-params",

        Once(root) {
          root.walkAtRules("custom-selector", (atRule) => {
            const match = CUSTOM_SELECTOR_RE.exec(atRule.params.trim());
            if (!match) return;
            customSelectors.set(match[1], match[2].trim());
          });
        },

        AtRule(atRule) {
          if (!ATRULES_WITH_SELECTOR_PARAMS.has(atRule.name.toLowerCase())) {
            return;
          }
          if (!atRule.params?.includes(":--")) return;
          if (customSelectors.size === 0) return;

          const next = expandCustomSelectorsInParams(
            atRule.params,
            customSelectors,
          );
          if (next !== atRule.params) {
            atRule.params = next;
          }
        },
      };
    },
  };
}

postcssCustomSelectorsAtRuleParams.postcss = true;

/**
 * Expand `:--*` tokens inside top-level `(...)` groups of an at-rule prelude.
 *
 * @param {string} params
 * @param {Map<string, string>} customSelectors
 */
function expandCustomSelectorsInParams(params, customSelectors) {
  let out = "";
  let i = 0;

  while (i < params.length) {
    if (params[i] === "(") {
      let depth = 1;
      let j = i + 1;
      while (j < params.length && depth > 0) {
        if (params[j] === "(") depth++;
        else if (params[j] === ")") depth--;
        j++;
      }
      const inner = params.slice(i + 1, j - 1);
      if (inner.includes(":--")) {
        out += `(${expandCustomPseudos(inner, customSelectors)})`;
      } else {
        out += params.slice(i, j);
      }
      i = j;
      continue;
    }

    out += params[i];
    i++;
  }

  return out;
}

/**
 * @param {string} selector
 * @param {Map<string, string>} customSelectors
 */
function expandCustomPseudos(selector, customSelectors) {
  return selector.replace(CUSTOM_PSEUDO_RE, (token) => {
    const replacement = customSelectors.get(token);
    return replacement ? `:is(${replacement})` : token;
  });
}

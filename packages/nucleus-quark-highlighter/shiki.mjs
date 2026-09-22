/**
 * Shiki `LanguageRegistration` wrappers for the TextMate grammars here.
 * Pass to `createHighlighter({ langs: [...shikiLangs] })`.
 */
// Keep each grammar import on one line with no trailing comma inside the
// attribute clause: es-module-lexer (used by Vite dev) does not recognise
// `with { type: "json", }` as import attributes, so Vite leaves the clause
// in place while serving the JSON as a JS module, and the browser then
// rejects the mismatched MIME type (breaking every `@use "/shell"` sheet).
// prettier-ignore
import quarkGrammar from "./syntaxes/quark.tmLanguage.json" with { type: "json" };
// prettier-ignore
import htmlCustomElementsGrammar from "./syntaxes/html-custom-elements.tmLanguage.json" with { type: "json" };

/** Standalone Quark (`.quark` / `quark` fences). */
export const quark = {
  ...quarkGrammar,
  name: "quark",
  displayName: "Quark",
  embeddedLangs: ["css"],
};

/**
 * Injection for Nucleus-style HTML: kebab custom elements / attrs, plus
 * Quark inside `<quark-sheet>`. Applied when `html` / `html-derivative`
 * is highlighted.
 */
export const htmlCustomElements = {
  ...htmlCustomElementsGrammar,
  name: "html-custom-elements",
  injectTo: ["text.html.basic", "text.html.derivative"],
  embeddedLangs: ["quark"],
};

export const shikiLangs = [quark, htmlCustomElements];

/**
 * Markdown → HTML for `package-meta.json`.
 *
 * Full README bodies use `renderMarkdown` (fenced blocks become inert
 * `<include-content data-language>` wrappers; headings get stable `md-*`
 * ids; relative links become `<spa-a>` so the SPA navigates without a
 * reload). CEM / JSDoc description strings use `renderMarkdownInline` so
 * backticks, emphasis, etc. become HTML without wrapping `<p>` tags.
 */
import { marked } from "marked";

const escapeHtml = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s = "") => escapeHtml(s).replace(/"/g, "&quot;");

/**
 * A link the SPA router can serve: a path or a relative reference, not a
 * `scheme:` / `//host` URL and not a same-page `#hash`.
 *
 * @param {string} [href]
 */
export function isRelativeLink(href) {
  return !!href && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href);
}

marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const slug = text
        .replace(/<[^>]+>/g, "")
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .replace(/^-|-$/g, "");
      return `<h${depth} id="md-${slug}">${text}</h${depth}>\n`;
    },
    /* Relative links → `<spa-a route-href>` (`role="link"` keeps the
       Valence.css link styling); external and `#hash` links stay `<a>`. */
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return isRelativeLink(href)
        ? `<spa-a route-href="${escapeAttr(href)}" role="link"${titleAttr}>${text}</spa-a>`
        : `<a href="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
    },
    code({ text, lang }) {
      const language = (lang ?? "").split(/\s+/)[0] ?? "";
      return `<include-content data-language="${escapeHtml(language)}"><template>${escapeHtml(text)}</template></include-content>\n`;
    },
  },
});

export function renderMarkdown(md) {
  return md ? marked.parse(md, { async: false }) : "";
}

/** Inline markdown (e.g. `` `code` `` → `<code>code</code>`) for CEM fields. */
export function renderMarkdownInline(md) {
  return md ? marked.parseInline(md, { async: false }) : "";
}

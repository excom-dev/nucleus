/**
 * The code highlighter (Shiki), for the sheets that paint code:
 * `@use "/highlight.js" as *;`, with the extension, the URL `/shell` loads it
 * from too (`loadHighlight`): one instance. Created at module load, so only
 * those sheets wait for it. Imports nothing from `/shell`: a build would
 * load that module a second time, from its `.js` URL.
 */
import {
  htmlCustomElements,
  quark,
} from "@excom/nucleus-quark-highlighter/shiki";
import { html } from "js-beautify";
import { createHighlighter } from "shiki";

/** Dual themes for prefers-color-scheme (dark bg overridden in CSS). */
const SHIKI_THEMES = {
  light: "light-plus",
  dark: "dark-plus",
} as const;

const highlighter = await createHighlighter({
  themes: [SHIKI_THEMES.light, SHIKI_THEMES.dark],
  langs: [
    "html",
    "javascript",
    "typescript",
    "css",
    "scss",
    "bash",
    "text",
    "md",
    "json",
    quark,
    htmlCustomElements,
  ],
});

if (import.meta.hot) {
  /* Oniguruma WASM is never GC'd: extra `createHighlighter()` calls
   * (and HMR without `dispose`) pin heaps until a full reload. */
  import.meta.hot.dispose(() => {
    highlighter.dispose();
  });
}

/** Short keys used in Quark / markdown → Shiki language ids. */
const SHIKI_LANG: Record<string, string> = {
  html: "html",
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  scss: "scss",
  css: "css",
  bash: "bash",
  txt: "text",
  text: "text",
  quark: "quark",
  md: "md",
  json: "json",
};

/*
 * Empty `.line` spans collapse in the overlay (trailing newlines vanish,
 * the textarea caret drifts). A ZWSP keeps the line box. CR / CRLF are
 * normalized so Windows endings still split.
 */
const preserveEmptyLines = {
  line(node: { children: Array<{ type: string; value?: string }> }) {
    if (node.children.length === 0) {
      node.children.push({ type: "text", value: "​" });
    }
  },
};

export const renderLang = (
  val: string,
  lang: string,
  { includeCopyButton = false }: { includeCopyButton?: boolean } = {}
) => {
  if (!val) return "";
  const shikiLang = SHIKI_LANG[lang] ?? lang;
  let html = highlighter.codeToHtml(val.replace(/\r\n?/g, "\n"), {
    lang: shikiLang,
    themes: SHIKI_THEMES,
    defaultColor: false,
    transformers: [preserveEmptyLines],
  });
  if (includeCopyButton) {
    html += `<div bind-copy-button></div>`;
  }
  return html;
};
export const renderLangCopy = (val: string, lang: string) =>
  renderLang(val, lang, { includeCopyButton: true });

const textOf = (html: string) =>
  Object.assign(document.createElement("template"), { innerHTML: html }).content
    .textContent;

/* `/shell` exports the same: see the note on imports above */
const unescapeHtml = (s?: string): string =>
  s ? s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "";

/**
 * Re-renders the `[data-highlight]` overlay next to the event target. The
 * language comes from the closest `[data-language]` (default `html`).
 */
export const _renderPre =
  ({ shouldFormat }: { shouldFormat: boolean }) =>
  (e) => {
    const target = e.detail?.target || e.target;
    const value = unescapeHtml(target.value ?? target.innerHTML);
    const lang =
      e.target.closest("[data-language]")?.getAttribute("data-language") ||
      "html";
    const overlay = e.target.parentElement.querySelector("[data-highlight]");
    const html = renderLang(shouldFormat ? formatCode(value) : value, lang);
    // the same code shows already (a prerendered page): keep its nodes
    if (overlay.textContent !== textOf(html)) overlay.innerHTML = html;
  };

export const renderPreFormatted = _renderPre({ shouldFormat: true });

export const renderPre = _renderPre({ shouldFormat: false });

export function formatCode(s: string): string {
  const formatted = html(s.replace(/\n+$/, ""), {
    wrap_line_length: 80,
    /* Override the default `["pre", "textarea"]`: keep Quark source
     * as authored instead of letting js-beautify rewrite it. */
    content_unformatted: ["pre", "textarea", "quark-sheet"],
  });
  return reindentQuarkSheets(formatted);
}

/**
 * `content_unformatted` preserves sheet contents byte-for-byte, but
 * js-beautify re-bases the tags themselves, leaving the Quark stranded at
 * its original indentation. Shift each sheet's lines so the content sits
 * one level past the (re-indented) open tag and the closing tag aligns
 * with it. Relative indentation within the sheet is untouched.
 */
function reindentQuarkSheets(htmlText: string): string {
  return htmlText.replace(
    /^([ \t]*)(<quark-sheet\b[^>]*>)([\s\S]*?)(<\/quark-sheet>)/gm,
    (full, base, openTag, inner, closeTag) => {
      if (!inner.trim() || !/^[ \t]*\n/.test(inner)) return full;
      const lines: string[] = inner.replace(/^[ \t]*\n/, "").split("\n");
      const indents = lines
        .filter((line) => line.trim())
        .map((line) => /^[ \t]*/.exec(line)![0].length);
      const strip = Math.min(...indents);
      const body = lines
        .map((line) => (line.trim() ? base + "    " + line.slice(strip) : ""))
        .join("\n")
        .replace(/\n+$/, "");
      return `${base}${openTag}\n${body}\n${base}${closeTag}`;
    }
  );
}

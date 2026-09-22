#!/usr/bin/env node
/**
 * Docs-site search corpus from built package metas.
 *
 * Output (`public/package-metas/search-docs.json`, minified):
 *
 *   { "version": 1, "docs": [{ kind, package, tag?, title?, text? }] }
 *
 *   kind    - package | element | attribute | event | slot | css-property |
 *             css-class | css-alias | listen | command | default-action | expected-child |
 *             doc (repo architecture; client route `/nucleus/docs/<package>`) |
 *             page (a package doc page; route `/nucleus/packages/<package>/<doc>`)
 *   package - shortName (or site-doc key for `kind: "doc"`);
 *             package routes `/nucleus/packages/<package>`, site docs
 *             `/nucleus/docs/<package>` (`introduction` is `/nucleus` itself).
 *             The corpus stores keys, not hrefs; the site builds the route.
 *   tag     - element tag; omitted if absent or same as `package`
 *             (package-root docs have no tag). Member anchors:
 *             `<tag|--package>--<kind>--<title>`
 *   doc     - `kind: "page"` only: the page key (`support/docs/<DOC>.md`)
 *   title   - searchable name; omitted if same as `package`
 *   text    - stopword-stripped, capped (package 640, members 160).
 *             Omitted when empty.
 *
 * Package `text` = H1 intro + Features + example titles, not the full
 * README. Drop `<include-content>` islands before stripping HTML; keep
 * in-prose markup (`<code>`, etc.) as text.
 *
 * Same-named `element` docs (`title === package`) omitted; summary folds
 * into the package blurb. Element css-aliases with no description omitted
 * (`:--data-table` already covered by title). State aliases stay.
 *
 * Index `title` and `text` only; rest is store metadata. No ids — consumer
 * assigns array indexes.
 *
 * Left out (size): demos, inherited members, defaults/selectors,
 * `typeExpanded`, other package-meta fields. Member `type`, CSS `syntax`,
 * and CSS `default` *are* indexed.
 */

export const MEMBER_TEXT_MAX = 160;
export const PACKAGE_TEXT_MAX = 640;

const MEMBER_KINDS = {
  attributes: "attribute",
  events: "event",
  slots: "slot",
  cssProperties: "css-property",
  cssClasses: "css-class",
  cssAliases: "css-alias",
  listens: "listen",
  commands: "command",
  defaultActions: "default-action",
  expectedChildren: "expected-child",
  provisions: "provision",
};

/**
 * @param {Array<object>} metas - parsed `support/package-meta.json` contents
 * @returns {{ version: number, docs: Array<object> }}
 */
export function buildSearchDocs(metas) {
  const docs = [];
  for (const meta of metas) {
    if (meta.package?.excom?.packageType === "site") {
      for (const [name, html] of Object.entries(meta.docs ?? {})) {
        const title = titleFromDocHtml(html) || titleCaseKey(name);
        docs.push(
          doc({
            kind: "doc",
            pkg: name,
            title,
            textParts: [stripHtml(html)],
            textMax: PACKAGE_TEXT_MAX,
          }),
        );
      }
      continue;
    }

    const pkg = meta.shortName;
    const foldedSummaries = [];

    for (const api of meta.elementApis ?? []) {
      const title = api.tag ?? pkg;
      if (title === pkg) {
        const summary = stripHtml(api.summary);
        if (summary) foldedSummaries.push(summary);
        continue;
      }
      docs.push(
        doc({
          kind: "element",
          pkg,
          tag: api.tag,
          title,
          textParts: [stripHtml(api.summary)],
          textMax: MEMBER_TEXT_MAX,
        }),
      );
    }

    docs.push(
      doc({
        kind: "package",
        pkg,
        title: pkg,
        textParts: [
          packageReadmeText(meta.readme) || meta.package?.description,
          ...foldedSummaries,
        ],
        textMax: PACKAGE_TEXT_MAX,
      }),
    );

    // Doc pages beyond the README (`support/docs/<DOC>.md`), full text.
    for (const [name, html] of Object.entries(meta.docs ?? {})) {
      if (name === "readme") continue;
      docs.push({
        ...doc({
          kind: "page",
          pkg,
          title: titleFromDocHtml(html) || titleCaseKey(name),
          textParts: [stripHtml(html)],
          textMax: PACKAGE_TEXT_MAX,
        }),
        doc: name,
      });
    }

    for (const api of meta.elementApis ?? []) {
      for (const [collection, kind] of Object.entries(MEMBER_KINDS)) {
        for (const member of api[collection] ?? []) {
          if (member.inheritedFrom) continue;
          if (
            kind === "css-alias" &&
            member.kind === "element" &&
            !member.description
          ) {
            continue;
          }
          docs.push(
            doc({
              kind,
              pkg,
              tag: api.tag,
              title: member.name,
              textParts: [
                stripHtml(member.description),
                member.syntax,
                member.default,
                member.type,
              ],
              textMax: MEMBER_TEXT_MAX,
            }),
          );
        }
      }
    }
  }
  return { version: 1, docs };
}

function doc({ kind, pkg, tag, title, textParts, textMax }) {
  const text = capText(
    stripStopwords(textParts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim()),
    textMax,
  );
  return {
    kind,
    package: pkg,
    ...(tag !== undefined && tag !== pkg ? { tag } : {}),
    ...(title !== pkg ? { title } : {}),
    ...(text ? { text } : {}),
  };
}

/**
 * Package README HTML → intro + Features + example titles.
 * Drops `<include-content>` islands (demos / install / API embeds).
 * @param {string} [html]
 * @returns {string}
 */
export function packageReadmeText(html) {
  if (!html) return "";
  const cleaned = html
    .replace(/<include-content\b[\s\S]*?<\/include-content>/gi, " ")
    .replace(/<include-content\b[^>]*\/?>/gi, " ");

  const intro = cleaned.match(
    /<h1\b[^>]*>[\s\S]*?<\/h1>([\s\S]*?)(?=<h[1-6]\b|$)/i,
  );
  const features = cleaned.match(
    /<h2\b[^>]*>\s*Features\s*<\/h2>([\s\S]*?)(?=<h[12]\b|$)/i,
  );
  const examplesBlock = cleaned.match(
    /<h[23]\b[^>]*>\s*Examples\s*<\/h[23]>([\s\S]*?)(?=<h[12]\b|$)/i,
  );
  const exampleTitles = [
    ...(examplesBlock?.[1] ?? "").matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi),
  ].map((m) => stripHtml(m[1]));

  return [
    intro ? stripHtml(intro[1]) : "",
    features ? `Features ${stripHtml(features[1])}` : "",
    exampleTitles.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

/** Rendered-markdown HTML → whitespace-collapsed plain text. */
export function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "with",
  "from",
  "by",
  "it",
  "its",
  "into",
  "over",
  "than",
  "then",
  "so",
  "if",
]);

/** Drop common filler words. Tokens that are only a stopword are removed. */
export function stripStopwords(text) {
  if (!text) return "";
  return text
    .split(/\s+/)
    .filter((word) => {
      const bare = word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
      return bare.length > 0 && !STOPWORDS.has(bare);
    })
    .join(" ");
}

/** First `<h1>` text from rendered markdown HTML, or `""`. */
export function titleFromDocHtml(html) {
  if (!html) return "";
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripHtml(m[1]) : "";
}

/** `quick_start` → `Quick Start`. */
export function titleCaseKey(key) {
  return String(key ?? "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function capText(text, max) {
  if (!text || text.length <= max) return text ?? "";
  const sliced = text.slice(0, max);
  const bound = sliced.lastIndexOf(" ");
  return (bound > max * 0.6 ? sliced.slice(0, bound) : sliced).trim();
}

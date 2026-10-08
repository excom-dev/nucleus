import MiniSearch from "minisearch";

/**
 * Loads each workspace package's prebuilt `support/package-meta.json`
 * (emitted by `rush build:package-metas`). The docs site does not assemble
 * CEMs, demos, or install metadata at runtime, it just indexes those files
 * and exposes thin getters for Quark. `readme` is already HTML.
 */

export type ElementApi = {
  tag?: string;
  summary?: string;
  kind: "class" | "mixin";
  attributes: Record<string, unknown>[];
  events: Record<string, unknown>[];
  slots: Record<string, unknown>[];
  cssProperties: Record<string, unknown>[];
  cssClasses: Record<string, unknown>[];
  cssAliases: Record<string, unknown>[];
  listens: Record<string, unknown>[];
  defaultActions: Record<string, unknown>[];
  expectedChildren: Record<string, unknown>[];
  provisions: Record<string, unknown>[];
};

export type Installation = {
  name: string;
  shortName: string;
  version: string;
  description?: string;
  packageType?: string;
  install: { npm: string };
  imports: { js: string; css?: string; html?: string };
  cdn?: string;
  peerDependencies: { name: string; version: string }[];
};

/** One doc page as listed in a package's `support/docs-sections.json`. */
export type DocPageEntry = { name: string; title: string };

/** A sidebar group of doc pages (`support/docs-sections.json`). */
export type DocSection = { id: string; title: string; docs: DocPageEntry[] };

export type PackageMeta = {
  shortName: string;
  package: {
    name: string;
    version: string;
    description?: string;
    peerDependencies?: Record<string, string>;
    excom?: { packageType?: string; documented?: boolean; navGroup?: string };
    exports?: Record<string, unknown>;
  };
  demos: Record<string, string>;
  /** Pre-rendered README HTML (from `support/docs/README.md` at build time). */
  readme?: string;
  /** Pre-rendered HTML for every `support/docs/*.md`, keyed by lowercase basename. */
  docs?: Record<string, string>;
  /** Sidebar groups when the docs span several pages. */
  docSections?: DocSection[];
  installation?: Installation;
  elementApis: ElementApi[];
  /** Releases from `CHANGELOG.json`, newest first; each note is inline HTML. Absent without releases. */
  releases?: Array<{ version: string; day: string; notesHtml: string[] }>;
  exportedFiles: Record<string, unknown>;
};

export type PackageIndexEntry = {
  packageType: string;
  /** Nav group overriding the `packageType` placement (`libraries`). */
  navGroup?: string;
  shortName: string;
  version: string;
  docSections?: DocSection[];
};

export type SiteDocIndex = {
  name: string;
  title: string;
};

export type DocsIndex = {
  packages: PackageIndexEntry[];
  docs: SiteDocIndex[];
};

/** Catalog from `index.json`, object shape, or a bare array from older builds. */
export type PackageMetaIndex = PackageIndexEntry[] | DocsIndex;

export const fileNameOf = (p: string): string => p.split("/").pop()!;

function packagesOf(index: PackageMetaIndex | undefined): PackageIndexEntry[] {
  if (!index) return [];
  return Array.isArray(index) ? index : (index.packages ?? []);
}

export const getPackagesByType = (
  packageMetas: PackageMetaIndex,
  type: string
) =>
  packagesOf(packageMetas)
    .filter((pkg) => pkg?.packageType === type)
    .sort();

const DISPLAY_NAMES: Record<string, string> = {
  quark: "Quark",
  neutron: "Neutron",
  "nucleus-kit": "NucleusKit",
  valence: "Valence.css",
};

/** The sidebar label for a package: its display name, else its `shortName`. */
export const displayName = (shortName: string): string =>
  DISPLAY_NAMES[shortName] ?? shortName;

/**
 * The site's own package. To prevent it from showing up anywhere.
 */
export const SITE_PACKAGE = "docs-site";

/** Every docs url hangs off this base. Empty: the docs own the root of their origin. */
export const SITE_BASE = "";

/** The guide that is the docs home route; it has no `<base>/docs/…` url. */
export const SITE_HOME_DOC = "introduction";

/** The docs home route. `/` for an empty base, never `""` (no link, no route). */
export const SITE_HOME = SITE_BASE || "/";

/** Url of a site guide — the home guide is the home route, the rest sit under `/docs`. */
export const siteDocHref = (docName: string): string =>
  docName === SITE_HOME_DOC ? SITE_HOME : `${SITE_BASE}/docs/${docName}`;

/**
 * `<base>/packages/:packageName[/:docName]` read the package meta (README or
 * one of its doc pages); the home route and `<base>/docs/:name` read the site guides.
 */
export const docMetaUrl = (
  docName?: string,
  packageName?: string
): string | null =>
  packageName
    ? packageName === SITE_PACKAGE
      ? null
      : `/package-metas/${packageName}.json`
    : docName
      ? `/package-metas/${SITE_PACKAGE}.json`
      : null;

export const getDocHtml = (
  meta: PackageMeta | undefined,
  docName?: string
): string => (docName ? (meta?.docs?.[docName] ?? "") : (meta?.readme ?? ""));

export type DocNeighbor = { href: string; title: string };

const isSiteMeta = (meta: PackageMeta | undefined): boolean =>
  meta?.package?.excom?.packageType === "site";

export const docNeighbors = (
  meta: PackageMeta | undefined,
  docName?: string
): { prev: DocNeighbor | null; next: DocNeighbor | null } => {
  const pkg = meta?.shortName;
  const sections = meta?.docSections ?? [];
  if (!pkg || !sections.length) return { prev: null, next: null };
  const site = isSiteMeta(meta);
  const hrefOf = (name: string) =>
    site ? siteDocHref(name) : `${SITE_BASE}/packages/${pkg}/${name}`;
  const pages: DocNeighbor[] = [
    ...(site ? [] : [{ href: `${SITE_BASE}/packages/${pkg}`, title: pkg }]),
    ...sections.flatMap((s) =>
      s.docs.map((d) => ({ href: hrefOf(d.name), title: d.title }))
    ),
  ];
  const index = docName
    ? pages.findIndex((p) => p.href === hrefOf(docName))
    : 0;
  if (index === -1) return { prev: null, next: null };
  return { prev: pages[index - 1] ?? null, next: pages[index + 1] ?? null };
};

/** Title of a package doc page in `docSections`; the doc name when unknown. */
export const docTitle = (
  meta: PackageMeta | undefined,
  docName?: string
): string =>
  meta?.docSections?.flatMap((s) => s.docs).find((d) => d.name === docName)
    ?.title ??
  docName ??
  "";

export const getDemoSource = (
  packageMeta: PackageMeta,
  demoName: string
): string | undefined => packageMeta?.demos[demoName];

export function unescapeHtml(s?: string): string {
  return s
    ? s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    : "";
}

export function escapeRegexChars(s?: string): string {
  return s ? s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
}

function escapeHtml(s?: string): string {
  return s
    ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";
}

export function updateTemplate(e) {
  const demoRoot = this.closest(".live-demo");
  const template = demoRoot.querySelector("[aria-label='preview'] > template");
  template.innerHTML = e.target.value;
}

export function copySource(e) {
  /* Shiki examples vs live elements; the playground copies the
   * `<textarea>`'s current value. */
  const isCodeText = e.target.matches?.(".shiki");
  navigator.clipboard.writeText(
    e.target.value ?? e.target[isCodeText ? "textContent" : "innerHTML"]
  );
}

export const resetDemo = (src: string) => (e) => {
  const demoRoot = e.target.closest(".live-demo");
  const textarea = demoRoot.querySelector("textarea");
  textarea.value = src;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

const GITHUB_PACKAGES =
  "https://github.com/excom-dev/nucleus/tree/main/packages";

/** GitHub link for an example-app file (`/examples/*` playground). */
export const buildAppFileLink = (app: string, ext: string): string =>
  `${GITHUB_PACKAGES}/docs-site/public/views/${app}/${app}.${ext}`;

export const buildGitHubLink = (
  packageName: string,
  demoName?: string
): string => {
  const demoPath = demoName ? `support/demos/${demoName}.html` : "";
  return `${GITHUB_PACKAGES}/${packageName}/${demoPath}`;
};

type Highlight = typeof import("./highlight");

let highlight: Highlight | undefined;

/**
 * Loads the highlighter once; `upgradeTemplateCode` is synchronous from then
 * on. A build writes this import as `./highlight.js`: the URL the sheets
 * `@use`, so a page holds one highlighter.
 */
export const loadHighlight = async (): Promise<Highlight> =>
  (highlight ??= await import("./highlight"));

/* Offline, the plain code still renders */
const renderOnceLoaded = async (
  e: CustomEvent<() => unknown>,
  upgrade: (loaded: Highlight) => void
) => {
  try {
    upgrade(await loadHighlight());
  } finally {
    e.detail();
  }
};

/**
 * Highlights a markdown code block's template as it is about to render
 * (`include-content-render`). The first block that needs the highlighter
 * holds its render until it has loaded.
 */
export const upgradeTemplateCode = (e) => {
  const template = e.target.querySelector("template");
  const content = template.innerHTML;
  // highlighted already (a prerendered page): again would show its markup
  if (!content || template.content.querySelector(".shiki")) return;
  const upgrade = ({ renderLang }: Highlight) => {
    template.innerHTML = renderLang(
      unescapeHtml(content),
      e.target.getAttribute("data-language") || "txt",
      { includeCopyButton: true }
    );
  };
  if (highlight) return upgrade(highlight);
  e.preventDefault();
  renderOnceLoaded(e, upgrade);
};

export const unescapeCssType = (type?: string): string => {
  return type?.replace(/&lt;/g, "<").replace(/&gt;/g, ">") ?? "";
};

export const sumLengths = (...lists: any[]): number =>
  lists.reduce((sum, list) => sum + (list?.length ?? 0), 0);

export const addLengths = (...lists: any[]): string =>
  "(" + sumLengths(...lists) + ")";

export const joinSelectors = (selectors?: string[]): string =>
  (selectors ?? []).join(", ");

export const pickDefault = (item: any): string => {
  return item.type === "boolean" ? "false" : (item.default ?? "null");
};

export const getDemoId = (packageName: string, demoRef: string): string => {
  return `demo-${packageName}-${demoRef}`;
};

/** One entry in the generated search corpus (heft-rig build-search-docs.mjs). */
export type SearchDoc = {
  kind: string;
  package: string;
  tag?: string;
  /** `kind: "page"`: the package doc page key. */
  doc?: string;
  title?: string;
  text?: string;
};

export type SearchCorpus = { version: number; docs: SearchDoc[] };

/** One MiniSearch index per corpus `docs` array (WeakMap so refetches GC cleanly). */
const searchIndexes = new WeakMap<SearchDoc[], MiniSearch>();

function getSearchIndex(docs: SearchDoc[]): MiniSearch {
  let index = searchIndexes.get(docs);
  if (!index) {
    index = new MiniSearch({
      fields: ["package", "title", "text"],
      searchOptions: {
        boost: { package: 3, title: 2, text: 1 },
        prefix: true,
        fuzzy: 0.02,
      },
      tokenize: (string) =>
        string.split(/[\n\r\p{Z}\p{Pi}\p{Ps}\p{Pc}\p{Po}]+/u).filter(Boolean),
    });
    // Corpus emits no ids, array index is the document id (build-search-docs.mjs).
    index.addAll(docs.map((doc, id) => ({ ...doc, id })));
    searchIndexes.set(docs, index);
  }
  return index;
}

/** MiniSearch `match` inverted: field → terms found in that field. */
export type SearchFieldMatches = Partial<
  Record<"package" | "title" | "text", string[]>
>;

export type SearchResultDoc = SearchDoc & {
  id: number;
  matches: SearchFieldMatches;
};

/** Invert MiniSearch MatchInfo `{ term: fields[] }` → `{ field: terms[] }`. */
function matchesByField(match: Record<string, string[]>): SearchFieldMatches {
  const byField: SearchFieldMatches = {};
  for (const [term, fields] of Object.entries(match)) {
    for (const field of fields) {
      const key = field as keyof SearchFieldMatches;
      (byField[key] ??= []).push(term);
    }
  }
  return byField;
}

export const filterSearchResults = (
  corpus: SearchCorpus,
  searchQuery: string
): SearchResultDoc[] => {
  const query = searchQuery?.trim();
  if (corpus.version !== 1 || !query || query.length < 3) return [];
  return getSearchIndex(corpus.docs)
    .search(query)
    .map(({ id, match }) => ({
      ...corpus.docs[id as number],
      id: id as number,
      matches: matchesByField(match),
    }));
};

const humanMappings = {
  "kit-element": "Elements",
  library: "Libraries",
  "element-base": "Element Bases",
  tool: "Tools",
};
/**
 * `doc` hits are guides keyed by their doc name; `page` hits are one doc page
 * of a package — except the site's own package, whose pages are the guides.
 */
export const searchResultHref = (item: SearchDoc): string =>
  item.kind === "doc"
    ? siteDocHref(item.package)
    : item.kind === "page" && item.doc
      ? item.package === SITE_PACKAGE
        ? siteDocHref(item.doc)
        : `${SITE_BASE}/packages/${item.package}/${item.doc}`
      : `${SITE_BASE}/packages/${item.package}`;

export const mapPackageType = (
  packageIndices: PackageMetaIndex,
  kind: string,
  packageName: string
): string => {
  if (kind === "doc") {
    return "Overview";
  }
  if (kind === "package") {
    return "Packages";
  }
  const packageIndex = packagesOf(packageIndices).find(
    (pkg) => pkg.shortName === packageName
  );
  return (
    humanMappings[packageIndex?.packageType ?? ""] ??
    packageIndex?.packageType ??
    ""
  );
};

export const highlightQuery = (
  text: string,
  fieldMatches: string[] | undefined,
  query: string
): string => {
  if (!text) return "";
  const q = query?.trim() ?? "";
  const terms = (fieldMatches?.length ? fieldMatches : q ? [q] : [])
    .map((t) => t.trim())
    .filter(Boolean);
  if (!terms.length) return escapeHtml(text);

  let matchIndex = -1;
  for (const term of terms) {
    const i = text.toLowerCase().indexOf(term.toLowerCase());
    if (i !== -1 && (matchIndex === -1 || i < matchIndex)) matchIndex = i;
  }
  const clipped = matchIndex > 40 ? `…${text.slice(matchIndex - 40)}` : text;
  const escapedQuery = escapeHtml(q).toLowerCase();
  const pattern = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRegexChars(escapeHtml(t)))
    .join("|");
  return escapeHtml(clipped).replace(
    new RegExp(`(${pattern})`, "gi"),
    (matched) =>
      `<mark${matched.toLowerCase() !== escapedQuery ? " class='fuzzy-match'" : ""}>${matched}</mark>`
  );
};

/** Rough TypeScript type pretty-printer. */
export const formatTsType = (_type: string, tag: string): string => {
  let depth = 0;
  const type = _type.replace(/{tag}/g, tag);
  return type.replace(/\{ *|(; *)(?=})|; *| *\}/g, (ch, closeSemi) => {
    if (ch.startsWith("{")) {
      depth++;
      return "{\n" + "  ".repeat(depth);
    }
    if (closeSemi) return ";";
    if (ch.startsWith(";")) return ";\n" + "  ".repeat(depth);
    depth = Math.max(0, depth - 1);
    return "\n" + "  ".repeat(depth) + "}";
  });
};

export const focusInput = (e) => e.target.querySelector("input")?.focus();

export const didCompleteLink = (element: Element): boolean => {
  const past = element.closest("spa-manager")?.router?.previousStates;
  return !!past?.find(
    (state) => state.url === element.getAttribute("route-href")
  );
};

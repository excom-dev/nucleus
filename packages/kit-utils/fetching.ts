import { execWhenReady, hashString, tc } from "./common";
import { buildContent, selectOne } from "./dom";
import {
  fetchRecord,
  INERT_ATTR,
  isHydrating,
  isServerRender,
  type ServerRender,
  TEMPLATE_ID_ATTR,
} from "./hydration";

const TEMPLATES: {
  [templateRef: string]: DocumentFragment | Promise<DocumentFragment>;
} = {};

/** `templateRef` → `"<templateRef>#<hash of its fetched text>"`. */
const IDENTITIES: Record<string, string> = {};

/** The server render these caches belong to. */
let cachesRender: ServerRender | undefined;

/**
 * Each server render starts with empty caches, so every prerendered page
 * fetches, and records, what it uses. No effect outside a server render.
 */
const cachesForRender = () => {
  const render = (globalThis as { __NUCLEUS_SSR__?: ServerRender })
    .__NUCLEUS_SSR__;
  if (render && render !== cachesRender) {
    cachesRender = render;
    clearFetchCaches();
  }
};

const isUrlRef = (templateRef: string) =>
  /^\/|^\.\/|^\.\.\/|^http/.test(templateRef);

/** Response text. Throws on a non-ok status: an error page is not content. */
const fetchText = async (url: string, reqInit: RequestInit = {}) => {
  const { ok, status, body } = await fetchRecord(url, reqInit);
  if (!ok) throw new Error(`HTTP ${status}: ${url}`);
  return body;
};

/**
 * Hold `request` in `store[key]` while in flight, then its value. A failure
 * is evicted so the next call fetches again. A purge while in flight wins.
 */
const cacheRequest = <T>(
  store: Record<string, T | Promise<T>>,
  key: string,
  request: Promise<T>
): Promise<T> => {
  store[key] = request;
  (async () => {
    try {
      const value = await request;
      if (store[key] === request) store[key] = value;
    } catch {
      if (store[key] === request) delete store[key];
    }
  })();
  return request;
};

/**
 * `value`, or `signal.reason` as soon as the signal aborts. Ends this wait
 * only: a shared request goes on for its other callers.
 */
const abortableWait = async <T>(
  value: T | Promise<T>,
  signal?: AbortSignal | null
) => {
  if (!signal) return await value;
  let onAbort = () => {};
  try {
    return await Promise.race([
      value,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort);
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

/** Every `<script>` in `root`, nested `<template>` contents included. */
const scriptsIn = (root: ParentNode): Element[] => [
  ...root.querySelectorAll("script"),
  ...[...root.querySelectorAll("template")].flatMap((template) =>
    scriptsIn(template.content)
  ),
];

export const fetchTemplate = async (
  templateRef: string,
  options: { reqInit?: RequestInit } = {}
) => {
  cachesForRender();
  const template = document.createElement("template");
  const text = await fetchText(templateRef, options?.reqInit);
  // only a server render and hydration compare identities
  if (isServerRender() || isHydrating()) {
    IDENTITIES[templateRef] = `${templateRef}#${hashString(text)}`;
  }
  template.innerHTML = text;
  /* Its scripts, and their clones, never run on a cold client, but would
   * run once a prerendered page is parsed: the prerenderer neutralizes
   * the ones a server render marks. */
  if (isServerRender()) {
    scriptsIn(template.content).forEach((script) =>
      script.setAttribute(INERT_ATTR, "")
    );
  }
  return template.content;
};

/**
 * Source identity of a render from `templateRef` (see
 * `replaceNonTemplateChildren`), or `null`:
 * - a URL template: `"<url>#<hash of its text>"`, once fetched during a
 *   server render or the hydration window;
 * - an in-document `<template>`: `"#<n-tpl-id>"`. A server render assigns the
 *   id, a hash of the template's source, when missing. The browser reads it
 *   and never hashes again, so a template changed in the page before its
 *   first render still matches what the server rendered.
 *
 * Source text, not parsed nodes: the server and browsers parse some markup
 * differently.
 */
export const templateIdentity = (
  templateRef: string,
  options?: { scope?: Element }
): string | null => {
  cachesForRender();
  if (isUrlRef(templateRef)) return IDENTITIES[templateRef] ?? null;
  const template: Element | null | undefined = tc(() =>
    selectOne(templateRef, {
      scope: (options?.scope || document) as Element,
    })
  );
  if (template?.localName !== "template") return null;
  if (isServerRender() && !template.hasAttribute(TEMPLATE_ID_ATTR)) {
    template.setAttribute(TEMPLATE_ID_ATTR, hashString(template.innerHTML));
  }
  const id = template.getAttribute(TEMPLATE_ID_ATTR);
  return id === null ? null : `#${id}`;
};

/**
 * Resolve a `<template>` from a URL or DOM selector.
 * Cached URL hits return a fragment synchronously; the first fetch
 * returns a Promise. Callers that must always await can use
 * `wrapInPromise`. A URL fetch is shared by the page: `reqInit.signal` ends
 * only this caller's wait, and an aborted one throws at once. It cannot
 * cancel or time out the request: later callers join one that hangs until
 * it settles, or until `bypassCache` / `clearFetchCaches` starts a new one.
 */
export const resolveTemplateContent = (
  templateRef: string,
  options?: {
    scope?: Element;
    skipCloning?: boolean;
    bypassCache?: boolean;
    reqInit?: RequestInit;
  }
): DocumentFragment | Promise<DocumentFragment> | null => {
  let templateContent: DocumentFragment | Promise<DocumentFragment> | null;
  if (isUrlRef(templateRef)) {
    // URL: cache by templateRef
    const { signal, ...reqInit } = options?.reqInit ?? {};
    signal?.throwIfAborted();
    cachesForRender();
    if (options?.bypassCache || !TEMPLATES[templateRef]) {
      /* bypassCache also refreshes the cache so later reads of this
       * templateRef see the new content. */
      cacheRequest(
        TEMPLATES,
        templateRef,
        fetchTemplate(templateRef, { reqInit })
      );
    }
    const cached = TEMPLATES[templateRef];
    templateContent =
      cached instanceof Promise ? abortableWait(cached, signal) : cached;
  } else {
    // selector: live <template> in the DOM
    const scope = (options?.scope || document) as Element;
    if (!scope.querySelector) {
      throw new Error(
        "resolveTemplateContent requires a scope with querySelector"
      );
    }
    templateContent =
      (
        selectOne(templateRef, {
          scope,
        }) as HTMLTemplateElement
      )?.content ?? null;
  }
  if (!templateContent) {
    throw new Error(`Template not found: ${templateRef}`);
  }
  return execWhenReady(templateContent, (t) =>
    buildContent(t, {
      skipCloning: options?.skipCloning,
    })
  );
};

/**
 * URL a `@use` module loads from. Absolute URLs pass through and `//host/x.js`
 * loads from that host; a path (`/x.js`, `./x.js`, `x.js`) resolves against
 * the site root. Throws for any scheme but `http:` / `https:` (`data:`,
 * `blob:`, …), so a sheet cannot import inline code. The page's own scheme
 * is allowed too (`capacitor://`, `app://`).
 */
export const resolveModuleUrl = (
  ref: string,
  origin: string = window.location.origin
) => {
  const url = new URL(ref, origin);
  if (!["http:", "https:", new URL(origin).protocol].includes(url.protocol)) {
    throw new Error(`Refused module URL scheme "${url.protocol}"`);
  }
  return url.href;
};

export const resolveModuleReference = async (ref: string) =>
  await import(/* @vite-ignore */ resolveModuleUrl(ref));

const PLAIN_TEXTS: { [url: string]: string | Promise<string> } = {};

/**
 * Drop cached fetch results, the template fragments `resolveTemplateContent`
 * keeps per URL and the text `fetchPlainText` keeps per URL. Both caches are
 * module-level and shared by every element on the page (`include-content`,
 * `spa-route`, `quark-sheet`), so a purge affects all of them: pass a `url`
 * to forget one entry, omit it to forget everything. In-flight requests are
 * not cancelled; their result simply is not kept. Returns the number of
 * entries removed.
 */
export const clearFetchCaches = (url?: string): number => {
  const stores: Array<Record<string, unknown>> = [TEMPLATES, PLAIN_TEXTS];
  let removed = 0;
  for (const store of stores) {
    const keys =
      url === undefined ? Object.keys(store) : url in store ? [url] : [];
    for (const key of keys) {
      delete store[key];
      removed++;
    }
  }
  // a refetch may bring other text: identity is known again on arrival
  (url === undefined ? Object.keys(IDENTITIES) : [url]).forEach(
    (key) => delete IDENTITIES[key]
  );
  return removed;
};

/**
 * Response text, cached per URL for the page. Rejects on a non-ok status;
 * a failed URL is fetched again on the next call. `reqInit.signal` ends only
 * this caller's wait (see `resolveTemplateContent`), and an aborted one
 * rejects at once.
 */
export const fetchPlainText = async (
  url: string,
  options?: { reqInit?: RequestInit }
) => {
  const { signal, ...reqInit } = options?.reqInit ?? {};
  signal?.throwIfAborted();
  cachesForRender();
  return await abortableWait(
    PLAIN_TEXTS[url] ?? cacheRequest(PLAIN_TEXTS, url, fetchText(url, reqInit)),
    signal
  );
};

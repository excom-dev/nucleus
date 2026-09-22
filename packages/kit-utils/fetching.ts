import { execWhenReady, pathJoin } from "./common";
import { buildContent, selectOne } from "./dom";

const TEMPLATES: {
  [templateRef: string]: DocumentFragment | Promise<DocumentFragment>;
} = {};

export const fetchTemplate = async (
  templateRef: string,
  options: { reqInit?: RequestInit } = {}
) => {
  const html = await fetch(templateRef, options?.reqInit || {}).then((res) =>
    res.text()
  );
  const template = document.createElement("template");
  template.innerHTML = html;
  const content = template.content;
  return content;
};

/**
 * Resolve a `<template>` from a URL or DOM selector.
 * Cached URL hits return a fragment synchronously; the first fetch
 * returns a Promise. Callers that must always await can use
 * `wrapInPromise`.
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
  if (/^\/|^\.\/|^\.\.\/|^http/g.test(templateRef)) {
    // URL: cache by templateRef
    if (
      !options?.bypassCache &&
      TEMPLATES[templateRef] instanceof DocumentFragment
    ) {
      templateContent = TEMPLATES[templateRef];
    } else if (options?.bypassCache || !TEMPLATES[templateRef]) {
      /* bypassCache also refreshes the cache so later reads of this
       * templateRef see the new content. */
      const pending = fetchTemplate(templateRef, {
        reqInit: options?.reqInit,
      }).then((content) => {
        // a purge while in flight must not be undone by the settle
        if (TEMPLATES[templateRef] === pending)
          TEMPLATES[templateRef] = content;
        return content;
      });
      TEMPLATES[templateRef] = pending;
    }
    templateContent = TEMPLATES[templateRef];
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

export const resolveModuleReference = async (ref: string) =>
  await import(/* @vite-ignore */ pathJoin([window.location.origin, ref]));

const PLAIN_TEXTS: { [url: string]: Promise<string> } = {};

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
  return removed;
};
export const fetchPlainText = async (
  url: string,
  options?: { reqInit?: RequestInit }
) => {
  if (!PLAIN_TEXTS[url]) {
    PLAIN_TEXTS[url] = fetch(url, options?.reqInit || {}).then((res) =>
      res.text()
    );
  }
  return PLAIN_TEXTS[url];
};

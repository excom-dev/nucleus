/**
 * Hydration of a prerendered page: a cold mount whose network is instant and
 * whose DOM writes find their result already there. A server render
 * (`globalThis.__NUCLEUS_SSR__`) records responses and notes what it rendered
 * into each host; a prerendered page (`<html n-ssr>` and its island) assigns
 * provisions, serves recorded responses and keeps server-rendered hosts while
 * the hydration window is open. With neither, every function here is inert.
 * State is global: two bundle copies share it.
 */
import { hashString, isPojo, tc } from "./common";

/** A response as plain data; `body` is the response text. */
export interface FetchRecord {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  type: ResponseType;
  headers: [string, string][];
  body: string;
}

/** What the prerenderer ships in `<script type="application/json" id="nucleus-hydration">` at the end of `<body>`. */
export interface HydrationIsland {
  v: 1;
  /** By `n-ssr` id. */
  provisions: Record<string, unknown>;
  responses: Array<{
    method: "GET" | "HEAD";
    /** Path + query for a same-origin request. */
    url: string;
    record: FetchRecord;
    /** Identical requests the render made, when more than one: the browser answers that many from `record`. */
    count?: number;
  }>;
}

/** `globalThis.__NUCLEUS_SSR__`: installed by the prerenderer while it renders. */
export interface ServerRender {
  /** Recorded responses, for the island: one per method and path, repeats counted. */
  responses: HydrationIsland["responses"];
  /** Absolute request URLs never recorded (answered from client state). */
  exclude?: (url: string) => boolean;
}

export const HYDRATION_ISLAND_ID = "nucleus-hydration";
/** `n-ssr="<id>"`: the element's provision is in the island. Bare on `<html>`: a prerendered document. */
export const SSR_ATTR = "n-ssr";
/** On a render host: the source identity of what the server rendered into it. */
export const STAMP_ATTR = "n-tpl";
/** On an in-document `<template>`: its identity token. */
export const TEMPLATE_ID_ATTR = "n-tpl-id";
/** On a `<script>` an html paint inserted during a server render. Inert in a browser at runtime, live once the page is parsed: the prerenderer neutralizes it. */
export const INERT_ATTR = "n-inert";
/**
 * On an element: the Neutron elements in its region (it and what it holds)
 * stay out of the prerender and mount in the browser only. Write it in the
 * markup, or first in the rule that activates the element. Methods called
 * from outside still run on a kept-out element; removing it from an
 * ancestor does not mount what the ancestor holds.
 */
export const NO_SSR_ATTR = "no-ssr";

const DEADLINE_MS = 10_000;
const UNCACHED = ["no-store", "no-cache", "reload"];
const PRIVATE_REQUEST_HEADERS = ["cache-control", "authorization", "range"];

interface State {
  booted: boolean;
  open: boolean;
  provisions: Map<string, unknown>;
  /** `"<METHOD> <path>"` → record, and how many requests it still answers. */
  responses: Map<string, { record: FetchRecord; left: number }>;
  holds: number;
  /** Bumped by every hold and served response. */
  activity: number;
  probe?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  closed: Promise<void>;
  close: () => void;
}

type Provided = Element & { provision?: unknown };

const KEY = Symbol.for("@excom/kit-utils:hydration");
const g = globalThis as typeof globalThis & {
  [KEY]?: State;
  __NUCLEUS_SSR__?: ServerRender;
};

const fresh = (): State => {
  let close!: () => void;
  const closed = new Promise<void>((resolve) => {
    close = () => resolve();
  });
  return {
    booted: false,
    open: false,
    provisions: new Map(),
    responses: new Map(),
    holds: 0,
    activity: 0,
    closed,
    close,
  };
};

const state = (): State => (g[KEY] ??= fresh());

const closeWindow = (s: State) => {
  s.open = false;
  s.provisions.clear();
  s.responses.clear();
  clearTimeout(s.probe);
  clearTimeout(s.deadline);
  s.close();
};

/** Close once nothing holds the window and two macrotasks pass without a hold or a served response. */
const settle = (s: State) => {
  if (!s.open || s.holds > 0 || s.probe) return;
  let seen = s.activity;
  let quiet = 0;
  const probe = () => {
    s.probe = undefined;
    if (!s.open || s.holds > 0) return;
    quiet = s.activity === seen ? quiet + 1 : 0;
    seen = s.activity;
    if (quiet < 2) s.probe = setTimeout(probe, 0);
    else closeWindow(s);
  };
  s.probe = setTimeout(probe, 0);
};

/** Whether a prerenderer is rendering (`globalThis.__NUCLEUS_SSR__`). */
export const isServerRender = (): boolean => !!g.__NUCLEUS_SSR__;

/**
 * Whether the hydration window is open: from boot until nothing has held it
 * (see `holdHydration`) for two macrotasks, 10 s at most.
 */
export const isHydrating = (): boolean => state().open;

const isPrerendered = () =>
  !isServerRender() && document.documentElement.hasAttribute(SSR_ATTR);

/**
 * A prerendered page still being parsed, its island not read yet: Neutron
 * holds first mounts until the document is parsed, so they find their
 * provisions.
 */
export const isIslandPending = (): boolean =>
  !state().booted && document.readyState === "loading" && isPrerendered();

/** A response as `fetchRecord` resolves one: what serving it relies on. */
const isRecord = (record: any): record is FetchRecord =>
  isPojo(record) &&
  typeof record.url === "string" &&
  !!tc(() => new URL(record.url, location.href)) &&
  Number.isInteger(record.status) &&
  typeof record.statusText === "string" &&
  typeof record.ok === "boolean" &&
  typeof record.redirected === "boolean" &&
  typeof record.type === "string" &&
  Array.isArray(record.headers) &&
  !!tc(() => new Headers(record.headers)) &&
  typeof record.body === "string";

const isIsland = (data: any): data is HydrationIsland =>
  data?.v === 1 &&
  isPojo(data.provisions) &&
  Array.isArray(data.responses) &&
  data.responses.every(
    (entry) =>
      isPojo(entry) &&
      typeof entry.method === "string" &&
      typeof entry.url === "string" &&
      isRecord(entry.record) &&
      (entry.count === undefined ||
        (Number.isSafeInteger(entry.count) && entry.count > 0))
  );

/** The page's island: the last JSON script with its id, so content earlier in the page cannot stand in for it. */
const findIsland = () =>
  Array.from(
    document.querySelectorAll(
      `script[type="application/json"]#${HYDRATION_ISLAND_ID}`
    )
  ).at(-1);

/** Give `element` its island provision; `false` when the assignment throws. */
const provide = (element: Provided, s: State) => {
  try {
    if (customElements.get(element.localName)) {
      const claim = claimProvision(element);
      if (claim) element.provision = claim.value;
    } else {
      const id = element.getAttribute(SSR_ATTR)!;
      // an own property until upgrade; the attribute stays for the upgraded
      // element's claim (an upgrade may replace the element, as happy-dom's)
      if (s.provisions.has(id)) element.provision = s.provisions.get(id);
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Read the island of a prerendered page once: open the hydration window and
 * give every `[n-ssr]` element its provision, eagerly, since a sheet may read
 * it before the element upgrades. Waits for the parsed document: until then
 * the island may be partial. No island yet: nothing happens, a later call may
 * boot. A malformed island leaves the page cold, with one warning. Never
 * throws.
 */
export const bootHydration = (): void => {
  const s = state();
  if (s.booted || !isPrerendered()) return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootHydration, {
      once: true,
    });
    return;
  }
  const island = findIsland();
  if (!island) return;
  s.booted = true;
  const data = tc(() => JSON.parse(island.textContent ?? ""));
  if (!isIsland(data)) {
    console.warn(`#${HYDRATION_ISLAND_ID} is malformed: mounting cold`);
    return;
  }
  s.provisions = new Map(Object.entries(data.provisions));
  s.responses = new Map(
    data.responses.map(({ method, url, record, count = 1 }) => [
      `${method} ${url}`,
      { record, left: count },
    ])
  );
  s.open = true;
  s.deadline = setTimeout(() => {
    console.warn(
      `Hydration window closed by its ${DEADLINE_MS / 1000} s deadline: a held task never settled`
    );
    closeWindow(s);
  }, DEADLINE_MS);
  const refused = Array.from(
    document.querySelectorAll<Provided>(`[${SSR_ATTR}]:not(html)`)
  ).filter((element) => !provide(element, s));
  if (refused.length) {
    console.warn("These elements refused their provision:", refused);
  }
  settle(s);
};

/**
 * The island provision of an `[n-ssr]` element, once; the attribute goes
 * either way. Neutron claims for each element at its first connect.
 */
export const claimProvision = (
  element: Element
): { value: unknown } | undefined => {
  if (!element.hasAttribute(SSR_ATTR)) return;
  bootHydration();
  // a boot that just ran claimed it already
  const id = element.getAttribute(SSR_ATTR);
  if (id === null) return;
  element.removeAttribute(SSR_ATTR);
  const { provisions } = state();
  if (!provisions.has(id)) return;
  const value = provisions.get(id);
  provisions.delete(id);
  return { value };
};

/**
 * Keep the hydration window open until `work` settles. Returns `work`. Also
 * held, without asking: a deferred Neutron event default until its body has
 * run (not a promise it returns), and every kit fetch (`fetchRecord`) started
 * while the window is open, until it settles.
 */
export const holdHydration = <T>(work: Promise<T>): Promise<T> => {
  const s = state();
  if (s.open) {
    s.holds++;
    s.activity++;
    const release = () => {
      s.holds--;
      settle(s);
    };
    work.then(release, release);
  }
  return work;
};

/**
 * Resolves when the hydration window closes; at once on a page without one.
 * Boots first. On a prerendered page still being parsed, it waits for the
 * window the parsed page opens.
 */
export const whenHydrated = (): Promise<void> => {
  bootHydration();
  const s = state();
  if (s.open) return s.closed;
  return isIslandPending()
    ? new Promise((resolve) =>
        document.addEventListener(
          "DOMContentLoaded",
          () => resolve(whenHydrated()),
          { once: true }
        )
      )
    : Promise.resolve();
};

/** Test utility: forget all hydration state (`whenHydrated` waiters resolve). */
export const resetHydration = (): void => {
  const s = g[KEY];
  if (s) closeWindow(s);
  g[KEY] = fresh();
};

/** Method and path + query of a request a recorded response may answer, else `null`. */
const shareableRequest = (input: RequestInfo | URL, init: RequestInit = {}) => {
  // a `Request` carries its own method and headers: always the network
  if (typeof input !== "string" && !(input instanceof URL)) return null;
  const method = (init.method ?? "GET").toUpperCase();
  const target: URL | undefined = tc(() => new URL(input, location.href));
  const headers: Headers | undefined = tc(() => new Headers(init.headers));
  const shareable =
    !!target &&
    !!headers &&
    target.origin === location.origin &&
    ["GET", "HEAD"].includes(method) &&
    !UNCACHED.includes(init.cache ?? "") &&
    !PRIVATE_REQUEST_HEADERS.some((name) => headers.has(name)) &&
    !init.integrity &&
    init.mode !== "no-cors" &&
    !init.signal?.aborted;
  return shareable ? { method, path: target.pathname + target.search } : null;
};

/** A response that varies per person never goes into a public page. */
const isPrivateResponse = (headers: Headers) =>
  headers.has("set-cookie") ||
  /private|no-store/i.test(headers.get("cache-control") ?? "") ||
  /\*|cookie|authorization|accept-language/i.test(headers.get("vary") ?? "");

/** Same-origin URLs as path + query: a preview origin still matches. */
const originRelative = (url: string) => {
  const parsed: URL | undefined = tc(() => new URL(url));
  return parsed?.origin === location.origin
    ? parsed.pathname + parsed.search
    : url;
};

const readResponse = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<FetchRecord> => {
  const response = await fetch(input, init);
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    redirected: response.redirected,
    type: response.type,
    // a hand-made response may have no headers, or a plain object
    headers: [...new Headers(response.headers ?? undefined)],
    body: await response.text(),
  };
};

/**
 * A recorded response as `fetch` hands one over. An abort before then rejects,
 * and runs `onAbort` as it happens.
 */
const deliver = async (
  record: FetchRecord,
  signal: AbortSignal | null | undefined,
  onAbort: () => void
) => {
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await null;
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return {
    ...record,
    url: record.url && new URL(record.url, location.href).href,
  };
};

/**
 * The kit's fetch: the response as plain data, its body read as text. A
 * non-ok status resolves; network errors and aborts reject as `fetch` does.
 * While the hydration window is open, a matching GET / HEAD (a URL string or
 * `URL`) takes its recorded response from memory instead, as many times as
 * the server render made that request (one aborted before its answer does not
 * count, as on the server); any other call holds the window until it
 * settles. A server render records each response once and counts the
 * identical requests: a URL answering with another body later in the same
 * render still gets its first one in the browser.
 */
export const fetchRecord = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<FetchRecord> => {
  const s = state();
  const server = g.__NUCLEUS_SSR__;
  const request = s.open || server ? shareableRequest(input, init) : null;
  const key = request && `${request.method} ${request.path}`;
  const served = key && s.open ? s.responses.get(key) : undefined;
  if (served) {
    served.left -= 1;
    if (!served.left) s.responses.delete(key!);
    // e.g. `doFetch` cancelling it to fetch again at once: the turn is back
    const giveBack = () => {
      served.left += 1;
      if (s.open) s.responses.set(key!, served);
    };
    return await holdHydration(deliver(served.record, init?.signal, giveBack));
  }
  const network = readResponse(input, init);
  const record = await (s.open ? holdHydration(network) : network);
  if (
    server &&
    request &&
    record.ok &&
    !isPrivateResponse(new Headers(record.headers)) &&
    !server.exclude?.(new URL(input as string | URL, location.href).href)
  ) {
    const recorded = server.responses.find(
      ({ method, url: path }) => `${method} ${path}` === key
    );
    if (recorded) recorded.count = (recorded.count ?? 1) + 1;
    else
      server.responses.push({
        method: request.method as "GET" | "HEAD",
        url: request.path,
        record: { ...record, url: originRelative(record.url) },
      });
  }
  return record;
};

/** Source identity of an html string paint. */
export const htmlIdentity = (html: string): string =>
  `html#${hashString(html)}`;

/**
 * `host` still holds what the server rendered into it: the hydration window
 * is open, `host` has `n-tpl` and content besides `<template>`s.
 */
export const hasServerContent = (host: ParentNode): boolean =>
  isHydrating() &&
  !!(host as Element).hasAttribute?.(STAMP_ATTR) &&
  Array.from(host.childNodes).some((node) =>
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element).localName !== "template"
      : !!node.textContent?.trim()
  );

/** `host` still holds what the server rendered from `identity`: a render of that source can keep it. */
export const canAdopt = (host: ParentNode, identity?: string | null): boolean =>
  !!identity &&
  hasServerContent(host) &&
  (host as Element).getAttribute(STAMP_ATTR) === identity;

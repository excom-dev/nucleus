/**
 * The renderer of a test pool's worker, as `NUCLEUS_SSR_TEST_WORKER` (JSON,
 * `TestWorker`) sets it up: the fixture site with real Nucleus Kit elements,
 * plus `x-hang` (never yields) and `x-crash` (ends its process).
 */
import { serveRenderer } from "../../../../index";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface TestWorker {
  root: string;
  budgetMs?: number;
  /** Routes whose `onError` policy is `"shell"`. */
  shellOnError?: string[];
  /** Page bodies by route, in the site's shell. */
  bodies?: Record<string, string>;
  /** Routes whose shell an earlier prerender wrote. */
  stale?: string[];
  /** Routes whose shell ends the worker's process. */
  crashShell?: string[];
  /** The worker's part of the cache key; `"pid"`: its process id, which no two workers share. */
  cacheKey?: string;
  /** The entry is Nucleus Kit's server entry alone: its elements and its hooks. */
  kitEntry?: boolean;
}

const {
  root,
  budgetMs,
  shellOnError = [],
  bodies = {},
  stale = [],
  crashShell = [],
  cacheKey,
  kitEntry,
}: TestWorker = JSON.parse(process.env.NUCLEUS_SSR_TEST_WORKER!);
const SHELL = readFileSync(join(root, "index.html"), "utf8");

await serveRenderer({
  root,
  origin: "https://wren.test",
  // generous: only a page that never settles fails on a loaded machine
  budgetMs: budgetMs ?? 30_000,
  onError: (url) => (shellOnError.includes(url) ? "shell" : "fail"),
  shell:
    Object.keys(bodies).length || stale.length || crashShell.length
      ? (url) => {
          if (crashShell.includes(url)) process.exit(3);
          return (stale.includes(url) ? SHELL.replace("<html", "<html n-ssr") : SHELL).replace(
            /<body>[\s\S]*<\/body>/,
            (body) => (url in bodies ? `<body>${bodies[url]}</body>` : body)
          );
        }
      : undefined,
  cacheKey:
    cacheKey === undefined
      ? undefined
      : () => (cacheKey === "pid" ? String(process.pid) : cacheKey),
  entry: async () => {
    if (kitEntry) return import("@excom/nucleus-kit/server");
    await import("@excom/spa-route");
    await import("@excom/include-content");
    await import("@excom/provider-fetch");
    const { Quark } = await import("@excom/quark");
    // after the elements above: they have mounted by the time a sheet first runs
    await import("@excom/quark-sheet");
    const { resetRouter } = await import("@excom/spa-route/testing");
    customElements.define(
      "x-hang",
      class extends HTMLElement {
        connectedCallback() {
          for (;;);
        }
      }
    );
    customElements.define(
      "x-crash",
      class extends HTMLElement {
        connectedCallback() {
          process.exit(3);
        }
      }
    );
    return {
      // `budgetMs` bounds the page; `whenSettled()` alone gives up after 1 s,
      // too soon on a loaded machine
      settle: () => Quark.whenSettled({ timeout: Infinity }),
      beforeRender: ({ url }: { url: string }) => resetRouter(url),
    };
  },
});

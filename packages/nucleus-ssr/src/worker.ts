import type { Diagnostics } from "./diagnostics";
import { parentChannel, sha256 } from "./node";
import {
  openRenderer,
  type PageInputs,
  type RendererHandle,
  type RendererOptions,
} from "./renderer";

/** What `prerender()` asks a renderer, in a worker or in its own process. */
export type Task =
  | { type: "render"; url: string; notFound?: boolean }
  | { type: "shell"; url: string }
  | { type: "check"; url: string; inputs: PageInputs }
  | { type: "lost"; url: string; diagnostics: Diagnostics };

/** A page: its HTML (none when it failed under `"fail"`), diagnostics and, without errors, its shell's digest. */
export type Outcome = {
  html?: string;
  diagnostics: Diagnostics;
  shell?: string;
};

/** A renderer's answer to a task. `fatal`: an error the run cannot go on after. */
export type Reply =
  | { type: "page"; outcome: Outcome }
  | { type: "checked"; changed?: string }
  | { type: "fatal"; error: unknown };

/** A worker's first message: its renderer is open. */
export type Ready = { type: "ready"; key: string; budgetMs: number };

export interface ServeRendererOptions extends RendererOptions {
  /**
   * The part of the cache key only the worker knows, once `entry` loaded:
   * e.g. a digest of the app code it evaluated. `prerender()` refuses a
   * pool whose workers give different keys.
   */
  cacheKey?: () => string | Promise<string>;
}

/** A renderer's part of the cache key: its own, and the worker's. */
export const keyOf = (renderer: RendererHandle, cacheKey?: string): string =>
  sha256(JSON.stringify([renderer.key, cacheKey ?? null]));

/** `renderer`'s reply to `task`. */
export const perform = async (
  renderer: RendererHandle,
  task: Task
): Promise<Reply> => {
  try {
    if (task.type === "check")
      return {
        type: "checked",
        changed: await renderer.changed(task.url, task.inputs),
      };
    return {
      type: "page",
      outcome:
        task.type === "render"
          ? await renderer.renderPage(task.url, { notFound: task.notFound })
          : task.type === "shell"
            ? await renderer.shellPage(task.url)
            : await renderer.lost(task.url, task.diagnostics),
    };
  } catch (error) {
    const { diagnostics } = error as { diagnostics?: Diagnostics };
    return diagnostics
      ? { type: "page", outcome: { diagnostics } }
      : { type: "fatal", error };
  }
};

/**
 * Serves one renderer to `prerender()`'s pool, from the module its `worker`
 * option names: the options that hold functions (`entry`, `shell`, `api`,
 * `exclude`, `onError`) live here, since none crosses to the parent. Each
 * worker is a process of its own: one that never yields can be stopped.
 *
 * ```js
 * // prerender-worker.mjs
 * await serveRenderer({ root: "dist", origin: "https://example.com", entry: () => import("@excom/nucleus-kit/server") });
 * ```
 * Node only.
 */
export async function serveRenderer({
  cacheKey,
  ...options
}: ServeRendererOptions): Promise<void> {
  const parent = parentChannel();
  if (!parent)
    throw new Error(
      "nucleus-ssr: serveRenderer() serves prerender()'s pool: run it in the module its worker option names"
    );
  let renderer: RendererHandle;
  try {
    renderer = await openRenderer(options);
    const ready: Ready = {
      type: "ready",
      key: keyOf(renderer, await cacheKey?.()),
      budgetMs: renderer.budgetMs,
    };
    parent.send(ready);
  } catch (error) {
    parent.send({ type: "fatal", error } satisfies Reply);
    return;
  }
  parent.on("message", async (task: Task) =>
    parent.send(await perform(renderer, task))
  );
}

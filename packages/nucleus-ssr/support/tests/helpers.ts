import type { RenderPage } from "../../index";
import { inertDom } from "../../src/inert";
import { afterAll, vi } from "@excom/nucleus-test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// node:path, not `new URL()`: the test environment's `URL` is happy-dom's
export const SITE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/site"
);
export const ORIGIN = "https://wren.test";

/**
 * An `entry`: real Nucleus Kit elements, defined in the renderer's window. A
 * fresh module graph per renderer, since each window has its own registry.
 */
export const loadKit = async () => {
  vi.resetModules();
  await import("@excom/spa-route");
  await import("@excom/include-content");
  await import("@excom/provider-fetch");
  const { Quark } = await import("@excom/quark");
  // after the elements above: they have mounted by the time a sheet first runs
  await import("@excom/quark-sheet");
  const { resetRouter } = await import("@excom/spa-route/testing");
  return {
    settle: () => Quark.whenSettled(),
    beforeRender: ({ url }: RenderPage) => resetRouter(url),
  };
};

/** An `entry` defining one element of its own (a renderer refuses one that defines none), resolving to `hooks`. */
export const ownEntry =
  (hooks: object = {}) =>
  async () => {
    customElements.define("x-own", class extends HTMLElement {});
    return hooks;
  };

// loads nothing: rendered pages link stylesheets and hold frames
const parser = inertDom();
afterAll(() => parser.dispose());

/** A rendered page as a document to query. */
export const parse = (html: string): Document =>
  new parser.window.DOMParser().parseFromString(html, "text/html");

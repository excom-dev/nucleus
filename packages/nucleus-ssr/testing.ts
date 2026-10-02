/**
 * `@excom/nucleus-ssr/testing`: assert a prerendered page hydrates without
 * changing anything or blinking, on happy-dom or in a real browser, and that
 * the server rendered what a browser renders. Node only.
 */
export type { BrowserPage } from "./src/browser-page";
export type {
  ColdRenderOptions,
  ColdRenderReport,
  RenderDifference,
} from "./src/cold-render";
export { compareColdRender } from "./src/cold-render";
export type { HydrationReport } from "./src/hydrate";
export { hydrate } from "./src/hydrate";
export type {
  HydrationCheckOptions,
  HydrationCheckReport,
} from "./src/hydration-check";
export { checkHydration } from "./src/hydration-check";

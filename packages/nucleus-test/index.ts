import type { DiffOptions } from "@open-wc/semantic-dom-diff/get-diffable-html";

export { consoleSinks, summarizeConsoleArg } from "./src/console";
export { readDemo, readFileRelative } from "./src/files";
export { clearEventListeners, getEventListeners } from "./src/listeners";
export {
  type ApiHandler,
  serveStatic,
  type ServeStaticOptions,
} from "./src/serve-static";
export type { FakeResponse } from "./src/utils";
export {
  click,
  fixture,
  HTTP_STATUS_TEXT,
  spyFetch,
  wait,
  waitForEvent,
} from "./src/utils";
export * from "@open-wc/semantic-dom-diff";
export * from "vitest";

declare global {
  namespace Chai {
    interface Assertion {
      /** The element's own tag and attributes equal `expected`'s; children ignored. */
      equalTag(expected: string, options?: DiffOptions): void;
      /** Listener counts per type are exactly `expected`: `{ click: 1 }`. */
      toMatchListeners(expected: Record<string, number>): void;
      /** Listener counts of the listed types only; `0` for none. */
      toContainListeners(expected: Record<string, number>): void;
    }
  }
  /** Listeners added to `target`, by type (installed by `@excom/nucleus-test/setup`). */
  var getEventListeners: (
    target: EventTarget
  ) => Record<string, EventListener[]>;
  /** Forgets `target`'s recorded listeners (installed by `@excom/nucleus-test/setup`). */
  var clearEventListeners: (target: EventTarget) => void;
}

/**
 * `@excom/quark-sheet/server`: the sheets' hook for prerendering in Node
 * (`@excom/nucleus-ssr`). Defines no element. Not for the browser.
 */
import { Quark } from "@excom/quark";

/**
 * Resolves once no sheet has work left. No cap: `Quark.whenSettled()`
 * alone gives up after 1 s, and the renderer's `budgetMs` already bounds
 * the page.
 */
export const settle = (): Promise<unknown> =>
  Quark.whenSettled({ timeout: Infinity });
